import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ApiError, apiClient, buildWsUrl } from '../services/api';
import { healthFromStatus } from '../utils/health';
import { useAuth } from './AuthContext';
import type {
  AlertItem,
  AlertStatus,
  Asset,
  Device,
  HealthBannerState,
  TelemetryPoint,
} from '../types/models';

type WsMessage =
  | { type: 'pong' }
  | {
      type: 'telemetry.tick';
      data: {
        time: string;
        org_id: string;
        device_id: string;
        device_uid: string;
        asset_id: string | null;
        asset_name?: string;
        health_status: string;
        temperature: number;
        humidity: number;
        vibration_hz: number;
        power_w: number;
        vib_rms_mm_s: number;
        iso_zone: string;
      };
    }
  | {
      type: 'device.status';
      data: {
        device_id: string;
        asset_id: string | null;
        status: string;
        timestamp: string;
      };
    }
  | { type: 'alert.created'; data: AlertItem }
  | { type: 'alert.updated'; data: Partial<AlertItem> & { id: string } };

export interface TelemetryContextValue {
  assets: Asset[];
  selectedAsset: Asset | null;
  selectedAssetId: string | null;
  setSelectedAssetId: (id: string | null) => void;
  readings: TelemetryPoint[];
  alerts: AlertItem[];
  devices: Device[];
  latest: TelemetryPoint | null;
  health: HealthBannerState;
  openAlerts: AlertItem[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  live: boolean;
  refresh: () => Promise<void>;
  resolveAlert: (id: string, notes?: string) => Promise<{ data?: AlertItem; error?: Error }>;
  updateAlertStatus: (
    id: string,
    status: AlertStatus,
    notes?: string,
  ) => Promise<{ data?: AlertItem; error?: Error }>;
  clearError: () => void;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

export function TelemetryProvider({ children }: { children: ReactNode }): ReactElement {
  const { token, signOut } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [readings, setReadings] = useState<TelemetryPoint[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const selectedAssetIdRef = useRef<string | null>(selectedAssetId);
  selectedAssetIdRef.current = selectedAssetId;

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? assets[0] ?? null,
    [assets, selectedAssetId],
  );

  const latest = useMemo<TelemetryPoint | null>(() => {
    if (readings.length > 0) return readings[0];
    if (selectedAsset?.latest_metrics && Object.keys(selectedAsset.latest_metrics).length > 0) {
      const m = selectedAsset.latest_metrics;
      return {
        time: selectedAsset.last_telemetry_at ?? '',
        timestamp: selectedAsset.last_telemetry_at,
        temperature: m.temperature ?? null,
        humidity: m.humidity ?? null,
        vibration_hz: m.vibration_hz ?? null,
        power_w: m.power_w ?? null,
        vib_rms_mm_s: m.vib_rms_mm_s ?? null,
        iso_zone: m.iso_zone ?? null,
      };
    }
    return null;
  }, [readings, selectedAsset]);

  // Backend health_status is the single source of truth
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
      setAssets(assetList);
      setAlerts(alertList);
      setDevices(deviceList);

      const curSelected = selectedAssetIdRef.current;
      const targetId =
        curSelected && assetList.some((a) => a.id === curSelected)
          ? curSelected
          : (assetList[0]?.id ?? null);
      setSelectedAssetId(targetId);

      if (targetId) {
        const hist = await apiClient.telemetry(token, targetId, '15m');
        setReadings([...hist].reverse().map((r) => ({ ...r, timestamp: r.time })));
      } else {
        setReadings([]);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        await signOut();
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load telemetry');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, signOut]);

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
    void fetchAll();
  }, [token, fetchAll]);

  useEffect(() => {
    if (!token || !selectedAssetId) return;
    apiClient
      .telemetry(token, selectedAssetId, '15m')
      .then((hist) =>
        setReadings([...hist].reverse().map((r) => ({ ...r, timestamp: r.time }))),
      )
      .catch(() => {});
  }, [token, selectedAssetId]);

  useEffect(() => {
    if (!token) return undefined;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const ws = new WebSocket(buildWsUrl(token));
      wsRef.current = ws;
      ws.onopen = () => setLive(true);
      ws.onclose = () => {
        setLive(false);
        if (!closed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(String(ev.data)) as WsMessage;
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
            if (d.asset_id === selectedAssetIdRef.current) {
              const point: TelemetryPoint = {
                time: d.time,
                timestamp: d.time,
                temperature: d.temperature,
                humidity: d.humidity,
                vibration_hz: d.vibration_hz,
                power_w: d.power_w,
                vib_rms_mm_s: d.vib_rms_mm_s,
                iso_zone: d.iso_zone,
              };
              setReadings((prev) => [point, ...prev].slice(0, 60));
            }
          } else if (msg.type === 'device.status') {
            const d = msg.data;
            setDevices((prev) =>
              prev.map((dev) =>
                dev.id === d.device_id
                  ? { ...dev, status: d.status, last_seen_at: d.timestamp }
                  : dev,
              ),
            );
          } else if (msg.type === 'alert.created') {
            setAlerts((prev) =>
              [msg.data, ...prev.filter((a) => a.id !== msg.data.id)].slice(0, 80),
            );
          } else if (msg.type === 'alert.updated') {
            setAlerts((prev) =>
              prev.map((a) => (a.id === msg.data.id ? { ...a, ...msg.data } : a)),
            );
          }
        } catch {
          // ignore malformed event frames
        }
      };
    };

    connect();
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping');
      }
    }, 25000);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, [token]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    return fetchAll();
  }, [fetchAll]);

  const updateAlertStatus = useCallback(
    async (
      id: string,
      status: AlertStatus,
      notes?: string,
    ): Promise<{ data?: AlertItem; error?: Error }> => {
      if (!token) return { error: new Error('Not signed in') };
      try {
        const data = await apiClient.updateAlert(token, id, status, notes);
        setAlerts((prev) => prev.map((a) => (a.id === data.id ? data : a)));
        return { data };
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error.message);
        return { error };
      }
    },
    [token],
  );

  const resolveAlert = useCallback(
    (id: string, notes?: string) => updateAlertStatus(id, 'resolved', notes),
    [updateAlertStatus],
  );

  const value = useMemo<TelemetryContextValue>(
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

  return (
    <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>
  );
}

export function useTelemetry(): TelemetryContextValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetry must be used within TelemetryProvider');
  return ctx;
}
