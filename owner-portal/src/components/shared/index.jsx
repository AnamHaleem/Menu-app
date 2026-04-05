import React from 'react';

const DATE_INPUT_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

function clampDateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return DATE_INPUT_FORMATTER.format(date);
}

export function buildRelativeDateRange(days = 30, endDate = DATE_INPUT_FORMATTER.format(new Date())) {
  const safeDays = Math.max(1, Number(days) || 30);
  const safeEnd = clampDateInput(endDate) || DATE_INPUT_FORMATTER.format(new Date());

  return {
    startDate: shiftDate(safeEnd, -(safeDays - 1)),
    endDate: safeEnd
  };
}

export function formatDateRangeLabel(startDate, endDate) {
  const safeStart = clampDateInput(startDate);
  const safeEnd = clampDateInput(endDate);

  if (!safeStart && !safeEnd) return 'All time';
  if (safeStart && safeEnd) {
    const start = new Date(`${safeStart}T12:00:00`);
    const end = new Date(`${safeEnd}T12:00:00`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return `${DATE_LABEL_FORMATTER.format(start)} – ${DATE_LABEL_FORMATTER.format(end)}`;
    }
  }
  return safeStart || safeEnd || 'All time';
}

export function DateRangePicker({
  value,
  onChange,
  className = '',
  includeAllTime = true
}) {
  const current = value || { startDate: '', endDate: '' };
  const presets = [
    { label: '7D', value: buildRelativeDateRange(7) },
    { label: '30D', value: buildRelativeDateRange(30) },
    { label: '90D', value: buildRelativeDateRange(90) }
  ];

  const handleChange = (key, nextValue) => {
    const normalizedValue = clampDateInput(nextValue);
    const updated = { ...current, [key]: normalizedValue };

    if (updated.startDate && updated.endDate && updated.startDate > updated.endDate) {
      if (key === 'startDate') updated.endDate = updated.startDate;
      if (key === 'endDate') updated.startDate = updated.endDate;
    }

    onChange?.(updated);
  };

  const isPresetActive = (preset) =>
    preset.value.startDate === current.startDate && preset.value.endDate === current.endDate;

  return (
    <div className={`bg-white rounded-[24px] border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 ${className}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] text-slate-400 uppercase tracking-[0.18em] font-semibold">Analysis window</p>
          <p className="text-sm font-semibold text-slate-800 mt-1">{formatDateRangeLabel(current.startDate, current.endDate)}</p>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-[11px] text-slate-400 mb-1.5 uppercase tracking-[0.14em] font-semibold">From</span>
              <input
                type="date"
                value={current.startDate}
                onChange={(event) => handleChange('startDate', event.target.value)}
                className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm text-slate-700 bg-white focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-slate-400 mb-1.5 uppercase tracking-[0.14em] font-semibold">To</span>
              <input
                type="date"
                value={current.endDate}
                onChange={(event) => handleChange('endDate', event.target.value)}
                className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm text-slate-700 bg-white focus:outline-none focus:border-blue-500"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.label}
                size="sm"
                variant={isPresetActive(preset) ? 'primary' : 'secondary'}
                onClick={() => onChange?.(preset.value)}
              >
                {preset.label}
              </Button>
            ))}
            {includeAllTime && (
              <Button
                size="sm"
                variant={!current.startDate && !current.endDate ? 'primary' : 'secondary'}
                onClick={() => onChange?.({ startDate: '', endDate: '' })}
              >
                All time
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MetricCard({ label, value, sub, color = 'text-navy-900' }) {
  return (
    <div className="bg-white rounded-[24px] border border-slate-200 p-5 flex flex-col gap-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="text-[11px] text-slate-400 uppercase tracking-[0.18em] font-semibold">{label}</p>
      <p className={`text-[1.9rem] leading-none font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function Badge({ children, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border border-blue-100',
    green: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
    red: 'bg-red-50 text-red-600 border border-red-100',
    gray: 'bg-slate-100 text-slate-600 border border-slate-200',
    amber: 'bg-amber-50 text-amber-700 border border-amber-100'
  };
  return (
    <span className={`inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full ${colors[color]}`}>
      {children}
    </span>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  );
}

export function SectionHeader({ title, action }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-[0.18em]">{title}</h2>
      {action}
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', size = 'md', disabled = false, className = '' }) {
  const base = 'inline-flex items-center justify-center rounded-2xl font-semibold transition-all duration-200 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.18)] hover:bg-blue-700 hover:-translate-y-px',
    secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:-translate-y-px',
    danger: 'bg-red-500 text-white hover:bg-red-600 hover:-translate-y-px',
    ghost: 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
  };
  const sizes = { sm: 'px-3.5 py-2 text-xs', md: 'px-4.5 py-2.5 text-sm', lg: 'px-6 py-3 text-base' };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-[28px] border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>
      {children}
    </div>
  );
}

export function Empty({ message = 'No data yet' }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
        <span className="text-slate-400 text-xl">—</span>
      </div>
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}
