import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Building2,
  CheckCircle2,
  ClipboardList,
  Cpu,
  Download,
  Factory,
  Gauge,
  LogOut,
  Plus,
  Radio,
  RefreshCw,
  Settings,
  ShieldAlert,
  Sliders,
  ThumbsDown,
  ThumbsUp,
  Thermometer,
  Upload,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  api,
  buildWsUrl,
  type AlertItem,
  type Asset,
  type AssetProfile,
  type Device,
  type FleetSummary,
  type SessionData,
  type Site,
  type TelemetryPoint,
  type WorkOrder,
} from './lib/api';
import { StatusBadge } from './components/StatusBadge';
import { TelemetryChart } from './components/TelemetryChart';
import { LoginPage } from './pages/LoginPage';

type TabKey = 'fleet' | 'asset' | 'alerts' | 'workorders' | 'devices' | 'team';

const STORAGE_KEY = 'eagle_saas_session_v1';

export default function App() {
  const [session, setSession] = useState<SessionData | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [tab, setTab] = useState<TabKey>('fleet');
  const [wsLive, setWsLive] = useState(false);
  const [summary, setSummary] = useState<FleetSummary | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<string>('15m');
  const [series, setSeries] = useState<TelemetryPoint[]>([]);
  const [manuals, setManuals] = useState<any[]>([]);
  const [alertFilter, setAlertFilter] = useState<string>('active');
  const [toast, setToast] = useState<string | null>(null);

  // Modals / forms
  const [profileDraft, setProfileDraft] = useState<Partial<AssetProfile>>({});
  const [newDeviceUid, setNewDeviceUid] = useState('');
  const [newDeviceAssetId, setNewDeviceAssetId] = useState('');
  const [provisionedCert, setProvisionedCert] = useState<Record<string, string> | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('technician');
  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [resolveNote, setResolveNote] = useState<Record<string, string>>({});

  const wsRef = useRef<WebSocket | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 4000);
  };

  const saveSession = (next: SessionData | null) => {
    setSession(next);
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  };

  const token = session?.access_token ?? null;

  const loadAll = useCallback(async () => {
    if (!token) return;
    try {
      const [sum, siteList, assetList, devList, alertList, woList] = await Promise.all([
        api.fleetSummary(token),
        api.sites(token),
        api.assets(token),
        api.devices(token),
        api.alerts(token),
        api.workOrders(token),
      ]);
      setSummary(sum);
      setSites(siteList);
      setAssets(assetList);
      setDevices(devList);
      setAlerts(alertList);
      setWorkOrders(woList);
      if (assetList.length > 0) {
        setSelectedAssetId((cur) => (cur && assetList.some((a) => a.id === cur) ? cur : assetList[0].id));
      } else {
        setSelectedAssetId(null);
      }
    } catch (err: any) {
      if (String(err.message).includes('401')) saveSession(null);
      else notify(`Load error: ${err.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  useEffect(() => {
    if (!token || !selectedAssetId) return;
    api.telemetry(token, selectedAssetId, chartRange).then(setSeries).catch(() => {});
    api.manuals(token, selectedAssetId).then(setManuals).catch(() => {});
  }, [token, selectedAssetId, chartRange]);

  useEffect(() => {
    if (selectedAsset?.profile) setProfileDraft(selectedAsset.profile);
  }, [selectedAsset?.id]);

  useEffect(() => {
    if (!token || tab !== 'team') return;
    Promise.all([api.members(token), api.webhooks(token), api.auditLogs(token)])
      .then(([m, w, a]) => {
        setMembers(m);
        setWebhooks(w);
        setAuditLogs(a);
      })
      .catch(() => {});
  }, [token, tab]);

  // Tenant-scoped live WebSocket connection
  useEffect(() => {
    if (!token) return;
    let closed = false;
    const connect = () => {
      const ws = new WebSocket(buildWsUrl(token));
      wsRef.current = ws;
      ws.onopen = () => setWsLive(true);
      ws.onclose = () => {
        setWsLive(false);
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
            setSeries((prev) => {
              if (d.asset_id !== selectedAssetId || chartRange !== '15m') return prev;
              const next = [
                ...prev,
                {
                  time: d.time,
                  temperature: d.temperature,
                  humidity: d.humidity,
                  vibration_hz: d.vibration_hz,
                  power_w: d.power_w,
                  vib_rms_mm_s: d.vib_rms_mm_s,
                  iso_zone: d.iso_zone,
                  sample_count: 1,
                },
              ];
              return next.slice(-180);
            });
          } else if (msg.type === 'device.status') {
            const d = msg.data;
            setDevices((prev) =>
              prev.map((dev) => (dev.id === d.device_id ? { ...dev, status: d.status, last_seen_at: d.timestamp } : dev)),
            );
            if (d.status === 'offline' && d.asset_id) {
              setAssets((prev) =>
                prev.map((a) => (a.id === d.asset_id && !a.maintenance_mode ? { ...a, health_status: 'OFFLINE' } : a)),
              );
            }
          } else if (msg.type === 'alert.created') {
            setAlerts((prev) => [msg.data, ...prev.filter((a) => a.id !== msg.data.id)]);
            api.fleetSummary(token).then(setSummary).catch(() => {});
          } else if (msg.type === 'alert.updated') {
            setAlerts((prev) => prev.map((a) => (a.id === msg.data.id ? { ...a, ...msg.data } : a)));
            api.fleetSummary(token).then(setSummary).catch(() => {});
          }
        } catch {
          // ignore
        }
      };
    };
    connect();
    const pingId = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send('ping');
    }, 25000);
    return () => {
      closed = true;
      clearInterval(pingId);
      wsRef.current?.close();
    };
  }, [token, selectedAssetId, chartRange]);

  if (!session || !token) {
    return <LoginPage onLogin={saveSession} />;
  }

  const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]));
  const filteredAlerts = alerts.filter((a) => {
    if (alertFilter === 'active') return ['open', 'acknowledged', 'in_progress'].includes(a.status);
    if (alertFilter === 'CRITICAL') return a.severity === 'CRITICAL';
    if (alertFilter === 'resolved') return ['resolved', 'false_positive'].includes(a.status);
    return true;
  });

  const handleOrgSwitch = async (orgId: string) => {
    try {
      const next = await api.switchOrg(token, orgId);
      saveSession(next);
      setSeries([]);
      notify(`Switched workspace to ${next.active_org.name}`);
    } catch (err: any) {
      notify(err.message);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    try {
      const updated = await api.updateProfile(token, selectedAsset.id, profileDraft);
      setAssets((prev) => prev.map((a) => (a.id === selectedAsset.id ? { ...a, profile: updated } : a)));
      notify('Thresholds & baselines updated live in rules engine!');
    } catch (err: any) {
      notify(err.message);
    }
  };

  const handleToggleMaintenance = async (asset: Asset) => {
    try {
      const updated = await api.updateAsset(token, asset.id, { maintenance_mode: !asset.maintenance_mode });
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? updated : a)));
      notify(`${asset.name}: maintenance mode ${updated.maintenance_mode ? 'ENABLED (alerts suppressed)' : 'DISABLED'}`);
    } catch (err: any) {
      notify(err.message);
    }
  };

  const handleAlertStatus = async (id: string, nextStatus: string) => {
    try {
      const updated = await api.updateAlert(token, id, nextStatus, resolveNote[id]);
      setAlerts((prev) => prev.map((a) => (a.id === id ? updated : a)));
      notify(`Alert marked ${nextStatus}`);
    } catch (err: any) {
      notify(err.message);
    }
  };

  const handleCreateWOFromAlert = async (alert: AlertItem) => {
    const assetName = assetMap[alert.asset_id]?.name ?? 'Asset';
    try {
      const wo = await api.createWorkOrder(token, {
        asset_id: alert.asset_id,
        alert_id: alert.id,
        title: `[${alert.severity}] Inspect ${assetName}`,
        description: alert.ai_diagnosis?.probable_root_cause || alert.trigger_reason,
        priority: alert.severity === 'CRITICAL' ? 'urgent' : 'high',
      });
      setWorkOrders((prev) => [wo, ...prev]);
      notify('Maintenance work order created');
      setTab('workorders');
    } catch (err: any) {
      notify(err.message);
    }
  };

  const handleProvisionDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.provisionDevice(token, {
        device_uid: newDeviceUid.trim().toLowerCase(),
        asset_id: newDeviceAssetId || null,
        protocol: 'mqtt',
      });
      setDevices((prev) => [...prev, res.device]);
      setProvisionedCert(res.cert_bundle);
      setNewDeviceUid('');
      notify(`Device ${res.device.device_uid} provisioned with unique mTLS cert!`);
    } catch (err: any) {
      notify(err.message);
    }
  };

  const handleManualUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedAsset) return;
    try {
      const uploaded = await api.uploadManual(token, selectedAsset.id, file);
      setManuals((prev) => [uploaded, ...prev]);
      notify(`Indexed ${uploaded.filename} into ${uploaded.chunk_count} pgvector RAG chunks!`);
    } catch (err: any) {
      notify(err.message);
    }
    e.target.value = '';
  };

  const navItems: { key: TabKey; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'fleet', label: 'Control Room', icon: <Gauge className="w-4 h-4" /> },
    { key: 'asset', label: 'Live Telemetry', icon: <Activity className="w-4 h-4" /> },
    {
      key: 'alerts',
      label: 'Alerts & AI',
      icon: <AlertTriangle className="w-4 h-4" />,
      badge: alerts.filter((a) => ['open', 'acknowledged', 'in_progress'].includes(a.status)).length,
    },
    { key: 'workorders', label: 'Work Orders', icon: <ClipboardList className="w-4 h-4" /> },
    { key: 'devices', label: 'Devices & PKI', icon: <Cpu className="w-4 h-4" /> },
    { key: 'team', label: 'Team & Reports', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen flex bg-[#F3F6F8] text-[#0B1C24]">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0B1C24] text-white flex flex-col shrink-0">
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-2.5 text-teal-400 font-bold text-xs uppercase tracking-widest">
            <img
              src="/logo.png"
              alt="Future Eagle IIoT"
              className="w-8 h-8 rounded-lg border border-white/15 object-cover shrink-0"
            />
            <span>Future Eagle IIoT</span>
          </div>
          <div className="mt-3">
            <label className="text-[11px] uppercase tracking-wider text-slate-400">Active Factory Tenant</label>
            <select
              value={session.active_org.id}
              onChange={(e) => handleOrgSwitch(e.target.value)}
              className="mt-1 w-full bg-[#132B36] border border-white/15 rounded-lg px-2.5 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {session.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.role})
                </option>
              ))}
            </select>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition cursor-pointer ${
                tab === item.key
                  ? 'bg-[#0F766E] text-white shadow-sm'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5">
                {item.icon}
                {item.label}
              </span>
              {item.badge ? (
                <span className="px-2 py-0.5 text-xs rounded-full bg-red-500 text-white font-bold tabular-nums">
                  {item.badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Live Stream</span>
            <span className={`inline-flex items-center gap-1.5 font-semibold ${wsLive ? 'text-teal-400' : 'text-amber-400'}`}>
              <Radio className="w-3.5 h-3.5" /> {wsLive ? 'WebSocket Live' : 'Reconnecting'}
            </span>
          </div>
          <div className="text-slate-300 truncate">{session.full_name}</div>
          <div className="text-slate-500 truncate">{session.email}</div>
          <button
            onClick={() => saveSession(null)}
            className="w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-lg bg-white/10 hover:bg-red-500/80 text-white font-semibold transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        {toast && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-[#0B1C24] text-white text-sm font-medium shadow-lg flex items-center justify-between">
            <span>{toast}</span>
            <button onClick={() => setToast(null)} className="text-teal-300 text-xs font-bold ml-4 cursor-pointer">
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: FLEET CONTROL ROOM */}
        {tab === 'fleet' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-[#0B1C24]">{session.active_org.name} — Fleet Control Room</h1>
                <p className="text-sm text-slate-500">
                  Real-time multi-asset telemetry isolated via PostgreSQL RLS & EMQX mTLS ACLs
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => api.downloadReport(token, 'pdf', 24)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#0F766E]" /> Incident PDF
                </button>
                <button
                  onClick={loadAll}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
              </div>
            </div>

            {/* KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Monitored Assets" value={summary?.total_assets ?? assets.length} icon={<Factory className="w-5 h-5 text-[#0F766E]" />} />
              <KpiCard
                label="Online Devices"
                value={`${summary?.online_devices ?? 0} / ${summary?.total_devices ?? devices.length}`}
                icon={<Cpu className="w-5 h-5 text-emerald-600" />}
              />
              <KpiCard
                label="Open Alerts"
                value={summary?.open_alerts ?? 0}
                icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
              />
              <KpiCard
                label="Critical Open"
                value={summary?.critical_open_alerts ?? 0}
                accent={(summary?.critical_open_alerts ?? 0) > 0 ? 'text-red-600' : undefined}
                icon={<ShieldAlert className="w-5 h-5 text-red-600" />}
              />
            </div>

            {/* Asset Cards Grid */}
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {assets.map((asset) => {
                const m = asset.latest_metrics || {};
                const dev = devices.find((d) => d.asset_id === asset.id);
                return (
                  <div
                    key={asset.id}
                    onClick={() => {
                      setSelectedAssetId(asset.id);
                      setTab('asset');
                    }}
                    className="bg-white rounded-xl border border-slate-200 p-5 hover:border-[#0F766E] hover:shadow-md transition cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs uppercase font-bold tracking-wider text-slate-400">
                          {asset.asset_type} · {asset.manufacturer || 'Industrial'}
                        </div>
                        <h3 className="text-base font-bold text-[#0B1C24] mt-0.5">{asset.name}</h3>
                      </div>
                      <StatusBadge value={asset.health_status} />
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-4 text-sm tabular-nums">
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <div className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Thermometer className="w-3.5 h-3.5 text-red-500" /> Temp
                        </div>
                        <div className="font-bold text-base mt-0.5">
                          {m.temperature != null ? `${Number(m.temperature).toFixed(1)} °C` : '—'}
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <div className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Activity className="w-3.5 h-3.5 text-amber-500" /> Vibration
                        </div>
                        <div className="font-bold text-base mt-0.5">
                          {m.vibration_hz != null ? `${Number(m.vibration_hz).toFixed(1)} Hz` : '—'}
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <div className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Zap className="w-3.5 h-3.5 text-[#0F766E]" /> Power
                        </div>
                        <div className="font-bold text-base mt-0.5">
                          {m.power_w != null ? `${Number(m.power_w).toFixed(0)} W` : '—'}
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <div className="text-[11px] text-slate-500">ISO 20816</div>
                        <div className="mt-1 flex items-center gap-1.5">
                          {m.iso_zone ? <StatusBadge value={m.iso_zone} prefix="Zone" /> : <span className="text-slate-400">—</span>}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                      <span>Device: {dev ? dev.device_uid : 'Unassigned'}</span>
                      {dev && <StatusBadge value={dev.status} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: ASSET LIVE TELEMETRY & THRESHOLDS */}
        {tab === 'asset' && selectedAsset && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <select
                  value={selectedAsset.id}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-base font-bold text-[#0B1C24]"
                >
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.health_status})
                    </option>
                  ))}
                </select>
                <StatusBadge value={selectedAsset.health_status} />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleMaintenance(selectedAsset)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                    selectedAsset.maintenance_mode
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Wrench className="w-3.5 h-3.5" />
                  {selectedAsset.maintenance_mode ? 'Maintenance ON (Muted)' : 'Enable Maintenance Mode'}
                </button>
                <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5">
                  {['15m', '1h', '6h', '24h', '7d'].map((r) => (
                    <button
                      key={r}
                      onClick={() => setChartRange(r)}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                        chartRange === r ? 'bg-[#0F766E] text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Live Chart */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold text-slate-700">
                  Live Multi-Signal Telemetry ({series.length} samples · {chartRange})
                </h2>
                <span className="text-xs text-slate-500">
                  {selectedAsset.manufacturer} {selectedAsset.model_number} · {selectedAsset.rated_power_kw ?? '-'} kW
                </span>
              </div>
              <TelemetryChart data={series} profile={selectedAsset.profile} />
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Threshold & Baseline Profile Editor */}
              <form onSubmit={handleSaveProfile} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-[#0F766E]" /> Dynamic Thresholds & Baselines
                  </h3>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-semibold cursor-pointer"
                  >
                    Save Live Rules
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {(
                    [
                      ['baseline_temp', 'Baseline Temp (°C)'],
                      ['crit_temp', 'Critical Temp (°C)'],
                      ['baseline_vibration_hz', 'Baseline Vib (Hz)'],
                      ['crit_vibration_hz', 'Critical Vib (Hz)'],
                      ['baseline_power_w', 'Baseline Power (W)'],
                      ['crit_power_w', 'Critical Power (W)'],
                      ['corr_temp_delta', 'Corr Temp Delta (°C)'],
                      ['cooldown_base_sec', 'Cooldown Base (s)'],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} className="block">
                      <span className="text-slate-500 font-semibold">{label}</span>
                      <input
                        type="number"
                        step="0.5"
                        value={profileDraft[field] ?? ''}
                        onChange={(e) => setProfileDraft((p) => ({ ...p, [field]: Number(e.target.value) }))}
                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg tabular-nums"
                      />
                    </label>
                  ))}
                </div>
              </form>

              {/* Maintenance Manuals (pgvector RAG) */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-[#0F766E]" /> Machine Manuals (pgvector RAG)
                  </h3>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer">
                    <Upload className="w-3.5 h-3.5" /> Upload .md / .txt
                    <input type="file" accept=".txt,.md" className="hidden" onChange={handleManualUpload} />
                  </label>
                </div>
                <p className="text-xs text-slate-500">
                  Uploaded manuals are chunked and embedded into PostgreSQL <code>pgvector</code> so the AI Copilot cites
                  exact bearing part numbers & LOTO procedures during incidents.
                </p>
                <div className="space-y-2">
                  {manuals.length === 0 ? (
                    <div className="text-xs text-slate-400 py-4 text-center">No manuals uploaded for this asset yet.</div>
                  ) : (
                    manuals.map((m) => (
                      <div key={m.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                        <span className="font-semibold text-slate-800">{m.filename}</span>
                        <span className="text-slate-500">{m.chunk_count} vector chunks</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ALERTS & AI DIAGNOSTICS */}
        {tab === 'alerts' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-extrabold">Alerts & AI Copilot Diagnostics</h1>
              <div className="flex gap-1.5">
                {[
                  ['active', 'Active'],
                  ['CRITICAL', 'Critical'],
                  ['resolved', 'Resolved'],
                  ['all', 'All'],
                ].map(([k, lbl]) => (
                  <button
                    key={k}
                    onClick={() => setAlertFilter(k)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer ${
                      alertFilter === k ? 'bg-[#0F766E] text-white' : 'bg-white border border-slate-200 text-slate-600'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {filteredAlerts.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
                No alerts in this filter. Run <code>make fault DEVICE=acme-motor-01 TYPE=bearing_wear</code> to test live AI diagnosis!
              </div>
            ) : (
              <div className="space-y-4">
                {filteredAlerts.map((alert) => {
                  const asset = assetMap[alert.asset_id];
                  const diag = alert.ai_diagnosis;
                  return (
                    <div key={alert.id} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <StatusBadge value={alert.severity} />
                          <StatusBadge value={alert.status} />
                          <span className="font-bold text-[#0B1C24]">{asset?.name || alert.asset_id}</span>
                        </div>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {new Date(alert.created_at).toLocaleString()}
                        </span>
                      </div>

                      <div className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700">
                        Trigger: {alert.trigger_reason}
                      </div>

                      {diag ? (
                        <div className="rounded-xl bg-teal-50/60 border border-teal-200 p-4 space-y-2 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-teal-800">
                              AI Copilot Diagnosis · {diag.provider} · {Math.round(diag.confidence * 100)}% confidence
                            </span>
                            {diag.cited_manual_section && (
                              <span className="text-xs bg-white px-2 py-0.5 rounded border border-teal-200 text-teal-900 font-medium">
                                Manual Ref: {diag.cited_manual_section}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-800">{diag.summary}</p>
                          <div className="text-xs text-slate-700">
                            <strong>Probable Root Cause:</strong> {diag.probable_root_cause}
                          </div>
                          <ul className="list-disc pl-5 text-xs text-slate-700 space-y-1">
                            {diag.immediate_actions.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ul>
                          <div className="text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                            Safety: {diag.safety_precaution}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 italic">AI Copilot analyzing alert asynchronously...</div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">AI helpful?</span>
                          <button
                            onClick={() => api.rateAlert(token, alert.id, 1).then(() => loadAll())}
                            className={`p-1.5 rounded-lg border cursor-pointer ${alert.ai_feedback === 1 ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : 'border-slate-200 text-slate-500'}`}
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => api.rateAlert(token, alert.id, -1).then(() => loadAll())}
                            className={`p-1.5 rounded-lg border cursor-pointer ${alert.ai_feedback === -1 ? 'bg-red-100 border-red-300 text-red-700' : 'border-slate-200 text-slate-500'}`}
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {!['resolved', 'false_positive'].includes(alert.status) && (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              placeholder="Technician resolution notes..."
                              value={resolveNote[alert.id] || ''}
                              onChange={(e) => setResolveNote((m) => ({ ...m, [alert.id]: e.target.value }))}
                              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg w-52"
                            />
                            {alert.status === 'open' && (
                              <button
                                onClick={() => handleAlertStatus(alert.id, 'acknowledged')}
                                className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-900 text-xs font-semibold cursor-pointer"
                              >
                                Acknowledge
                              </button>
                            )}
                            <button
                              onClick={() => handleCreateWOFromAlert(alert)}
                              className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold cursor-pointer"
                            >
                              + Work Order
                            </button>
                            <button
                              onClick={() => handleAlertStatus(alert.id, 'resolved')}
                              className="px-3 py-1.5 rounded-lg bg-[#0F766E] text-white text-xs font-semibold cursor-pointer"
                            >
                              Resolve
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: WORK ORDERS */}
        {tab === 'workorders' && (
          <div className="space-y-5">
            <h1 className="text-2xl font-extrabold">Maintenance Work Orders</h1>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left p-3">Title</th>
                    <th className="text-left p-3">Asset</th>
                    <th className="text-left p-3">Priority</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-right p-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workOrders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400">
                        No work orders yet. Create one from any alert in the Alerts tab.
                      </td>
                    </tr>
                  ) : (
                    workOrders.map((wo) => (
                      <tr key={wo.id}>
                        <td className="p-3">
                          <div className="font-semibold">{wo.title}</div>
                          <div className="text-xs text-slate-500">{wo.description}</div>
                        </td>
                        <td className="p-3 text-xs">{assetMap[wo.asset_id]?.name || wo.asset_id}</td>
                        <td className="p-3">
                          <StatusBadge value={wo.priority} />
                        </td>
                        <td className="p-3">
                          <StatusBadge value={wo.status} />
                        </td>
                        <td className="p-3 text-right">
                          {wo.status !== 'completed' && (
                            <button
                              onClick={() =>
                                api.updateWorkOrder(token, wo.id, { status: 'completed' }).then(() => {
                                  loadAll();
                                  notify('Work order completed');
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Complete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: DEVICES & X.509 mTLS PKI PROVISIONING */}
        {tab === 'devices' && (
          <div className="space-y-6">
            <h1 className="text-2xl font-extrabold">Devices & Zero-Trust mTLS Provisioning</h1>

            <form onSubmit={handleProvisionDevice} className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Device UID</label>
                <input
                  required
                  pattern="^[a-z0-9][a-z0-9_-]*$"
                  placeholder="esp32-motor-09"
                  value={newDeviceUid}
                  onChange={(e) => setNewDeviceUid(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Bind to Asset</label>
                <select
                  value={newDeviceAssetId}
                  onChange={(e) => setNewDeviceAssetId(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="">Unassigned</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white text-sm font-semibold cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Provision & Mint mTLS Cert
              </button>
            </form>

            {provisionedCert && (
              <div className="bg-[#0B1C24] text-teal-100 rounded-xl p-5 space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-teal-300">Minted X.509 Bundle — CN={provisionedCert.cert_cn}</span>
                  <button onClick={() => setProvisionedCert(null)} className="text-slate-400 hover:text-white cursor-pointer">
                    Close
                  </button>
                </div>
                <div>Telemetry Topic: {provisionedCert.mqtt_topic_telemetry}</div>
                <div>Status (LWT) Topic: {provisionedCert.mqtt_topic_status}</div>
                <div>SHA-256 Fingerprint: {provisionedCert.fingerprint}</div>
                <p className="text-slate-400 font-sans">
                  Certificate & key have also been saved locally to <code>infra/certs/devices/</code> for immediate ESP32 or simulator testing.
                </p>
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left p-3">Device UID</th>
                    <th className="text-left p-3">Asset</th>
                    <th className="text-left p-3">mTLS Cert CN</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-right p-3">Security</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {devices.map((d) => (
                    <tr key={d.id}>
                      <td className="p-3 font-mono font-semibold text-xs">{d.device_uid}</td>
                      <td className="p-3 text-xs">{d.asset_id ? assetMap[d.asset_id]?.name : '—'}</td>
                      <td className="p-3 font-mono text-xs text-slate-600">{d.cert_cn}</td>
                      <td className="p-3">
                        <StatusBadge value={d.is_revoked ? 'REVOKED' : d.status} />
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          onClick={() =>
                            api.rotateDeviceCert(token, d.id).then((res) => {
                              setProvisionedCert(res.cert_bundle);
                              loadAll();
                              notify(`Rotated cert for ${d.device_uid}`);
                            })
                          }
                          className="px-2.5 py-1 rounded border border-slate-300 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                        >
                          Rotate Cert
                        </button>
                        {!d.is_revoked && (
                          <button
                            onClick={() =>
                              api.revokeDevice(token, d.id).then(() => {
                                loadAll();
                                notify(`Revoked ${d.device_uid} in EMQX ACL`);
                              })
                            }
                            className="px-2.5 py-1 rounded bg-red-50 text-red-700 border border-red-200 text-xs font-semibold hover:bg-red-100 cursor-pointer"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: TEAM, WEBHOOKS, AUDIT & REPORTS */}
        {tab === 'team' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-extrabold">Team RBAC, Webhooks & Compliance Reports</h1>
              <div className="flex gap-2">
                <button
                  onClick={() => api.downloadReport(token, 'csv', 24)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#0F766E]" /> Telemetry CSV (24h)
                </button>
                <button
                  onClick={() => api.downloadReport(token, 'pdf', 24)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0F766E] text-white text-xs font-semibold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Incident PDF (24h)
                </button>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Team & Invites */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#0F766E]" /> Organization Members ({members.length})
                </h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await api.invite(token, inviteEmail, inviteRole);
                      setInviteEmail('');
                      notify('Invite sent! Check local Mailpit inbox at http://localhost:8025');
                    } catch (err: any) {
                      notify(err.message);
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="email"
                    required
                    placeholder="tech@factory.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="technician">Technician</option>
                    <option value="engineer">Engineer</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button className="px-3 py-1.5 rounded-lg bg-[#0F766E] text-white text-xs font-semibold cursor-pointer">
                    Invite
                  </button>
                </form>
                <div className="divide-y divide-slate-100 text-xs">
                  {members.map((m) => (
                    <div key={m.user_id} className="py-2 flex justify-between items-center">
                      <div>
                        <div className="font-semibold">{m.full_name}</div>
                        <div className="text-slate-500">{m.email}</div>
                      </div>
                      <StatusBadge value={m.role} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Webhooks */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#0F766E]" /> Outbound CMMS / Slack Webhooks
                </h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      const created = await api.createWebhook(token, { name: whName, url: whUrl });
                      setWebhooks((prev) => [created, ...prev]);
                      setWhName('');
                      setWhUrl('');
                      notify('Webhook registered');
                    } catch (err: any) {
                      notify(err.message);
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    required
                    placeholder="Name (e.g. Odoo CMMS)"
                    value={whName}
                    onChange={(e) => setWhName(e.target.value)}
                    className="w-36 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs"
                  />
                  <input
                    required
                    placeholder="https://hooks.example.local/alerts"
                    value={whUrl}
                    onChange={(e) => setWhUrl(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs"
                  />
                  <button className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer">
                    Add
                  </button>
                </form>
                <div className="space-y-2 text-xs">
                  {webhooks.map((w) => (
                    <div key={w.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex justify-between items-center">
                      <div>
                        <div className="font-semibold">{w.name}</div>
                        <div className="text-slate-500 font-mono">{w.url}</div>
                      </div>
                      <button
                        onClick={() => api.deleteWebhook(token, w.id).then(() => setWebhooks((p) => p.filter((x) => x.id !== w.id)))}
                        className="text-red-600 font-semibold cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {webhooks.length === 0 && <div className="text-slate-400">No outbound webhooks configured.</div>}
                </div>
              </div>
            </div>

            {/* Audit Trail */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-bold mb-3">Security & Operations Audit Trail</h2>
              <div className="space-y-1.5 text-xs font-mono max-h-60 overflow-y-auto">
                {auditLogs.map((l) => (
                  <div key={l.id} className="flex justify-between py-1 border-b border-slate-100 text-slate-600">
                    <span>
                      <strong className="text-[#0B1C24]">{l.action}</strong> ({l.resource_type}) — {JSON.stringify(l.details)}
                    </span>
                    <span className="text-slate-400">{new Date(l.created_at).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const KpiCard: React.FC<{ label: string; value: string | number; icon: React.ReactNode; accent?: string }> = ({
  label,
  value,
  icon,
  accent,
}) => (
  <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
    <div>
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-extrabold mt-1 tabular-nums ${accent || 'text-[#0B1C24]'}`}>{value}</div>
    </div>
    <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center">{icon}</div>
  </div>
);
