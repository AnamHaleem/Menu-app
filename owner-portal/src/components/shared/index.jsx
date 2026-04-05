import React from 'react';

function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

const accentStyles = {
  brand: {
    background: 'linear-gradient(135deg, var(--menu-accent-brand-start), var(--menu-accent-brand-mid), var(--menu-accent-brand-end))'
  },
  mint: {
    background: 'linear-gradient(135deg, var(--menu-accent-mint-start), var(--menu-accent-mint-mid), var(--menu-accent-mint-end))'
  },
  coral: {
    background: 'linear-gradient(135deg, var(--menu-accent-coral-start), var(--menu-accent-coral-mid), var(--menu-accent-coral-end))'
  },
  sand: {
    background: 'linear-gradient(135deg, var(--menu-accent-sand-start), var(--menu-accent-sand-mid), var(--menu-accent-sand-end))'
  },
  neutral: {
    background: 'linear-gradient(135deg, var(--menu-accent-neutral-start), var(--menu-accent-neutral-mid), var(--menu-accent-neutral-end))'
  }
};

const badgeStyles = {
  blue: {
    backgroundColor: 'var(--menu-badge-blue-bg)',
    borderColor: 'var(--menu-badge-blue-border)',
    color: 'var(--menu-badge-blue-text)'
  },
  green: {
    backgroundColor: 'var(--menu-badge-green-bg)',
    borderColor: 'var(--menu-badge-green-border)',
    color: 'var(--menu-badge-green-text)'
  },
  red: {
    backgroundColor: 'var(--menu-badge-red-bg)',
    borderColor: 'var(--menu-badge-red-border)',
    color: 'var(--menu-badge-red-text)'
  },
  gray: {
    backgroundColor: 'var(--menu-badge-gray-bg)',
    borderColor: 'var(--menu-badge-gray-border)',
    color: 'var(--menu-badge-gray-text)'
  },
  amber: {
    backgroundColor: 'var(--menu-badge-amber-bg)',
    borderColor: 'var(--menu-badge-amber-border)',
    color: 'var(--menu-badge-amber-text)'
  }
};

export function MetricCard({ label, value, sub, color = 'text-ink-900', accent = 'brand', className = '' }) {
  return (
    <div
      style={accentStyles[accent] || accentStyles.brand}
      className={cx(
        'theme-card group relative overflow-hidden rounded-[28px] border p-5 backdrop-blur-xl transition duration-300 hover:-translate-y-0.5',
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
  return (
    <span
      style={badgeStyles[color] || badgeStyles.blue}
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em]',
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
        <div className="absolute inset-0 rounded-full border" style={{ borderColor: 'var(--menu-border)' }} />
        <div
          className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent"
          style={{ borderTopColor: 'var(--menu-brand)', borderRightColor: 'var(--menu-mint)' }}
        />
        <div
          className="absolute inset-[0.95rem] rounded-full shadow-inner"
          style={{ backgroundColor: 'var(--menu-panel-strong)' }}
        />
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
    'theme-button inline-flex items-center justify-center gap-2 rounded-full border font-semibold leading-none transition duration-200 focus:outline-none disabled:pointer-events-none disabled:opacity-45';
  const variants = {
    primary: 'theme-button--primary hover:-translate-y-0.5',
    secondary: 'theme-button--secondary hover:-translate-y-0.5',
    danger: 'theme-button--danger hover:-translate-y-0.5',
    ghost: 'theme-button--ghost'
  };
  const sizes = {
    sm: 'px-5 py-3 text-xs',
    md: 'px-7 py-3.5 text-sm',
    lg: 'px-9 py-4 text-base'
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

export function Card({ children, className = '', tone = 'default' }) {
  return (
    <div
      className={cx(
        'theme-card relative overflow-hidden rounded-[30px] border backdrop-blur-xl',
        tone === 'dark' && 'theme-card-dark',
        className
      )}
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent" />
      {children}
    </div>
  );
}

export function ThemeToggle({ theme = 'light', onThemeChange, size = 'md', className = '' }) {
  const options = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];

  return (
    <div className={cx('theme-toggle', size === 'sm' && 'theme-toggle--sm', className)} role="group" aria-label="Color theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onThemeChange?.(option.value)}
          aria-pressed={theme === option.value}
          className={cx('theme-toggle-button', size === 'sm' && 'theme-toggle-button--sm', theme === option.value && 'is-active')}
        >
          {option.label}
        </button>
      ))}
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
