import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import OwnerDashboard from '../dashboard/OwnerDashboard';
import KitchenView from '../kitchen/KitchenView';
import { Button, Card, Spinner, Badge, ThemeToggle } from '../shared';
import { ownerAuthApi, ownerPortalApi } from '../../lib/api';
import { getPreferredTheme, persistTheme } from '../../lib/theme';

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
const fieldClassName = 'w-full rounded-2xl px-4 py-3 text-sm';
const labelClassName = 'mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ink-500';
const codeFieldClassName = 'w-full rounded-2xl px-4 py-3 text-sm tracking-[0.2em]';

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
  const [theme, setTheme] = useState(getPreferredTheme);
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

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

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
    'phone',
    'city',
    'province',
    'street_address',
    'postal_code'
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
      setOwner(result?.owner || null);
      setSelectedCafeId(result?.owner?.cafes?.[0]?.id || null);
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
      <div className="app-page flex min-h-[70vh] flex-col items-center justify-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-[1.6rem] bg-gradient-to-br from-navy-900 via-navy-700 to-teal-600 text-2xl font-display font-bold text-white shadow-glow">
          M
        </div>
        <p className="text-sm font-medium text-ink-500">Loading your owner workspace</p>
        <Spinner />
      </div>
    );
  }

  if (!owner) {
    return (
      <div className="app-page">
        <div className="mb-5 flex justify-end">
          <ThemeToggle theme={theme} onThemeChange={setTheme} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card tone="dark" className="menu-hero-card p-8 md:p-10">
            <span className="menu-eyebrow border-white/10 bg-white/10 text-white/70">Owner portal</span>
            <h2 className="mt-6 font-display text-4xl font-semibold tracking-tight text-white md:text-[3.2rem]">
              Run your cafes with less noise and more signal.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-white/70">
              Menu gives owners a calmer way to move from forecast to prep to performance review, without jumping between disconnected tools.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[26px] border border-white/10 bg-white/10 p-5">
                <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/50">Sign-in flow</p>
                <p className="mt-3 font-display text-3xl text-white">Email first</p>
                <p className="mt-2 text-sm leading-6 text-white/70">Existing owners verify quickly. First-time owners complete profile setup once.</p>
              </div>
              <div className="rounded-[26px] border border-white/10 bg-white/10 p-5">
                <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/50">Daily loop</p>
                <p className="mt-3 font-display text-3xl text-white">Dashboard + kitchen</p>
                <p className="mt-2 text-sm leading-6 text-white/70">Switch from high-level performance to station-level prep without leaving the workspace.</p>
              </div>
            </div>
          </Card>

          <Card className="menu-hero-card p-7 md:p-8">
            <span className="menu-eyebrow">Secure sign-in</span>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-ink-950">Cafe owner sign-in</h2>
            <p className="mt-3 text-sm leading-6 text-ink-500">
              Enter your email to continue. First-time owners will complete their profile setup before codes are sent.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClassName}>Email *</label>
              <input
                type="email"
                value={signInForm.email}
                onChange={(event) => handleFormChange('email', event.target.value)}
                placeholder="you@yourcafe.com"
                className={fieldClassName}
              />
            </div>

            {needsProfile && (
              <>
            <div>
              <label className={labelClassName}>Owner first name *</label>
              <input
                value={signInForm.first_name}
                onChange={(event) => handleFormChange('first_name', event.target.value)}
                placeholder="Anam"
                className={fieldClassName}
              />
            </div>
            <div>
              <label className={labelClassName}>Owner last name *</label>
              <input
                value={signInForm.last_name}
                onChange={(event) => handleFormChange('last_name', event.target.value)}
                placeholder="Haleem"
                className={fieldClassName}
              />
            </div>
            <div>
              <label className={labelClassName}>Primary phone *</label>
              <input
                value={signInForm.phone}
                onChange={(event) => handleFormChange('phone', event.target.value)}
                onBlur={() => handleFormChange('phone', normalizeCanadianPhoneOnBlur(signInForm.phone))}
                placeholder="+1 000-000-0000"
                className={fieldClassName}
              />
            </div>
            <div>
              <label className={labelClassName}>Secondary phone</label>
              <input
                value={signInForm.secondary_phone}
                onChange={(event) => handleFormChange('secondary_phone', event.target.value)}
                onBlur={() => handleFormChange('secondary_phone', normalizeCanadianPhoneOnBlur(signInForm.secondary_phone))}
                placeholder="+1 000-000-0000"
                className={fieldClassName}
              />
            </div>
            <div>
              <label className={labelClassName}>City *</label>
              <input
                value={signInForm.city}
                onChange={(event) => handleFormChange('city', event.target.value)}
                placeholder="Toronto"
                className={fieldClassName}
              />
            </div>
            <div>
              <label className={labelClassName}>Province/Territory *</label>
              <select
                value={signInForm.province}
                onChange={(event) => handleFormChange('province', event.target.value)}
                className={fieldClassName}
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
              <label className={labelClassName}>Street address *</label>
              <input
                value={signInForm.street_address}
                onChange={(event) => handleFormChange('street_address', event.target.value)}
                placeholder="123 Queen St W"
                className={fieldClassName}
              />
            </div>
            <div>
              <label className={labelClassName}>Unit number</label>
              <input
                value={signInForm.unit_number}
                onChange={(event) => handleFormChange('unit_number', event.target.value)}
                placeholder="Unit 201"
                className={fieldClassName}
              />
            </div>
            <div>
              <label className={labelClassName}>Postal code *</label>
              <input
                value={signInForm.postal_code}
                onChange={(event) => handleFormChange('postal_code', event.target.value)}
                placeholder="M5V 2T6"
                className={fieldClassName}
              />
            </div>
              </>
            )}
          </div>

          {codeSent && (
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClassName}>Email code *</label>
                <input
                  value={emailCode}
                  onChange={(event) => setEmailCode(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                  placeholder="123456"
                  className={codeFieldClassName}
                />
              </div>
              {requiresPhoneCode && (
                <div>
                  <label className={labelClassName}>SMS code *</label>
                  <input
                    value={phoneCode}
                    onChange={(event) => setPhoneCode(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                    placeholder="654321"
                    className={codeFieldClassName}
                  />
                </div>
              )}
            </div>
          )}

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          {needsProfile && missingProfileFields.length > 0 && (
            <p className="mt-4 rounded-[20px] border border-sand-100 bg-sand-100/70 px-4 py-3 text-xs text-amber-700">
              Missing: {missingProfileFields.join(', ')}
            </p>
          )}
          {info && <p className="mt-4 text-sm text-teal-700">{info}</p>}

          <div className="mt-6 flex flex-wrap gap-4 rounded-[24px] bg-ink-100/45 p-2">
            {codeSent ? (
              <>
                <Button
                  size="lg"
                  onClick={handleVerifyCode}
                  disabled={busy || emailCode.length !== 6 || (requiresPhoneCode && phoneCode.length !== 6)}
                >
                  {busy ? 'Verifying...' : 'Verify & sign in'}
                </Button>
                <Button size="lg" variant="secondary" onClick={handleRequestCode} disabled={busy || !String(signInForm.email || '').trim()}>
                  {busy ? 'Sending...' : 'Resend code'}
                </Button>
              </>
            ) : (
              <Button size="lg" onClick={handleRequestCode} disabled={busy || !String(signInForm.email || '').trim()}>
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
      <div className="app-page">
        <div className="mb-5 flex justify-end">
          <ThemeToggle theme={theme} onThemeChange={setTheme} />
        </div>

        <Card className="menu-hero-card mx-auto max-w-xl p-8 text-center">
          <span className="menu-eyebrow">Owner workspace</span>
          <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-ink-950">No active cafes found</h2>
          <p className="mt-3 text-sm leading-6 text-ink-500">
            This owner account is signed in, but no active cafes are linked right now.
          </p>
          <div className="mt-6">
            <Button onClick={handleSignOut}>Sign out</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-page">
      <Card tone="dark" className="menu-hero-card mb-6 p-6 md:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/70">
              Owner workspace
            </span>
            <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-white">{selectedCafe.name}</h1>
            <p className="mt-2 text-sm leading-6 text-white/70">
              Signed in as {owner.email} &middot; {cafes.length} linked cafe{cafes.length === 1 ? '' : 's'}
            </p>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-3">
              <label className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/60">Cafe</label>
              <select
                value={selectedCafe.id}
                onChange={(event) => setSelectedCafeId(parseInt(event.target.value, 10))}
                className="min-w-[15rem] rounded-full border border-white/10 bg-white/10 px-4 py-3 text-sm text-white"
              >
                {cafes.map((cafe) => (
                  <option key={cafe.id} value={cafe.id}>
                    {cafe.name} ({cafe.city || 'Toronto'})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-[1.3rem] border border-white/10 bg-white/10 p-1.5">
              <NavLink
                to="dashboard"
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 text-sm font-semibold transition duration-200 ${isActive ? 'bg-white text-ink-950 shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'}`
                }
              >
                Dashboard
              </NavLink>
              <NavLink
                to="kitchen"
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 text-sm font-semibold transition duration-200 ${isActive ? 'bg-white text-ink-950 shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'}`
                }
              >
                Kitchen
              </NavLink>
            </div>

            <ThemeToggle theme={theme} onThemeChange={setTheme} />

            <Button
              size="sm"
              variant="secondary"
              className="border-white/10 bg-white/10 text-white shadow-none hover:bg-white/20 hover:text-white"
              onClick={handleSignOut}
            >
              Sign out
            </Button>
          </div>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge color="green">Owner access active</Badge>
        <p className="text-sm text-ink-500">Switch between dashboard and kitchen views without leaving the signed-in workspace.</p>
      </div>

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
