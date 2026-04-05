import React from 'react';

function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function MetricCard({ label, value, sub, color = 'text-ink-900', accent = 'brand', className = '' }) {
  const accents = {
    brand: 'from-navy-100/90 via-white to-white',
    mint: 'from-teal-100/90 via-white to-white',
    coral: 'from-coral-100/90 via-white to-white',
    sand: 'from-sand-100/90 via-white to-white',
    neutral: 'from-ink-100 via-white to-white'
  };

  return (
    <div
      className={cx(
        'group relative overflow-hidden rounded-[28px] border border-white/70 bg-gradient-to-br p-5 shadow-soft backdrop-blur-xl transition duration-300 hover:-translate-y-0.5',
        accents[accent] || accents.brand,
        className
      )}
    >
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent" />
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-ink-500">{label}</p>
      <p className={cx('mt-3 font-display text-[2.2rem] leading-none md:text-[2.45rem]', color)}>{value}</p>
      {sub && <p className="mt-3 text-sm leading-relaxed text-ink-500">{sub}</p>}
    </div>
  );
}

export function Badge({ children, color = 'blue', className = '' }) {
  const colors = {
    blue: 'border border-navy-100 bg-navy-100/70 text-navy-900',
    green: 'border border-teal-100 bg-teal-100/80 text-teal-600',
    red: 'border border-red-100 bg-red-50 text-red-600',
    gray: 'border border-ink-200 bg-white/70 text-ink-700',
    amber: 'border border-sand-100 bg-sand-100/80 text-amber-700'
  };

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em]',
        colors[color] || colors.blue,
        className
      )}
    >
      {children}
    </span>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-10">
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 rounded-full border border-navy-100/80" />
        <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-navy-900 border-r-teal-600 animate-spin" />
        <div className="absolute inset-[0.95rem] rounded-full bg-white/90 shadow-inner" />
      </div>
    </div>
  );
}

export function SectionHeader({ title, action, subtitle = null }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-ink-500">{title}</p>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  className = '',
  type = 'button'
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full border font-semibold transition duration-200 focus:outline-none focus:ring-4 focus:ring-navy-100 disabled:pointer-events-none disabled:opacity-45';
  const variants = {
    primary: 'border-transparent bg-ink-950 text-white shadow-lg shadow-slate-900/15 hover:-translate-y-0.5 hover:bg-navy-900',
    secondary: 'border-white/80 bg-white/75 text-ink-700 shadow-soft hover:-translate-y-0.5 hover:border-white hover:bg-white',
    danger: 'border-transparent bg-red-500 text-white shadow-lg shadow-red-500/15 hover:-translate-y-0.5 hover:bg-red-600',
    ghost: 'border-transparent bg-transparent text-ink-500 hover:bg-white/75 hover:text-ink-900'
  };
  const sizes = {
    sm: 'px-3.5 py-2 text-xs',
    md: 'px-4.5 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base'
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(base, variants[variant] || variants.primary, sizes[size] || sizes.md, className)}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }) {
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-[30px] border border-white/75 bg-white/75 shadow-soft backdrop-blur-xl',
        className
      )}
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent" />
      {children}
    </div>
  );
}

export function Empty({ message = 'No data yet', title = 'Nothing here yet' }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[1.35rem] bg-gradient-to-br from-navy-100 to-teal-100 text-lg font-display font-bold text-navy-900 shadow-soft">
        M
      </div>
      <p className="text-base font-semibold text-ink-900">{title}</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-500">{message}</p>
    </div>
  );
}
