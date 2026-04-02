import React from 'react';

export function MetricCard({ label, value, sub, color = 'text-navy-900' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-1 shadow-sm">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-3xl font-semibold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export function Badge({ children, color = 'blue' }) {
  const colors = {
    blue: 'bg-navy-100 text-navy-900',
    green: 'bg-teal-100 text-teal-600',
    red: 'bg-red-50 text-red-600',
    gray: 'bg-gray-100 text-gray-600',
    amber: 'bg-amber-50 text-amber-700'
  };
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${colors[color]}`}>
      {children}
    </span>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="w-8 h-8 border-4 border-navy-100 border-t-navy-900 rounded-full animate-spin" />
    </div>
  );
}

export function SectionHeader({ title, action }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{title}</h2>
      {action}
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', size = 'md', disabled = false, className = '' }) {
  const base = 'rounded-lg font-medium transition-all focus:outline-none';
  const variants = {
    primary: 'bg-navy-900 text-white hover:bg-navy-700 disabled:opacity-40',
    secondary: 'border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40',
    danger: 'bg-red-500 text-white hover:bg-red-600 disabled:opacity-40',
    ghost: 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };
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
    <div className={`bg-white rounded-xl border border-gray-100 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Empty({ message = 'No data yet' }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <span className="text-gray-400 text-xl">—</span>
      </div>
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}
