import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiClient, buildWsUrl } from '../services/api';
import { healthFromStatus } from '../utils/health';
import { useAuth } from './AuthContext';

const TelemetryContext = createContext(null);

export function TelemetryProvider({ children }) {
  const { token, signOut } = useAuth();
  const [assets, setAssets] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [readings, setReadings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);
  const wsRef = useRef(null);

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? assets[0] ?? null,
    [assets, selectedAssetId],
  );

  const latest = useMemo(() => {
    if (readings.length > 0) return readings[0];
    if (selectedAsset?.latest_metrics && Object.keys(selectedAsset.latest_metrics).length > 0) {
      return {
        ...selectedAsset.latest_metrics,
        device_id: selectedAsset.name,
        timestamp: selectedAsset.last_telemetry_at,
      };
    }
    return null;
  }, [readings, selectedAsset]);

  // Backend health_status is the single source of truth!
  const health = useMemo(
    () => healthFromStatus(selectedAsset?.health_status),
    [selectedAsset?.health_status],
  );

  const openAlerts = useMemo(
    () => alerts.filter((a) => !['resolved', 'false_positive'].includes(a.status)),
    [alerts],
  );

  const fetchAll = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setError(null);
    try {
      const [assetList, alertList, deviceList] = await Promise.all([
        apiClient.assets(token),
        apiClient.alerts(token),
        apiClient.devices(token),
      ]);
      setAssets(assetList ?? []);
      setAlerts(alertList ?? []);
      setDevices(deviceList ?? []);
      const targetId =
        selectedAssetId && assetList.some((a) => a.id === selectedAssetId)
          ? selectedAssetId
          : assetList[0]?.id ?? null;
      setSelectedAssetId(targetId);

      if (targetId) {
        const hist = await apiClient.telemetry(token, targetId, '15m');
        setReadings([...(hist ?? [])].reverse().map((r) => ({ ...r, timestamp: r.time })));
      } else {
        setReadings([]);
      }
    } catch (e) {
      if (e.status === 401) {
        signOut();
      } else {
        setError(e.message ?? 'Failed to load telemetry');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, selectedAssetId, signOut]);

  useEffect(() => {
    if (!token) {
      setAssets([]);
      setReadings([]);
      setAlerts([]);
      setDevices([]);
      setSelectedAssetId(null);
      setLive(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAll();
  }, [token]);

  useEffect(() => {
    if (!token || !selectedAssetId) return;
    apiClient
      .telemetry(token, selectedAssetId, '15m')
      .then((hist) =>
        setReadings([...(hist ?? [])].reverse().map((r) => ({ ...r, timestamp: r.time }))),
      )
      .catch(() => {});
  }, [token, selectedAssetId]);

  useEffect(() => {
    if (!token) return undefined;
    let closed = false;

    const connect = () => {
      const ws = new WebSocket(buildWsUrl(token));
      wsRef.current = ws;
      ws.onopen = () => setLive(true);
      ws.onclose = () => {
        setLive(false);
        if (!closed) setTimeout(connect, 3000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'telemetry.tick') {
            const d = msg.data;
            setAssets((prev) =>
              prev.map((a) =>
                a.id === d.asset_id
                  ? {
                      ...a,
                      health_status: d.health_status,
                      last_telemetry_at: d.time,
                      latest_metrics: {
                        temperature: d.temperature,
                        humidity: d.humidity,
                        vibration_hz: d.vibration_hz,
                        power_w: d.power_w,
                        vib_rms_mm_s: d.vib_rms_mm_s,
                        iso_zone: d.iso_zone,
                      },
                    }
                  : a,
              ),
            );
            if (d.asset_id === selectedAssetId) {
              setReadings((prev) => [{ ...d, timestamp: d.time }, ...prev].slice(0, 60));
            }
          } else if (msg.type === 'device.status') {
            const d = msg.data;
            setDevices((prev) =>
              prev.map((dev) =>
                dev.id === d.device_id ? { ...dev, status: d.status, last_seen_at: d.timestamp } : dev,
              ),
            );
          } else if (msg.type === 'alert.created') {
            setAlerts((prev) => [msg.data, ...prev.filter((a) => a.id !== msg.data.id)].slice(0, 80));
          } else if (msg.type === 'alert.updated') {
            setAlerts((prev) => prev.map((a) => (a.id === msg.data.id ? { ...a, ...msg.data } : a)));
          }
        } catch {
          // ignore
        }
      };
    };

    connect();
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send('ping');
    }, 25000);

    return () => {
      closed = true;
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, [token, selectedAssetId]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    return fetchAll();
  }, [fetchAll]);

  const updateAlertStatus = useCallback(
    async (id, status, notes) => {
      if (!token) return { error: new Error('Not signed in') };
      try {
        const data = await apiClient.updateAlert(token, id, status, notes);
        setAlerts((prev) => prev.map((a) => (a.id === data.id ? data : a)));
        return { data };
      } catch (err) {
        setError(err.message);
        return { error: err };
      }
    },
    [token],
  );

  const resolveAlert = useCallback(
    (id, notes) => updateAlertStatus(id, 'resolved', notes),
    [updateAlertStatus],
  );

  const value = useMemo(
    () => ({
      assets,
      selectedAsset,
      selectedAssetId,
      setSelectedAssetId,
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
      updateAlertStatus,
      clearError: () => setError(null),
    }),
    [
      assets,
      selectedAsset,
      selectedAssetId,
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
      updateAlertStatus,
    ],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry() {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetry must be used within TelemetryProvider');
  return ctx;
}
