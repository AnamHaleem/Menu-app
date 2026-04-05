import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import OwnerDashboard from '../dashboard/OwnerDashboard';
import KitchenView from '../kitchen/KitchenView';
import OwnerSettings from '../settings/OwnerSettings';
import { Button, Card, Spinner } from '../shared';
import { ownerAuthApi, ownerPortalApi } from '../../lib/api';

const OWNER_SELECTED_CAFE_KEY = 'menu.ownerSelectedCafeId';
const CANADIAN_PROVINCES = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' }
];

function formatCanadianPhoneInput(value) {
  return String(value || '')
    .replace(/[^\d+\-\s()]/g, '')
    .slice(0, 24);
}

function normalizeCanadianPhoneOnBlur(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';

  const tenDigits = digits.length === 11 && digits.startsWith('1')
    ? digits.slice(1)
    : digits.slice(0, 10);

  if (tenDigits.length !== 10) return String(value || '').trim();
  return `+1 ${tenDigits.slice(0, 3)}-${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}

function normalizePostalInput(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (raw.length <= 3) return raw;
  return `${raw.slice(0, 3)} ${raw.slice(3)}`;
}

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
  const [signInForm, setSignInForm] = useState({
    email: '',
    first_name: '',
    last_name: '',
    phone: '',
    secondary_phone: '',
    city: '',
    province: '',
    street_address: '',
    unit_number: '',
    postal_code: ''
  });
  const [emailCode, setEmailCode] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [requiresPhoneCode, setRequiresPhoneCode] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [missingProfileFields, setMissingProfileFields] = useState([]);
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [selectedCafeId, setSelectedCafeId] = useState(readOwnerSelectedCafeId());

  const applyOwnerSession = (session) => {
    setOwner(session || null);
    setSelectedCafeId((current) => {
      const cafes = session?.cafes || [];
      if (!cafes.length) return null;
      const existing = cafes.find((cafe) => cafe.id === current);
      return existing ? existing.id : cafes[0].id;
    });
  };

  const refreshOwnerSession = async () => {
    const session = await ownerAuthApi.me();
    applyOwnerSession(session);
    return session;
  };

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
          applyOwnerSession(session);
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
  const ownerDisplayName = [
    String(owner?.profile?.first_name || '').trim(),
    String(owner?.profile?.last_name || '').trim()
  ].filter(Boolean).join(' ')
    || String(owner?.profile?.full_name || '').trim()
    || owner?.email
    || 'Owner';
  const selectedCafe = useMemo(() => {
    if (!cafes.length) return null;
    return cafes.find((cafe) => cafe.id === selectedCafeId) || cafes[0];
  }, [cafes, selectedCafeId]);

  useEffect(() => {
    if (selectedCafe?.id && selectedCafeId !== selectedCafe.id) {
      setSelectedCafeId(selectedCafe.id);
    }
  }, [selectedCafe, selectedCafeId]);

  const handleFormChange = (key, value) => {
    let nextValue = value;
    if (key === 'phone' || key === 'secondary_phone') {
      nextValue = formatCanadianPhoneInput(value);
    }
    if (key === 'postal_code') {
      nextValue = normalizePostalInput(value);
    }
    if (key === 'province') {
      nextValue = String(value || '').toUpperCase();
    }

    setSignInForm((prev) => ({
      ...prev,
      [key]: nextValue
    }));
  };

  const requiredFormFields = [
    'email',
    'first_name',
    'last_name',
    'phone'
  ];

  const handleRequestCode = async () => {
    if (!String(signInForm.email || '').trim()) {
      setError('Email is required.');
      return;
    }

    if (needsProfile) {
      const missing = requiredFormFields.filter((key) => !String(signInForm[key] || '').trim());
      if (missing.length) {
        setError('Please complete all required profile fields before requesting sign-in codes.');
        setInfo('');
        setMissingProfileFields(missing);
        return;
      }
    }

    setBusy(true);
    setError('');
    setInfo('');
    try {
      const payload = needsProfile
        ? signInForm
        : { email: signInForm.email.trim() };
      const result = await ownerAuthApi.requestCode(payload);
      setCodeSent(true);
      setRequiresPhoneCode(Boolean(result?.requiresPhoneCode));
      setMissingProfileFields([]);
      setInfo(
        result?.message ||
        (result?.requiresPhoneCode
          ? 'Verification code sent to your email and phone.'
          : 'Verification code sent to your email.')
      );
    } catch (err) {
      const missingFields = err?.response?.data?.missingFields;
      if (Array.isArray(missingFields) && missingFields.length) {
        setNeedsProfile(true);
        setMissingProfileFields(missingFields);
        setError('First-time setup: complete your profile to continue.');
      } else {
        const apiMessage = err?.response?.data?.error;
        setError(apiMessage || 'Could not send code. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCode = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const result = await ownerAuthApi.verifyCode({
        email: signInForm.email.trim(),
        email_code: emailCode.trim(),
        phone_code: requiresPhoneCode ? phoneCode.trim() : ''
      });
      applyOwnerSession(result?.owner || null);
      setEmailCode('');
      setPhoneCode('');
      setCodeSent(false);
      setRequiresPhoneCode(false);
      setNeedsProfile(false);
      setMissingProfileFields([]);
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
    setSignInForm({
      email: '',
      first_name: '',
      last_name: '',
      phone: '',
      secondary_phone: '',
      city: '',
      province: '',
      street_address: '',
      unit_number: '',
      postal_code: ''
    });
    setEmailCode('');
    setPhoneCode('');
    setRequiresPhoneCode(false);
    setNeedsProfile(false);
    setMissingProfileFields([]);
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
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <Card className="p-7">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Cafe owner sign-in</h2>
          <p className="text-sm text-gray-500 mb-5">
            Enter your email to continue. First-time owners will complete profile setup once.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Email *</label>
              <input
                type="email"
                value={signInForm.email}
                onChange={(event) => handleFormChange('email', event.target.value)}
                placeholder="you@yourcafe.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
              />
            </div>

            {needsProfile && (
              <>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Owner first name *</label>
              <input
                value={signInForm.first_name}
                onChange={(event) => handleFormChange('first_name', event.target.value)}
                placeholder="Anam"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Owner last name *</label>
              <input
                value={signInForm.last_name}
                onChange={(event) => handleFormChange('last_name', event.target.value)}
                placeholder="Haleem"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Primary phone *</label>
              <input
                value={signInForm.phone}
                onChange={(event) => handleFormChange('phone', event.target.value)}
                onBlur={() => handleFormChange('phone', normalizeCanadianPhoneOnBlur(signInForm.phone))}
                placeholder="+1 000-000-0000"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Secondary phone</label>
              <input
                value={signInForm.secondary_phone}
                onChange={(event) => handleFormChange('secondary_phone', event.target.value)}
                onBlur={() => handleFormChange('secondary_phone', normalizeCanadianPhoneOnBlur(signInForm.secondary_phone))}
                placeholder="+1 000-000-0000"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">City</label>
              <input
                value={signInForm.city}
                onChange={(event) => handleFormChange('city', event.target.value)}
                placeholder="Toronto"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Province/Territory</label>
              <select
                value={signInForm.province}
                onChange={(event) => handleFormChange('province', event.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
              >
                <option value="">Select province</option>
                {CANADIAN_PROVINCES.map((province) => (
                  <option key={province.code} value={province.code}>
                    {province.name} ({province.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Street address</label>
              <input
                value={signInForm.street_address}
                onChange={(event) => handleFormChange('street_address', event.target.value)}
                placeholder="123 Queen St W"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Unit number</label>
              <input
                value={signInForm.unit_number}
                onChange={(event) => handleFormChange('unit_number', event.target.value)}
                placeholder="Unit 201"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Postal code</label>
              <input
                value={signInForm.postal_code}
                onChange={(event) => handleFormChange('postal_code', event.target.value)}
                placeholder="M5V 2T6"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
              />
            </div>
              </>
            )}
          </div>

          {codeSent && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Email code *</label>
                <input
                  value={emailCode}
                  onChange={(event) => setEmailCode(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tracking-[0.2em] focus:outline-none focus:border-navy-900"
                />
              </div>
              {requiresPhoneCode && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">SMS code *</label>
                  <input
                    value={phoneCode}
                    onChange={(event) => setPhoneCode(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                    placeholder="654321"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tracking-[0.2em] focus:outline-none focus:border-navy-900"
                  />
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          {needsProfile && missingProfileFields.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              Missing: {missingProfileFields.join(', ')}
            </p>
          )}
          {info && <p className="text-sm text-teal-700 mb-3">{info}</p>}

          <div className="flex flex-wrap gap-2">
            {codeSent ? (
              <>
                <Button
                  onClick={handleVerifyCode}
                  disabled={busy || emailCode.length !== 6 || (requiresPhoneCode && phoneCode.length !== 6)}
                >
                  {busy ? 'Verifying...' : 'Verify & sign in'}
                </Button>
                <Button variant="secondary" onClick={handleRequestCode} disabled={busy || !String(signInForm.email || '').trim()}>
                  {busy ? 'Sending...' : 'Resend code'}
                </Button>
              </>
            ) : (
              <Button onClick={handleRequestCode} disabled={busy || !String(signInForm.email || '').trim()}>
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
            <p className="text-sm font-medium text-gray-900">{ownerDisplayName}</p>
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

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
              {selectedCafe.access_role || 'viewer'}
            </span>
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
            <NavLink
              to="settings"
              className={({ isActive }) =>
                `px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900'}`
              }
            >
              Settings
            </NavLink>
            <Button size="sm" variant="ghost" onClick={handleSignOut}>Sign out</Button>
          </div>
        </div>
      </Card>

      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route
          path="dashboard"
          element={
            <OwnerDashboard
              cafeId={selectedCafe.id}
              cafeName={selectedCafe.name}
              dataApi={ownerPortalApi}
              accessRole={selectedCafe.access_role}
              permissions={selectedCafe.permissions}
            />
          }
        />
        <Route
          path="kitchen"
          element={
            <KitchenView
              cafeId={selectedCafe.id}
              cafeName={selectedCafe.name}
              dataApi={ownerPortalApi}
              accessRole={selectedCafe.access_role}
              permissions={selectedCafe.permissions}
            />
          }
        />
        <Route
          path="settings"
          element={
            <OwnerSettings
              session={owner}
              selectedCafe={selectedCafe}
              onSessionRefresh={refreshOwnerSession}
              onSignOut={handleSignOut}
            />
          }
        />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </div>
  );
}
