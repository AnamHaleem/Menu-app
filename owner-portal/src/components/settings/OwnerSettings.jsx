import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, SectionHeader, Spinner } from '../shared';
import { ownerPortalApi } from '../../lib/api';

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

const ROLE_META = {
  owner: {
    label: 'Owner',
    badge: 'blue',
    summary: 'Full control over settings, team access, and editing.'
  },
  admin: {
    label: 'Admin',
    badge: 'green',
    summary: 'Can manage team access and workspace settings.'
  },
  editor: {
    label: 'Editor',
    badge: 'amber',
    summary: 'Can update prep, logs, and send operational actions.'
  },
  viewer: {
    label: 'Viewer',
    badge: 'gray',
    summary: 'Read-only access to dashboards and prep visibility.'
  }
};

const BUILD_NUMBER = (
  import.meta.env.VITE_APP_BUILD ||
  import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA ||
  'local-dev'
).slice(0, 12);

function normalizePhoneInput(value) {
  return String(value || '')
    .replace(/[^\d+\-\s()]/g, '')
    .slice(0, 24);
}

function normalizePhoneOnBlur(value) {
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

function getInitials(profile = {}, email = '') {
  const first = String(profile.first_name || '').trim().charAt(0);
  const last = String(profile.last_name || '').trim().charAt(0);
  const fallback = String(email || '').trim().charAt(0);
  return (first + last || fallback || 'M').toUpperCase();
}

function buildPermissionRows(cafe = {}) {
  const permissions = cafe.permissions || {};
  return [
    { label: 'View dashboards and prep list', enabled: true },
    { label: 'Edit prep progress and actuals', enabled: Boolean(permissions.canEdit) },
    { label: 'Send prep list and log daily actuals', enabled: Boolean(permissions.canEdit) },
    { label: 'Manage team access and settings', enabled: Boolean(permissions.canManageTeam) }
  ];
}

export default function OwnerSettings({ session, selectedCafe, onSessionRefresh, onSignOut }) {
  const profile = session?.profile || {};
  const accessRole = selectedCafe?.access_role || 'viewer';
  const roleMeta = ROLE_META[accessRole] || ROLE_META.viewer;
  const permissions = selectedCafe?.permissions || {};
  const canManageTeam = Boolean(permissions.canManageTeam);

  const [profileForm, setProfileForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    secondary_phone: '',
    city: '',
    province: '',
    street_address: '',
    unit_number: '',
    postal_code: '',
    avatar_data_url: ''
  });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  const [team, setTeam] = useState([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [teamMessage, setTeamMessage] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [memberForm, setMemberForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    access_role: 'viewer'
  });
  const [updatingMemberId, setUpdatingMemberId] = useState(null);
  const [removingMemberId, setRemovingMemberId] = useState(null);

  useEffect(() => {
    setProfileForm({
      first_name: profile.first_name || '',
      last_name: profile.last_name || '',
      phone: profile.phone || '',
      secondary_phone: profile.secondary_phone || '',
      city: profile.city || '',
      province: profile.province || '',
      street_address: profile.street_address || '',
      unit_number: profile.unit_number || '',
      postal_code: profile.postal_code || '',
      avatar_data_url: profile.avatar_data_url || ''
    });
  }, [
    profile.first_name,
    profile.last_name,
    profile.phone,
    profile.secondary_phone,
    profile.city,
    profile.province,
    profile.street_address,
    profile.unit_number,
    profile.postal_code,
    profile.avatar_data_url
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadTeam() {
      if (!selectedCafe?.id || !canManageTeam) {
        setTeam([]);
        setTeamError('');
        return;
      }

      setLoadingTeam(true);
      setTeamError('');
      try {
        const members = await ownerPortalApi.team.list(selectedCafe.id);
        if (!cancelled) {
          setTeam(members);
        }
      } catch (err) {
        if (!cancelled) {
          setTeam([]);
          setTeamError(err?.response?.data?.error || 'Could not load team members.');
        }
      } finally {
        if (!cancelled) setLoadingTeam(false);
      }
    }

    loadTeam();
    return () => {
      cancelled = true;
    };
  }, [selectedCafe?.id, canManageTeam]);

  const initials = useMemo(() => getInitials(profileForm, session?.email), [profileForm, session?.email]);
  const permissionRows = useMemo(() => buildPermissionRows(selectedCafe), [selectedCafe]);

  const handleProfileFieldChange = (key, value) => {
    let nextValue = value;
    if (key === 'phone' || key === 'secondary_phone') {
      nextValue = normalizePhoneInput(value);
    }
    if (key === 'postal_code') {
      nextValue = normalizePostalInput(value);
    }
    if (key === 'province') {
      nextValue = String(value || '').toUpperCase();
    }

    setProfileForm((prev) => ({ ...prev, [key]: nextValue }));
  };

  const handleMemberFieldChange = (key, value) => {
    let nextValue = value;
    if (key === 'phone') {
      nextValue = normalizePhoneInput(value);
    }
    setMemberForm((prev) => ({ ...prev, [key]: nextValue }));
  };

  const refreshSession = async () => {
    if (typeof onSessionRefresh === 'function') {
      await onSessionRefresh();
    }
  };

  const handleAvatarSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setProfileError('Please choose an image file for the profile photo.');
      return;
    }
    if (file.size > 700 * 1024) {
      setProfileError('Profile photo must be under 700 KB.');
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setProfileForm((prev) => ({ ...prev, avatar_data_url: dataUrl }));
      setProfileError('');
    } catch (err) {
      setProfileError(err.message || 'Could not load image.');
    } finally {
      event.target.value = '';
    }
  };

  const handleSaveProfile = async () => {
    setProfileBusy(true);
    setProfileError('');
    setProfileMessage('');
    try {
      await ownerPortalApi.profile.update(profileForm);
      await refreshSession();
      setProfileMessage('Profile updated.');
    } catch (err) {
      setProfileError(err?.response?.data?.error || 'Could not save profile.');
    } finally {
      setProfileBusy(false);
    }
  };

  const handleAddMember = async () => {
    if (!selectedCafe?.id) return;
    if (!String(memberForm.email || '').trim()) {
      setTeamError('Team member email is required.');
      return;
    }

    setAddingMember(true);
    setTeamError('');
    setTeamMessage('');
    try {
      const result = await ownerPortalApi.team.create(selectedCafe.id, {
        ...memberForm,
        phone: normalizePhoneOnBlur(memberForm.phone)
      });
      setTeam(Array.isArray(result?.members) ? result.members : team);
      setMemberForm({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        access_role: 'viewer'
      });
      setTeamMessage('Team member added to this cafe.');
    } catch (err) {
      setTeamError(err?.response?.data?.error || 'Could not add team member.');
    } finally {
      setAddingMember(false);
    }
  };

  const handleMemberRoleChange = async (member, nextRole) => {
    if (!selectedCafe?.id || !member?.id) return;
    setUpdatingMemberId(member.id);
    setTeamError('');
    setTeamMessage('');
    try {
      const result = await ownerPortalApi.team.update(selectedCafe.id, member.id, {
        access_role: nextRole
      });
      setTeam(Array.isArray(result?.members) ? result.members : team);
      setTeamMessage(`${member.full_name || member.email} is now ${nextRole}.`);
      await refreshSession();
    } catch (err) {
      setTeamError(err?.response?.data?.error || 'Could not update team member role.');
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const handleRemoveMember = async (member) => {
    if (!selectedCafe?.id || !member?.id) return;
    const confirmed = window.confirm(`Remove ${member.full_name || member.email} from ${selectedCafe.name}?`);
    if (!confirmed) return;

    setRemovingMemberId(member.id);
    setTeamError('');
    setTeamMessage('');
    try {
      await ownerPortalApi.team.remove(selectedCafe.id, member.id);
      setTeam((prev) => prev.filter((entry) => entry.id !== member.id));
      setTeamMessage(`${member.full_name || member.email} removed from this cafe.`);
      await refreshSession();
    } catch (err) {
      setTeamError(err?.response?.data?.error || 'Could not remove team member.');
    } finally {
      setRemovingMemberId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="p-6">
          <SectionHeader title="Profile" />
          <div className="grid gap-6 md:grid-cols-[220px_1fr]">
            <div className="space-y-4">
              <div className="flex flex-col items-center rounded-2xl border border-gray-100 bg-gray-50 p-5">
                {profileForm.avatar_data_url ? (
                  <img
                    src={profileForm.avatar_data_url}
                    alt="Profile avatar"
                    className="h-28 w-28 rounded-full object-cover border border-white shadow-sm"
                  />
                ) : (
                  <div className="flex h-28 w-28 items-center justify-center rounded-full bg-navy-900 text-3xl font-semibold text-white">
                    {initials}
                  </div>
                )}
                <label className="mt-4 w-full">
                  <span className="sr-only">Upload profile photo</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
                  <span className="block cursor-pointer rounded-lg border border-gray-200 px-3 py-2 text-center text-sm font-medium text-gray-700 hover:bg-white">
                    Upload photo
                  </span>
                </label>
                {profileForm.avatar_data_url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setProfileForm((prev) => ({ ...prev, avatar_data_url: '' }))}
                  >
                    Remove photo
                  </Button>
                )}
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
                <p className="font-medium text-gray-900">{session?.email}</p>
                <p className="mt-1">Primary account for Menu owner portal access.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {[
                { key: 'first_name', label: 'First name *' },
                { key: 'last_name', label: 'Last name *' },
                { key: 'phone', label: 'Primary phone *', onBlur: true },
                { key: 'secondary_phone', label: 'Secondary phone', onBlur: true },
                { key: 'city', label: 'City *' },
                { key: 'street_address', label: 'Street address *' },
                { key: 'unit_number', label: 'Unit number' },
                { key: 'postal_code', label: 'Postal code *' }
              ].map(({ key, label, onBlur }) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">{label}</label>
                  <input
                    value={profileForm[key]}
                    onChange={(event) => handleProfileFieldChange(key, event.target.value)}
                    onBlur={onBlur ? () => handleProfileFieldChange(key, normalizePhoneOnBlur(profileForm[key])) : undefined}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
                  />
                </div>
              ))}

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Province / territory *</label>
                <select
                  value={profileForm.province}
                  onChange={(event) => handleProfileFieldChange('province', event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
                >
                  <option value="">Select province</option>
                  {CANADIAN_PROVINCES.map((province) => (
                    <option key={province.code} value={province.code}>
                      {province.name} ({province.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {profileError && <p className="mt-4 text-sm text-red-600">{profileError}</p>}
          {profileMessage && <p className="mt-4 text-sm text-teal-700">{profileMessage}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={handleSaveProfile} disabled={profileBusy}>
              {profileBusy ? 'Saving...' : 'Save profile'}
            </Button>
            <Button variant="secondary" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <SectionHeader title="Workspace access" />
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-gray-900">{selectedCafe?.name || 'Cafe access'}</p>
                <p className="text-sm text-gray-500">{roleMeta.summary}</p>
              </div>
              <Badge color={roleMeta.badge}>{roleMeta.label}</Badge>
            </div>

            <div className="mt-4 space-y-3">
              {permissionRows.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3">
                  <p className="text-sm text-gray-700">{item.label}</p>
                  <Badge color={item.enabled ? 'green' : 'gray'}>
                    {item.enabled ? 'Enabled' : 'Read-only'}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="Build & account info" />
            <div className="space-y-3 text-sm text-gray-600">
              <div className="flex items-center justify-between gap-3">
                <span>Build number</span>
                <span className="font-mono text-gray-900">{BUILD_NUMBER}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Environment</span>
                <span className="font-medium text-gray-900">{import.meta.env.MODE}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Selected cafe ID</span>
                <span className="font-mono text-gray-900">{selectedCafe?.id || '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Team management</span>
                <Badge color={canManageTeam ? 'green' : 'gray'}>
                  {canManageTeam ? 'Admin access' : 'Not available'}
                </Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card className="p-6">
        <SectionHeader title="Team members" />

        {!selectedCafe?.id ? (
          <Empty message="Select a cafe to manage team access." />
        ) : !canManageTeam ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
            Only cafe owners and admins can manage team members for this workspace.
          </div>
        ) : (
          <>
            <div className="grid gap-4 rounded-2xl border border-gray-100 bg-gray-50 p-4 md:grid-cols-5">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">First name</label>
                <input
                  value={memberForm.first_name}
                  onChange={(event) => handleMemberFieldChange('first_name', event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Last name</label>
                <input
                  value={memberForm.last_name}
                  onChange={(event) => handleMemberFieldChange('last_name', event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Email *</label>
                <input
                  value={memberForm.email}
                  onChange={(event) => handleMemberFieldChange('email', event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Phone</label>
                <input
                  value={memberForm.phone}
                  onChange={(event) => handleMemberFieldChange('phone', event.target.value)}
                  onBlur={() => handleMemberFieldChange('phone', normalizePhoneOnBlur(memberForm.phone))}
                  placeholder="+1 000-000-0000"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">Role</label>
                <select
                  value={memberForm.access_role}
                  onChange={(event) => handleMemberFieldChange('access_role', event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={handleAddMember} disabled={addingMember}>
                {addingMember ? 'Adding...' : 'Add team member'}
              </Button>
              <p className="self-center text-sm text-gray-500">
                Owners stay full admins; assign `admin` to trusted operators who should manage this cafe.
              </p>
            </div>

            {teamError && <p className="mt-4 text-sm text-red-600">{teamError}</p>}
            {teamMessage && <p className="mt-4 text-sm text-teal-700">{teamMessage}</p>}

            <div className="mt-6">
              {loadingTeam ? (
                <Spinner />
              ) : team.length === 0 ? (
                <Empty message="No team members added for this cafe yet." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                        <th className="px-3 py-3">Member</th>
                        <th className="px-3 py-3">Contact</th>
                        <th className="px-3 py-3">Role</th>
                        <th className="px-3 py-3">Permissions</th>
                        <th className="px-3 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {team.map((member) => {
                        const memberRoleMeta = ROLE_META[member.access_role] || ROLE_META.viewer;
                        const isOwnerMember = member.access_role === 'owner';
                        const isCurrentUser = member.id === session?.ownerId;
                        return (
                          <tr key={member.id} className="border-b border-gray-50 align-top">
                            <td className="px-3 py-4">
                              <div className="flex items-center gap-3">
                                {member.avatar_data_url ? (
                                  <img
                                    src={member.avatar_data_url}
                                    alt={member.full_name || member.email}
                                    className="h-10 w-10 rounded-full object-cover border border-gray-100"
                                  />
                                ) : (
                                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                                    {getInitials(member, member.email)}
                                  </div>
                                )}
                                <div>
                                  <p className="font-medium text-gray-900">
                                    {member.full_name || [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}
                                  </p>
                                  <div className="mt-1 flex flex-wrap gap-2">
                                    <Badge color={memberRoleMeta.badge}>{memberRoleMeta.label}</Badge>
                                    {isCurrentUser && <Badge color="blue">You</Badge>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-4 text-gray-600">
                              <p>{member.email}</p>
                              {member.phone && <p className="mt-1 text-xs text-gray-400">{member.phone}</p>}
                            </td>
                            <td className="px-3 py-4">
                              <select
                                value={member.access_role}
                                disabled={isOwnerMember || updatingMemberId === member.id}
                                onChange={(event) => handleMemberRoleChange(member, event.target.value)}
                                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-navy-900 disabled:bg-gray-50 disabled:text-gray-400"
                              >
                                <option value="viewer">Viewer</option>
                                <option value="editor">Editor</option>
                                <option value="admin">Admin</option>
                                {isOwnerMember && <option value="owner">Owner</option>}
                              </select>
                            </td>
                            <td className="px-3 py-4 text-gray-500">
                              {memberRoleMeta.summary}
                            </td>
                            <td className="px-3 py-4 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isOwnerMember || removingMemberId === member.id}
                                onClick={() => handleRemoveMember(member)}
                              >
                                {removingMemberId === member.id ? 'Removing...' : 'Remove'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
