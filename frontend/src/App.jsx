import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { SignIn, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react';
import FleetDashboard from './components/dashboard/FleetDashboard';
import AdminPanel from './components/admin/AdminPanel';
import CafeOpsConsole from './components/operations/CafeOpsConsole';
import { cafesApi, metricsApi } from './lib/api';
import { Spinner, Card, Button } from './components/shared';

const clerkEnabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const SELECTED_CAFE_STORAGE_KEY = 'menu.selectedCafeId';
const ADMIN_SIDEBAR_STORAGE_KEY = 'menu.adminSidebarCollapsed';

function getStoredCafeId() {
  try {
    const raw = window.localStorage.getItem(SELECTED_CAFE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

function storeCafeId(cafeId) {
  try {
    window.localStorage.setItem(SELECTED_CAFE_STORAGE_KEY, String(cafeId));
  } catch {
    // localStorage can fail in private mode; safe to ignore
  }
}

function readSidebarState() {
  try {
    return window.localStorage.getItem(ADMIN_SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function storeSidebarState(collapsed) {
  try {
    window.localStorage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // ignore storage issues
  }
}

function BrandMark() {
  return (
    <div className="w-12 h-12 rounded-[18px] bg-[#111111] text-white flex items-center justify-center text-xl font-bold shadow-sm">
      M
    </div>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function PrepIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
      <path d="M8 6h11" />
      <path d="M8 12h11" />
      <path d="M8 18h11" />
      <path d="M4 6h.01" strokeLinecap="round" />
      <path d="M4 12h.01" strokeLinecap="round" />
      <path d="M4 18h.01" strokeLinecap="round" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
      <path d="M12 3l7 4v5c0 5-3.5 7.5-7 9-3.5-1.5-7-4-7-9V7l7-4Z" />
      <path d="M12 9v6" />
      <path d="M9 12h6" />
    </svg>
  );
}

function ShellNavLink({ to, label, icon: Icon, collapsed }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => [
        'group flex items-center gap-3 rounded-[20px] px-3 py-3 transition-all duration-200',
        collapsed ? 'lg:justify-center lg:px-0' : '',
        isActive
          ? 'bg-slate-100 text-slate-950 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.9)]'
          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
      ].join(' ')}
    >
      {({ isActive }) => (
        <>
          <span className={[
            'flex h-10 w-10 items-center justify-center rounded-2xl border transition-colors duration-200',
            isActive ? 'border-blue-100 bg-blue-50 text-blue-600' : 'border-slate-200 bg-white text-slate-400 group-hover:text-slate-700'
          ].join(' ')}>
            <Icon />
          </span>
          <span className={['text-[15px] font-semibold tracking-[-0.01em]', collapsed ? 'lg:hidden' : ''].join(' ')}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function AdminSidebar({ authEnabled, collapsed, onToggle }) {
  const navItems = [
    { to: '/dashboard', label: 'Fleet HQ', icon: DashboardIcon },
    { to: '/kitchen', label: 'Cafe Ops', icon: PrepIcon },
    { to: '/admin', label: 'Cafe Setup', icon: AdminIcon }
  ];

  return (
    <aside className={[
      'relative overflow-visible bg-white border border-slate-200 rounded-[30px] p-4 flex flex-col gap-4 shrink-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
      collapsed ? 'lg:w-[108px]' : 'lg:w-[290px]',
      'w-full lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]'
    ].join(' ')}>
      <button
        type="button"
        onClick={onToggle}
        className={[
          'hidden lg:flex absolute top-6 h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-white transition-colors shadow-[0_1px_2px_rgba(15,23,42,0.06)]',
          collapsed ? 'lg:-right-4' : 'lg:right-5'
        ].join(' ')}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`}>
          <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className={['flex items-center min-w-0', collapsed ? 'lg:justify-center lg:min-h-[52px]' : 'justify-between gap-3 pr-12'].join(' ')}>
        <div className={['flex items-center gap-3 min-w-0', collapsed ? 'lg:justify-center lg:w-full' : ''].join(' ')}>
          <BrandMark />
          <div className={collapsed ? 'lg:hidden' : ''}>
            <p className="text-[18px] leading-none font-bold tracking-[-0.03em] text-slate-950">Menu</p>
            <p className="text-sm text-slate-400 mt-1">Admin console</p>
          </div>
        </div>
      </div>

      <div className="h-px bg-slate-100" />

      <div className="flex flex-col lg:flex-1 gap-2">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2">
          {navItems.map((item) => (
            <ShellNavLink key={item.to} {...item} collapsed={collapsed} />
          ))}
        </div>

        <div className={['pt-4 mt-2 border-t border-slate-100', collapsed ? 'lg:hidden' : ''].join(' ')}>
          <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-400 mb-3">Workspace</p>
          <div className="space-y-3 text-sm text-slate-500">
            <p>Prep automation</p>
            <p>Forecasting</p>
            <p>Owner access</p>
          </div>
        </div>
      </div>

      <div className="mt-auto pt-4 border-t border-slate-100 flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-slate-950 text-white flex items-center justify-center text-sm font-bold">M</div>
        <div className={collapsed ? 'lg:hidden' : 'min-w-0'}>
          <p className="text-sm font-semibold text-slate-900 truncate">Admin workspace</p>
          <p className="text-xs text-slate-400 truncate">{authEnabled ? 'Fleet + support tools' : 'Guest mode'}</p>
        </div>
      </div>
    </aside>
  );
}

function pageMetaForPath(pathname) {
  if (pathname.includes('/kitchen')) {
    return {
      eyebrow: 'Operations',
      title: 'Cafe Operations',
      subtitle: 'Monitor every cafe, prioritize interventions, and drill into a live workspace only when needed.'
    };
  }

  if (pathname.includes('/admin')) {
    return {
      eyebrow: 'Management',
      title: 'Cafe Setup',
      subtitle: 'Manage cafes, owners, recipes, and operational settings.'
    };
  }

  return {
    eyebrow: 'Overview',
    title: 'Fleet HQ',
    subtitle: 'Monitor savings, health, ML performance, and support actions across every cafe.'
  };
}

function NoCafeState() {
  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <Card className="p-10 text-center">
        <h2 className="text-2xl font-bold tracking-[-0.03em] text-slate-950 mb-2">No cafe found yet</h2>
        <p className="text-sm text-slate-500 mb-6">
          Add your first cafe in Admin to start generating prep lists and forecasts.
        </p>
        <Button onClick={() => { window.location.hash = '/admin'; }}>
          Go to Admin
        </Button>
      </Card>
    </div>
  );
}

function ShellHeader({ cafe, authEnabled }) {
  const location = useLocation();
  const meta = pageMetaForPath(location.pathname);
  const showCafeChip = false;

  return (
    <Card className="px-6 py-5">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-400 mb-2">{meta.eyebrow}</p>
          <h1 className="text-[32px] leading-none font-bold tracking-[-0.04em] text-slate-950">{meta.title}</h1>
          <p className="text-sm text-slate-500 mt-2">{meta.subtitle}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap xl:justify-end">
          {showCafeChip && cafe && (
            <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
              {cafe.name}
            </div>
          )}
          {!authEnabled && (
            <div className="inline-flex items-center rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700">
              Guest mode
            </div>
          )}
          {authEnabled ? (
            <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-2 py-2">
              <UserButton afterSignOutUrl="/" />
            </div>
          ) : (
            <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-400">
              No auth configured
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function AppShell({ cafe, authEnabled, onCafeChange }) {
  const [collapsed, setCollapsed] = useState(() => readSidebarState());

  useEffect(() => {
    storeSidebarState(collapsed);
  }, [collapsed]);

  return (
    <div className="min-h-screen bg-[#edf2f7] p-4 md:p-5">
      <div className="max-w-[1600px] mx-auto flex flex-col lg:flex-row gap-5">
        <AdminSidebar
          authEnabled={authEnabled}
          collapsed={collapsed}
          onToggle={() => setCollapsed((prev) => !prev)}
        />

        <div className="flex-1 min-w-0 flex flex-col gap-5">
          <ShellHeader cafe={cafe} authEnabled={authEnabled} />
          <main className="min-w-0">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route
                path="/dashboard"
                element={<FleetDashboard selectedCafe={cafe} onSelectCafe={onCafeChange} />}
              />
              <Route
                path="/kitchen"
                element={<CafeOpsConsole selectedCafe={cafe} onSelectCafe={onCafeChange} />}
              />
              <Route path="/admin" element={<AdminPanel onCafeChange={onCafeChange} currentCafeId={cafe?.id} />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}

function AppContent({ authEnabled }) {
  const [cafe, setCafe] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadCafe() {
      try {
        const cafes = await cafesApi.getAll({ includeInactive: true });
        if (!cafes.length) return;

        const storedCafeId = getStoredCafeId();
        let selectedCafe = cafes.find(c => c.id === storedCafeId) || null;

        if (!selectedCafe) {
          const cafesWithScores = await Promise.all(
            cafes.map(async (currentCafe) => {
              try {
                const metrics = await metricsApi.get(currentCafe.id);
                return { cafe: currentCafe, score: Number(metrics?.daysRunning || 0) };
              } catch {
                return { cafe: currentCafe, score: 0 };
              }
            })
          );

          selectedCafe = cafesWithScores.sort((a, b) => b.score - a.score)[0]?.cafe || cafes[0];
        }

        if (!cancelled && selectedCafe) {
          setCafe(selectedCafe);
          storeCafeId(selectedCafe.id);
        }
      } catch {
        // keep guest flow resilient if initial API requests fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadCafe();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    async function syncCafeFromSelection() {
      const selectedCafeId = getStoredCafeId();
      if (!selectedCafeId || selectedCafeId === cafe?.id) return;

      try {
        const selectedCafe = await cafesApi.getOne(selectedCafeId);
        setCafe(selectedCafe);
      } catch {
        // ignore stale selected IDs and keep current cafe
      }
    }

    window.addEventListener('menu:cafe-selected', syncCafeFromSelection);
    window.addEventListener('hashchange', syncCafeFromSelection);

    return () => {
      window.removeEventListener('menu:cafe-selected', syncCafeFromSelection);
      window.removeEventListener('hashchange', syncCafeFromSelection);
    };
  }, [cafe?.id]);

  const handleCafeChange = (nextCafe) => {
    setCafe(nextCafe || null);
    if (nextCafe?.id) storeCafeId(nextCafe.id);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#edf2f7]">
        <Spinner />
      </div>
    );
  }

  return (
    <Router>
      <AppShell cafe={cafe} authEnabled={authEnabled} onCafeChange={handleCafeChange} />
    </Router>
  );
}

function LoginPage() {
  return (
    <div className="min-h-screen bg-[#edf2f7] flex items-center justify-center p-4">
      <div className="w-full max-w-[520px]">
        <Card className="p-8 md:p-10">
          <div className="flex items-center gap-4 mb-8">
            <BrandMark />
            <div>
              <h1 className="text-[28px] leading-none font-bold tracking-[-0.04em] text-slate-950">Menu</h1>
              <p className="text-sm text-slate-500 mt-2">Cafe operations intelligence for prep, waste, and forecasting.</p>
            </div>
          </div>
          <SignIn routing="hash" />
        </Card>
      </div>
    </div>
  );
}

export default function App() {
  if (!clerkEnabled) {
    return <AppContent authEnabled={false} />;
  }

  return (
    <>
      <SignedOut>
        <LoginPage />
      </SignedOut>
      <SignedIn>
        <AppContent authEnabled />
      </SignedIn>
    </>
  );
}
