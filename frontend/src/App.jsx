import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { SignIn, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react';
import OwnerDashboard from './components/dashboard/OwnerDashboard';
import KitchenView from './components/kitchen/KitchenView';
import AdminPanel from './components/admin/AdminPanel';
import { cafesApi, metricsApi } from './lib/api';
import { Spinner, Card, Button, Badge, ThemeToggle } from './components/shared';
import { getPreferredTheme, persistTheme } from './lib/theme';

const clerkEnabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const SELECTED_CAFE_STORAGE_KEY = 'menu.selectedCafeId';

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

function Nav({ cafe, authEnabled, theme, onThemeChange }) {
  const [isCompact, setIsCompact] = useState(false);
  const links = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/kitchen', label: 'Kitchen' },
    { to: '/admin', label: 'Admin' }
  ];

  useEffect(() => {
    const handleScroll = () => {
      setIsCompact(window.scrollY > 24);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <header
      className={[
        'sticky top-0 z-50 px-3 transition-all duration-300 md:px-5',
        isCompact ? 'pt-1.5 md:pt-2' : 'pt-3 md:pt-4'
      ].join(' ')}
    >
      <nav
        className={[
          'mx-auto max-w-7xl border border-white/80 bg-white/70 backdrop-blur-xl transition-all duration-300',
          isCompact ? 'rounded-[24px] px-4 py-3 shadow-float' : 'rounded-[32px] px-4 py-4 shadow-soft md:px-5'
        ].join(' ')}
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center xl:flex-nowrap">
            <div className="flex items-center gap-3">
              <div
                className={[
                  'menu-floating-accent flex items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-navy-900 via-navy-700 to-teal-600 font-display font-bold text-white shadow-glow transition-all duration-300',
                  isCompact ? 'h-10 w-10 text-base' : 'h-12 w-12 text-lg'
                ].join(' ')}
              >
                M
              </div>
              <div>
                <p className={['font-display font-semibold leading-none text-ink-950 transition-all duration-300', isCompact ? 'text-lg' : 'text-xl'].join(' ')}>
                  Menu
                </p>
                <p className={['mt-1 text-ink-500 transition-all duration-300', isCompact ? 'text-xs' : 'text-sm'].join(' ')}>
                  Cafe operations intelligence
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {cafe && (
                <div
                  className={[
                    'inline-flex items-center gap-3 rounded-full border border-white/80 bg-white/70 shadow-sm whitespace-nowrap transition-all duration-300',
                    isCompact ? 'px-3 py-1.5' : 'px-4 py-2'
                  ].join(' ')}
                >
                  <span className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-ink-500">Active cafe</span>
                  <span className="font-semibold text-ink-900">{cafe.name}</span>
                </div>
              )}
              {!authEnabled && <Badge color="amber" className={isCompact ? 'px-3 py-1' : ''}>Guest Mode</Badge>}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:ml-auto xl:flex-nowrap">
            <div
              className={[
                'flex flex-nowrap items-center gap-1 overflow-x-auto rounded-[1.15rem] border border-white/80 bg-slate-50/70 shadow-sm whitespace-nowrap transition-all duration-300',
                isCompact ? 'p-1' : 'p-1.5'
              ].join(' ')}
            >
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) =>
                    [
                      'rounded-full font-semibold transition duration-200 whitespace-nowrap',
                      isCompact ? 'px-3 py-1.5 text-[0.82rem]' : 'px-4 py-2 text-sm',
                      isActive
                        ? 'bg-ink-950 text-white shadow-lg shadow-slate-900/15'
                        : 'text-ink-500 hover:bg-white hover:text-ink-900'
                    ].join(' ')
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </div>

            <ThemeToggle theme={theme} onThemeChange={onThemeChange} size="sm" className="shrink-0" />

            {authEnabled ? (
              <div className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/75 p-1.5 shadow-sm">
                <UserButton afterSignOutUrl="/" />
              </div>
            ) : (
              <div
                className={[
                  'inline-flex shrink-0 items-center rounded-full border border-white/80 bg-white/75 font-medium text-ink-500 shadow-sm transition-all duration-300',
                  isCompact ? 'px-3 py-1.5 text-[0.7rem]' : 'px-4 py-2 text-xs'
                ].join(' ')}
              >
                No auth configured
              </div>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}

function NoCafeState() {
  return (
    <div className="app-page">
      <Card className="menu-hero-card p-8 md:p-10">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <span className="menu-eyebrow">Setup required</span>
            <h2 className="mt-5 max-w-xl font-display text-3xl font-semibold tracking-tight text-ink-950 md:text-[2.6rem]">
              Add your first cafe to start generating prep lists, forecasts, and daily savings insights.
            </h2>
            <p className="mt-4 max-w-lg text-base leading-7 text-ink-500">
              The admin workspace is ready. Once a cafe is added, Menu can begin routing forecasting, kitchen prep, and owner reporting through the rest of the experience.
            </p>
            <div className="mt-8 flex flex-wrap gap-4 rounded-[24px] bg-white/65 p-2">
              <Button onClick={() => { window.location.hash = '/admin'; }} size="lg">
                Open Admin Setup
              </Button>
              <Button variant="secondary" size="lg" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                Review shell
              </Button>
            </div>
          </div>

          <div className="rounded-[28px] bg-ink-950 p-6 text-white shadow-float">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-white/50">What unlocks next</p>
            <div className="mt-6 space-y-4">
              {[
                'Forecast-aware prep recommendations for each day.',
                'Kitchen tracking with completion and actual prep logging.',
                'Owner metrics across waste, labour savings, and incident trends.'
              ].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <div className="mt-1 h-2.5 w-2.5 rounded-full bg-gradient-to-br from-teal-600 to-navy-700" />
                  <p className="text-sm leading-6 text-white/80">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function AppShell({ cafe, authEnabled, onCafeChange, theme, onThemeChange }) {
  return (
    <>
      <Nav cafe={cafe} authEnabled={authEnabled} theme={theme} onThemeChange={onThemeChange} />
      <main className="min-h-screen pb-12">
        <Routes>
          <Route path="/" element={<Navigate to={cafe ? '/dashboard' : '/admin'} replace />} />
          <Route
            path="/dashboard"
            element={cafe ? <OwnerDashboard cafeId={cafe.id} cafeName={cafe.name || 'Your Cafe'} /> : <NoCafeState />}
          />
          <Route
            path="/kitchen"
            element={cafe ? <KitchenView cafeId={cafe.id} cafeName={cafe.name || 'Your Cafe'} /> : <NoCafeState />}
          />
          <Route path="/admin" element={<AdminPanel onCafeChange={onCafeChange} currentCafeId={cafe?.id} />} />
          <Route path="*" element={<Navigate to={cafe ? '/dashboard' : '/admin'} replace />} />
        </Routes>
      </main>
    </>
  );
}

function AppContent({ authEnabled, theme, onThemeChange }) {
  const [cafe, setCafe] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadCafe() {
      try {
        const cafes = await cafesApi.getAll();
        if (!cafes.length) return;

        const storedCafeId = getStoredCafeId();
        let selectedCafe = cafes.find((currentCafe) => currentCafe.id === storedCafeId) || null;

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
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-[1.6rem] bg-gradient-to-br from-navy-900 via-navy-700 to-teal-600 text-2xl font-display font-bold text-white shadow-glow">
          M
        </div>
        <p className="text-sm font-medium text-ink-500">Loading your operations workspace</p>
        <Spinner />
      </div>
    );
  }

  return (
    <Router>
      <AppShell
        cafe={cafe}
        authEnabled={authEnabled}
        onCafeChange={handleCafeChange}
        theme={theme}
        onThemeChange={onThemeChange}
      />
    </Router>
  );
}

function LoginPage({ theme, onThemeChange }) {
  return (
    <div className="min-h-screen px-4 py-8 md:px-6">
      <div className="mx-auto mb-4 flex max-w-6xl justify-end">
        <ThemeToggle theme={theme} onThemeChange={onThemeChange} />
      </div>

      <div className="mx-auto grid min-h-[calc(100vh-8rem)] max-w-6xl items-center gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card tone="dark" className="menu-hero-card p-8 md:p-12">
          <span className="menu-eyebrow border-white/10 bg-white/10 text-white/70">Operations suite</span>
          <h1 className="mt-6 max-w-xl font-display text-4xl font-semibold tracking-tight text-white md:text-[3.4rem]">
            A calmer daily operating system for modern cafes.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-white/70">
            Forecast smarter, prep cleaner, and keep owners aligned with a control surface that feels as sharp as the service it supports.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[26px] border border-white/10 bg-white/10 p-5">
              <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/50">Daily pulse</p>
              <p className="mt-3 font-display text-3xl text-white">Forecast + prep</p>
              <p className="mt-2 text-sm leading-6 text-white/70">Kitchen-ready recommendations with weather and holiday awareness.</p>
            </div>
            <div className="rounded-[26px] border border-white/10 bg-white/10 p-5">
              <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/50">Owner clarity</p>
              <p className="mt-3 font-display text-3xl text-white">Metrics that matter</p>
              <p className="mt-2 text-sm leading-6 text-white/70">See waste reduction, labour savings, and risk trends at a glance.</p>
            </div>
          </div>
        </Card>

        <Card className="menu-hero-card p-5 md:p-8">
          <div className="mx-auto max-w-md">
            <span className="menu-eyebrow">Secure access</span>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-ink-950">Sign in to Menu</h2>
            <p className="mt-3 text-sm leading-6 text-ink-500">
              Owners and operators can access dashboard, kitchen, and admin workflows from a single modern workspace.
            </p>
            <div className="mt-6 flex justify-center">
              <SignIn routing="hash" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(getPreferredTheme);

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

  if (!clerkEnabled) {
    return <AppContent authEnabled={false} theme={theme} onThemeChange={setTheme} />;
  }

  return (
    <>
      <SignedOut>
        <LoginPage theme={theme} onThemeChange={setTheme} />
      </SignedOut>
      <SignedIn>
        <AppContent authEnabled theme={theme} onThemeChange={setTheme} />
      </SignedIn>
    </>
  );
}
