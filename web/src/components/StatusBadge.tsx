import React from 'react';

const STYLES: Record<string, string> = {
  NOMINAL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  online: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  A: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  B: 'bg-teal-50 text-teal-700 border-teal-200',
  WARNING: 'bg-amber-50 text-amber-800 border-amber-200',
  acknowledged: 'bg-amber-50 text-amber-800 border-amber-200',
  in_progress: 'bg-sky-50 text-sky-800 border-sky-200',
  MAINTENANCE: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  C: 'bg-amber-50 text-amber-800 border-amber-200',
  CRITICAL: 'bg-red-50 text-red-700 border-red-200',
  open: 'bg-red-50 text-red-700 border-red-200',
  offline: 'bg-slate-200 text-slate-700 border-slate-300',
  OFFLINE: 'bg-slate-200 text-slate-700 border-slate-300',
  D: 'bg-red-50 text-red-700 border-red-200',
  provisioned: 'bg-slate-100 text-slate-600 border-slate-200',
  false_positive: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const StatusBadge: React.FC<{ value: string; prefix?: string }> = ({ value, prefix }) => {
  const cls = STYLES[value] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {prefix ? `${prefix} ` : ''}
      {value}
    </span>
  );
};
