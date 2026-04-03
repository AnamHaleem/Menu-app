import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { SignIn, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react';
import OwnerDashboard from './components/dashboard/OwnerDashboard';
import KitchenView from './components/kitchen/KitchenView';
import AdminPanel from './components/admin/AdminPanel';
import { cafesApi } from './lib/api';
import { Spinner, Card, Button } from './components/shared';

const clerkEnabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function Nav({ cafe, authEnabled }) {
  const links = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/kitchen', label: 'Kitchen' },
    { to: '/admin', label: 'Admin' }
  ];

  return (
    <nav className="bg-white border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 md:px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-navy-900" style={{ color: '#1F4E79' }}>Menu</span>
            {cafe && <span className="hidden md:block text-xs text-gray-400 border-l border-gray-200 pl-3">{cafe.name}</span>}
            {!authEnabled && (
              <span className="hidden md:block text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                Guest Mode
              </span>
            )}
          </div>
          <div className="flex gap-1">
            {links.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900'}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>
        </div>

        {authEnabled ? (
          <UserButton afterSignOutUrl="/" />
        ) : (
          <span className="text-xs text-gray-400">No auth configured</span>
        )}
      </div>
    </nav>
  );
}

function NoCafeState() {
  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <Card className="p-8 text-center">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No cafe found yet</h2>
        <p className="text-sm text-gray-500 mb-5">
          Add your first cafe in Admin to start generating prep lists and forecasts.
        </p>
        <Button onClick={() => { window.location.href = '/admin'; }}>
          Go to Admin
        </Button>
      </Card>
    </div>
  );
}

function AppContent({ authEnabled }) {
  const [cafe, setCafe] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cafesApi.getAll()
      .then(cafes => {
        if (cafes.length > 0) setCafe(cafes[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <Router>
      <Nav cafe={cafe} authEnabled={authEnabled} />
      <main className="min-h-screen bg-gray-50">
        {!cafe ? (
          <NoCafeState />
        ) : (
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/dashboard"
              element={<OwnerDashboard cafeId={cafe.id} cafeName={cafe.name || 'Your Cafe'} />}
            />
            <Route
              path="/kitchen"
              element={<KitchenView cafeId={cafe.id} cafeName={cafe.name || 'Your Cafe'} />}
            />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        )}
      </main>
    </Router>
  );
}

function LoginPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold text-gray-900" style={{ color: '#1F4E79' }}>Menu</h1>
        <p className="text-sm text-gray-400 mt-1">Cafe operations intelligence</p>
      </div>
      <SignIn routing="hash" />
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
