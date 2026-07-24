import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { isSupabaseConfigured, supabase } from '../services/supabase';
import { evaluateReadingHealth } from '../utils/health';
import { useAuth } from './AuthContext';

const TelemetryContext = createContext(null);

export function TelemetryProvider({ children }) {
  const { session, isConfigured } = useAuth();
  const [readings, setReadings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);

  const latest = readings[0] ?? null;
  const health = evaluateReadingHealth(latest);
  const openAlerts = useMemo(
    () => alerts.filter((a) => !a.is_resolved),
    [alerts],
  );

  const fetchAll = useCallback(async () => {
    if (!isConfigured) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setError(null);
    try {
      const [readingsRes, alertsRes, devicesRes] = await Promise.all([
        supabase
          .from('sensor_readings')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(40),
        supabase
          .from('alerts')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(50),
        supabase.from('devices').select('*').order('device_name'),
      ]);

      if (readingsRes.error) throw readingsRes.error;
      if (alertsRes.error) throw alertsRes.error;
      if (devicesRes.error) throw devicesRes.error;

      setReadings(readingsRes.data ?? []);
      setAlerts(alertsRes.data ?? []);
      setDevices(devicesRes.data ?? []);
    } catch (e) {
      setError(e.message ?? 'Failed to load telemetry');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isConfigured]);

  useEffect(() => {
    if (!session) {
      setReadings([]);
      setAlerts([]);
      setDevices([]);
      setLive(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAll();
  }, [session, fetchAll]);

  useEffect(() => {
    if (!session || !isSupabaseConfigured) return undefined;

    const readingsChannel = supabase
      .channel('mobile-sensor-readings')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sensor_readings' },
        (payload) => {
          setLive(true);
          setReadings((prev) => [payload.new, ...prev].slice(0, 40));
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setLive(true);
      });

    const alertsChannel = supabase
      .channel('mobile-alerts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'alerts' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setAlerts((prev) => [payload.new, ...prev].slice(0, 50));
          } else if (payload.eventType === 'UPDATE') {
            setAlerts((prev) =>
              prev.map((a) => (a.id === payload.new.id ? payload.new : a)),
            );
          } else if (payload.eventType === 'DELETE') {
            setAlerts((prev) => prev.filter((a) => a.id !== payload.old.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(readingsChannel);
      supabase.removeChannel(alertsChannel);
      setLive(false);
    };
  }, [session]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    return fetchAll();
  }, [fetchAll]);

  const resolveAlert = useCallback(async (id) => {
    const { data, error: err } = await supabase
      .from('alerts')
      .update({ is_resolved: true })
      .eq('id', id)
      .select()
      .single();

    if (err) {
      setError(err.message);
      return { error: err };
    }

    setAlerts((prev) => prev.map((a) => (a.id === data.id ? data : a)));
    return { data };
  }, []);

  const value = useMemo(
    () => ({
      readings,
      alerts,
      devices,
      latest,
      health,
      openAlerts,
      loading,
      refreshing,
      error,
      live,
      refresh,
      resolveAlert,
      clearError: () => setError(null),
    }),
    [
      readings,
      alerts,
      devices,
      latest,
      health,
      openAlerts,
      loading,
      refreshing,
      error,
      live,
      refresh,
      resolveAlert,
    ],
  );

  return (
    <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetry must be used within TelemetryProvider');
  return ctx;
}
