import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import OwnerDashboard from '../dashboard/OwnerDashboard';
import KitchenView from '../kitchen/KitchenView';
import OwnerSettings from '../settings/OwnerSettings';
import { Button, Card, Spinner } from '../shared';
import { ownerAuthApi, ownerPortalApi } from '../../lib/api';

const OWNER_SELECTED_CAFE_KEY = 'menu.ownerSelectedCafeId';
const OWNER_SIDEBAR_STORAGE_KEY = 'menu.ownerSidebarCollapsed';
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

function readOwnerSidebarState() {
  try {
    return window.localStorage.getItem(OWNER_SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function storeOwnerSidebarState(collapsed) {
  try {
    window.localStorage.setItem(OWNER_SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
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

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
      <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5Z" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1 0 2.8 2 2 0 0 1-2.8 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.2a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 0 1-2.8 0 2 2 0 0 1 0-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.2a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 0 1 0-2.8 2 2 0 0 1 2.8 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.2a1 1 0 0 0 .7.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 0 1 2.8 0 2 2 0 0 1 0 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a2 2 0 0 1 0 4h-.2a1 1 0 0 0-.9.7Z" />
    </svg>
  );
}

function OwnerShellNavLink({ to, label, icon: Icon, collapsed }) {
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

function ownerPageMetaForPath(pathname) {
  if (pathname.includes('/kitchen')) {
    return {
      eyebrow: 'Operations',
      title: "Today's Prep",
      subtitle: 'Review the live prep plan, actuals, and execution quality.'
    };
  }

  if (pathname.includes('/settings')) {
    return {
      eyebrow: 'Account',
      title: 'Settings',
      subtitle: 'Manage your profile, team, permissions, and account details.'
    };
  }

  return {
    eyebrow: 'Overview',
    title: 'Dashboard',
    subtitle: 'Track waste, risk, forecast confidence, and team performance.'
  };
}

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
  const location = useLocation();
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readOwnerSidebarState());

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

  useEffect(() => {
    storeOwnerSidebarState(sidebarCollapsed);
  }, [sidebarCollapsed]);

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
  const pageMeta = ownerPageMetaForPath(location.pathname);

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
      <div className="min-h-screen bg-[#edf2f7] flex items-center justify-center p-4 md:p-6">
        <div className="w-full max-w-[760px]">
          <Card className="p-7 md:p-9">
            <div className="flex items-center gap-4 mb-8">
              <BrandMark />
              <div>
                <h2 className="text-[28px] leading-none font-bold tracking-[-0.04em] text-slate-950">Owner portal</h2>
                <p className="text-sm text-slate-500 mt-2">
                  Secure sign-in for cafe owners, operators, and team leads.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-400 mb-1">Email *</label>
                <input
                  type="email"
                  value={signInForm.email}
                  onChange={(event) => handleFormChange('email', event.target.value)}
                  placeholder="you@yourcafe.com"
                  className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-blue-500"
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
                      className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Owner last name *</label>
                    <input
                      value={signInForm.last_name}
                      onChange={(event) => handleFormChange('last_name', event.target.value)}
                      placeholder="Haleem"
                      className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Primary phone *</label>
                    <input
                      value={signInForm.phone}
                      onChange={(event) => handleFormChange('phone', event.target.value)}
                      onBlur={() => handleFormChange('phone', normalizeCanadianPhoneOnBlur(signInForm.phone))}
                      placeholder="+1 000-000-0000"
                      className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Secondary phone</label>
                    <input
                      value={signInForm.secondary_phone}
                      onChange={(event) => handleFormChange('secondary_phone', event.target.value)}
                      onBlur={() => handleFormChange('secondary_phone', normalizeCanadianPhoneOnBlur(signInForm.secondary_phone))}
                      placeholder="+1 000-000-0000"
                      className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">City</label>
                    <input
                      value={signInForm.city}
                      onChange={(event) => handleFormChange('city', event.target.value)}
                      placeholder="Toronto"
                      className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Province/Territory</label>
                    <select
                      value={signInForm.province}
                      onChange={(event) => handleFormChange('province', event.target.value)}
                      className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-blue-500"
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
                      className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Unit number</label>
                    <input
                      value={signInForm.unit_number}
                      onChange={(event) => handleFormChange('unit_number', event.target.value)}
                      placeholder="Unit 201"
                      className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Postal code</label>
                    <input
                      value={signInForm.postal_code}
                      onChange={(event) => handleFormChange('postal_code', event.target.value)}
                      placeholder="M5V 2T6"
                      className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-blue-500"
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
                    className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm tracking-[0.2em] bg-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                {requiresPhoneCode && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">SMS code *</label>
                    <input
                      value={phoneCode}
                      onChange={(event) => setPhoneCode(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                      placeholder="654321"
                      className="w-full border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm tracking-[0.2em] bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            {needsProfile && missingProfileFields.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2 mb-3">
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
    <div className="min-h-screen bg-[#edf2f7] p-4 md:p-5">
      <div className="max-w-[1600px] mx-auto flex flex-col lg:flex-row gap-5">
        <aside className={[
          'bg-white border border-slate-200 rounded-[30px] p-4 flex flex-col gap-4 shrink-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
          sidebarCollapsed ? 'lg:w-[108px]' : 'lg:w-[290px]',
          'w-full lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]'
        ].join(' ')}>
          <div className="flex items-center justify-between gap-3">
            <div className={['flex items-center gap-3 min-w-0', sidebarCollapsed ? 'lg:justify-center lg:w-full' : ''].join(' ')}>
              <BrandMark />
              <div className={sidebarCollapsed ? 'lg:hidden' : ''}>
                <p className="text-[18px] leading-none font-bold tracking-[-0.03em] text-slate-950">Menu</p>
                <p className="text-sm text-slate-400 mt-1">Owner portal</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              className="hidden lg:flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-white transition-colors"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`}>
                <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="h-px bg-slate-100" />

          <div className="flex flex-col lg:flex-1 gap-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2">
              <OwnerShellNavLink to="/dashboard" label="Dashboard" icon={DashboardIcon} collapsed={sidebarCollapsed} />
              <OwnerShellNavLink to="/kitchen" label="Today's Prep" icon={PrepIcon} collapsed={sidebarCollapsed} />
              <OwnerShellNavLink to="/settings" label="Settings" icon={SettingsIcon} collapsed={sidebarCollapsed} />
            </div>

            <div className={['pt-4 mt-2 border-t border-slate-100', sidebarCollapsed ? 'lg:hidden' : ''].join(' ')}>
              <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-400 mb-3">Owner tools</p>
              <div className="space-y-3 text-sm text-slate-500">
                <p>Live prep visibility</p>
                <p>Team permissions</p>
                <p>Account settings</p>
              </div>
            </div>
          </div>

          <div className="mt-auto pt-4 border-t border-slate-100 flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-slate-950 text-white flex items-center justify-center text-sm font-bold">
              {ownerDisplayName.slice(0, 2).toUpperCase()}
            </div>
            <div className={sidebarCollapsed ? 'lg:hidden' : 'min-w-0'}>
              <p className="text-sm font-semibold text-slate-900 truncate">{ownerDisplayName}</p>
              <p className="text-xs text-slate-400 truncate">{selectedCafe.access_role || 'viewer'}</p>
            </div>
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-5">
          <Card className="px-6 py-5">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-slate-400 mb-2">{pageMeta.eyebrow}</p>
                <h1 className="text-[32px] leading-none font-bold tracking-[-0.04em] text-slate-950">{pageMeta.title}</h1>
                <p className="text-sm text-slate-500 mt-2">{pageMeta.subtitle}</p>
              </div>

              <div className="flex items-center gap-2 flex-wrap xl:justify-end">
                <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">
                  Signed in as <span className="ml-1 font-semibold text-slate-900">{ownerDisplayName}</span>
                </div>
                <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
                  <label className="text-slate-400 mr-2">Cafe</label>
                  <select
                    value={selectedCafe.id}
                    onChange={(event) => setSelectedCafeId(parseInt(event.target.value, 10))}
                    className="bg-transparent focus:outline-none text-slate-900"
                  >
                    {cafes.map((cafe) => (
                      <option key={cafe.id} value={cafe.id}>
                        {cafe.name} ({cafe.city || 'Toronto'})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700">
                  Role: <span className="ml-1 font-semibold text-slate-900">{selectedCafe.access_role || 'viewer'}</span>
                </div>
                <Button size="sm" variant="secondary" onClick={handleSignOut}>Sign out</Button>
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
      </div>
    </div>
  );
}
