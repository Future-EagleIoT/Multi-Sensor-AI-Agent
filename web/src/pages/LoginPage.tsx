import React, { useState } from 'react';
import { Factory, Lock, ShieldCheck } from 'lucide-react';
import { api, type SessionData } from '../lib/api';

interface Props {
  onLogin: (session: SessionData) => void;
}

const DEMO_ACCOUNTS = [
  { label: 'Multi-Factory Admin', email: 'admin@future-eagle.io', desc: 'Switch between Acme & Nordic' },
  { label: 'Acme Packaging Only', email: 'manager@acme-plant.io', desc: 'Isolated Tenant A (Porto)' },
  { label: 'Nordic Cold Storage', email: 'ops@nordic-cold.io', desc: 'Isolated Tenant B (Gothenburg)' },
];

export const LoginPage: React.FC<Props> = ({ onLogin }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('admin@future-eagle.io');
  const [password, setPassword] = useState('DemoPassword123!');
  const [fullName, setFullName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register(email, fullName, password, orgName);
      onLogin(session);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#0B1C24]">
      <div className="w-full max-w-4xl grid md:grid-cols-2 bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
        <div className="bg-gradient-to-br from-[#0B1C24] via-[#11313D] to-[#0F766E] text-white p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-5">
              <img
                src="/logo.png"
                alt="Future Eagle IIoT"
                className="w-11 h-11 rounded-xl border border-white/15 shadow-sm object-cover"
              />
              <div className="inline-flex items-center gap-2 text-teal-300 text-xs font-bold uppercase tracking-widest">
                <Factory className="w-4 h-4" /> Future Eagle IIoT SaaS
              </div>
            </div>
            <h1 className="text-3xl font-extrabold leading-tight">
              Industrial Predictive Maintenance Control Room
            </h1>
            <p className="mt-3 text-slate-300 text-sm leading-relaxed">
              Multi-tenant mTLS telemetry, ISO 20816 vibration diagnostics, pgvector manual RAG,
              and PostgreSQL Row-Level Security — running 100% locally with zero AWS or Cloudflare.
            </p>
          </div>

          <div className="mt-8 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-teal-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> Quick Demo Accounts (Password: DemoPassword123!)
            </div>
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => {
                  setMode('login');
                  setEmail(acc.email);
                  setPassword('DemoPassword123!');
                }}
                className="w-full text-left px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition border border-white/10"
              >
                <div className="text-sm font-semibold">{acc.label}</div>
                <div className="text-xs text-slate-300">
                  {acc.email} — {acc.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="p-8 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-6">
            <Lock className="w-5 h-5 text-[#0F766E]" />
            <h2 className="text-xl font-bold text-[#0B1C24]">
              {mode === 'login' ? 'Sign in to Control Room' : 'Create Factory Workspace'}
            </h2>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Organization / Plant Name</label>
                  <input
                    required
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Apex Steel Works"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Full Name</label>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Maria Silva"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Work Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white font-semibold text-sm transition disabled:opacity-60 cursor-pointer"
            >
              {busy ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Tenant Workspace'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            className="mt-5 text-xs font-semibold text-[#0F766E] hover:underline self-center cursor-pointer"
          >
            {mode === 'login' ? 'Need a new isolated factory tenant? Register here' : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
};
