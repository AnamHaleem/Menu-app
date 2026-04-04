import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import OwnerDashboard from '../dashboard/OwnerDashboard';
import KitchenView from '../kitchen/KitchenView';
import { Button, Card, Spinner } from '../shared';
import { ownerAuthApi, ownerPortalApi } from '../../lib/api';

const OWNER_SELECTED_CAFE_KEY = 'menu.ownerSelectedCafeId';

function readOwnerSelectedCafeId() {
  try {
    const raw = window.localStorage.getItem(OWNER_SELECTED_CAFE_KEY);
    const parsed = parseInt(raw || '', 10);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

function storeOwnerSelectedCafeId(cafeId) {
  try {
    if (cafeId) {
      window.localStorage.setItem(OWNER_SELECTED_CAFE_KEY, String(cafeId));
    } else {
      window.localStorage.removeItem(OWNER_SELECTED_CAFE_KEY);
    }
  } catch {
    // ignore private mode storage errors
  }
}

export default function OwnerPortal() {
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [selectedCafeId, setSelectedCafeId] = useState(readOwnerSelectedCafeId());

  useEffect(() => {
    let cancelled = false;

    async function bootstrapOwnerSession() {
      const token = ownerAuthApi.getStoredToken();
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const session = await ownerAuthApi.me();
        if (!cancelled) {
          setOwner(session);
          setSelectedCafeId((current) => current || session?.cafes?.[0]?.id || null);
        }
      } catch {
        ownerAuthApi.clearStoredToken();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrapOwnerSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedCafeId) {
      storeOwnerSelectedCafeId(selectedCafeId);
    }
  }, [selectedCafeId]);

  const cafes = owner?.cafes || [];
  const selectedCafe = useMemo(() => {
    if (!cafes.length) return null;
    return cafes.find((cafe) => cafe.id === selectedCafeId) || cafes[0];
  }, [cafes, selectedCafeId]);

  useEffect(() => {
    if (selectedCafe?.id && selectedCafeId !== selectedCafe.id) {
      setSelectedCafeId(selectedCafe.id);
    }
  }, [selectedCafe, selectedCafeId]);

  const handleRequestCode = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await ownerAuthApi.requestCode(email.trim());
      setCodeSent(true);
      setInfo('Verification code sent to your email.');
    } catch (err) {
      const apiMessage = err?.response?.data?.error;
      setError(apiMessage || 'Could not send code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCode = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const result = await ownerAuthApi.verifyCode(email.trim(), code.trim());
      setOwner(result?.owner || null);
      setSelectedCafeId(result?.owner?.cafes?.[0]?.id || null);
      setCode('');
      setCodeSent(false);
      setInfo('');
    } catch (err) {
      const apiMessage = err?.response?.data?.error;
      setError(apiMessage || 'Could not verify code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = () => {
    ownerAuthApi.clearStoredToken();
    setOwner(null);
    setEmail('');
    setCode('');
    setCodeSent(false);
    setSelectedCafeId(null);
    storeOwnerSelectedCafeId(null);
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!owner) {
    return (
      <div className="p-4 md:p-6 max-w-xl mx-auto">
        <Card className="p-7">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Cafe owner sign-in</h2>
          <p className="text-sm text-gray-500 mb-5">
            Enter your owner or kitchen lead email. We will send a 6-digit sign-in code.
          </p>

          <div className="mb-3">
            <label className="block text-xs text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@yourcafe.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
            />
          </div>

          {codeSent && (
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">6-digit code</label>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tracking-[0.2em] focus:outline-none focus:border-navy-900"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          {info && <p className="text-sm text-teal-700 mb-3">{info}</p>}

          <div className="flex flex-wrap gap-2">
            {codeSent ? (
              <>
                <Button onClick={handleVerifyCode} disabled={busy || code.length !== 6}>
                  {busy ? 'Verifying...' : 'Verify & sign in'}
                </Button>
                <Button variant="secondary" onClick={handleRequestCode} disabled={busy || !email.trim()}>
                  {busy ? 'Sending...' : 'Resend code'}
                </Button>
              </>
            ) : (
              <Button onClick={handleRequestCode} disabled={busy || !email.trim()}>
                {busy ? 'Sending...' : 'Send code'}
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  if (!selectedCafe) {
    return (
      <div className="p-4 md:p-6 max-w-xl mx-auto">
        <Card className="p-7">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No active cafes found</h2>
          <p className="text-sm text-gray-500 mb-5">
            This owner account is signed in, but no active cafes are linked right now.
          </p>
          <Button onClick={handleSignOut}>Sign out</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <Card className="p-4 mb-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <p className="text-sm text-gray-400">Signed in as</p>
            <p className="text-sm font-medium text-gray-900">{owner.email}</p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Cafe</label>
            <select
              value={selectedCafe.id}
              onChange={(event) => setSelectedCafeId(parseInt(event.target.value, 10))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
            >
              {cafes.map((cafe) => (
                <option key={cafe.id} value={cafe.id}>
                  {cafe.name} ({cafe.city || 'Toronto'})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <NavLink
              to="dashboard"
              className={({ isActive }) =>
                `px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900'}`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="kitchen"
              className={({ isActive }) =>
                `px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900'}`
              }
            >
              Kitchen
            </NavLink>
            <Button size="sm" variant="ghost" onClick={handleSignOut}>Sign out</Button>
          </div>
        </div>
      </Card>

      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route
          path="dashboard"
          element={<OwnerDashboard cafeId={selectedCafe.id} cafeName={selectedCafe.name} dataApi={ownerPortalApi} />}
        />
        <Route
          path="kitchen"
          element={<KitchenView cafeId={selectedCafe.id} cafeName={selectedCafe.name} dataApi={ownerPortalApi} />}
        />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </div>
  );
}
