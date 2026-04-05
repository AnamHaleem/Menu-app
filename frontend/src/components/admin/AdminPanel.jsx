import React, { useState, useEffect } from 'react';
import { cafesApi, itemsApi, ingredientsApi, recipesApi, metricsApi, adminOwnersApi } from '../../lib/api';
import { Spinner, Badge, Button, Card, SectionHeader, MetricCard } from '../shared';

const fmt$ = (v) => '$' + Math.round(Number(v) || 0).toLocaleString();
const SELECTED_CAFE_STORAGE_KEY = 'menu.selectedCafeId';

function CafeCard({ cafe, onSelect, selected }) {
  const [metrics, setMetrics] = useState(null);
  useEffect(() => {
    metricsApi.get(cafe.id).then(setMetrics).catch(() => {});
  }, [cafe.id]);

  return (
    <button
      type="button"
      onClick={() => onSelect(cafe)}
      className={`w-full rounded-[28px] border p-5 text-left transition duration-200 ${
        selected
          ? 'border-navy-900 bg-gradient-to-br from-navy-100/90 via-white to-white shadow-glow'
          : 'border-white/80 bg-white/70 shadow-soft hover:-translate-y-0.5 hover:border-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-2xl font-semibold text-ink-950">{cafe.name}</p>
          <p className="mt-1 text-sm text-ink-500">{cafe.city} &mdash; {cafe.owner_name || 'Owner not set'}</p>
        </div>
        <Badge color={cafe.active ? 'green' : 'gray'}>{cafe.active ? 'Active' : 'Inactive'}</Badge>
      </div>
      {metrics && (
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-[20px] border border-white/75 bg-white/75 p-3 text-center shadow-sm">
            <p className="text-lg font-semibold text-teal-600">{fmt$(metrics.allTime.totalSavings)}</p>
            <p className="mt-1 text-[0.68rem] uppercase tracking-[0.16em] text-ink-500">saved</p>
          </div>
          <div className="rounded-[20px] border border-white/75 bg-white/75 p-3 text-center shadow-sm">
            <p className="text-lg font-semibold text-ink-700">{metrics.daysRunning}</p>
            <p className="mt-1 text-[0.68rem] uppercase tracking-[0.16em] text-ink-500">days</p>
          </div>
          <div className="rounded-[20px] border border-white/75 bg-white/75 p-3 text-center shadow-sm">
            <p className={`text-lg font-semibold ${metrics.allTime.total86 === 0 ? 'text-teal-600' : 'text-red-500'}`}>{metrics.allTime.total86}</p>
            <p className="mt-1 text-[0.68rem] uppercase tracking-[0.16em] text-ink-500">86 incidents</p>
          </div>
        </div>
      )}
    </button>
  );
}

function AddCafeForm({ onSave, onCancel }) {
  const [form, setForm] = useState({
    name: "", owner_name: "", email: "", city: "Toronto",
    holiday_behaviour: "Manual", kitchen_lead_email: "",
    prep_send_time: "06:00"
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      setError("Cafe name and owner email are required.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const createdCafe = await cafesApi.create(form);
      await onSave(createdCafe);
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setError(apiError || "Could not add cafe. Check backend FRONTEND_URL and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="menu-hero-card mb-6 p-6 md:p-7">
      <SectionHeader
        title="Create a new cafe"
        subtitle="Set the owner, city, and prep dispatch defaults so Menu can start generating daily guidance."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[
          { key: "name", label: "Cafe name" },
          { key: "owner_name", label: "Owner name" },
          { key: "email", label: "Owner email" },
          { key: "kitchen_lead_email", label: "Kitchen lead email" },
          { key: "city", label: "City" }
        ].map(({ key, label }) => (
          <div key={key}>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">{label}</label>
            <input
              value={form[key]}
              onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
              className="w-full rounded-2xl px-4 py-3 text-sm"
            />
          </div>
        ))}
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">Holiday behaviour</label>
          <select
            value={form.holiday_behaviour}
            onChange={e => setForm(p => ({ ...p, holiday_behaviour: e.target.value }))}
            className="w-full rounded-2xl px-4 py-3 text-sm"
          >
            <option>Manual</option>
            <option>Reduced</option>
            <option>Closed</option>
            <option>Sunday pattern</option>
          </select>
        </div>
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">Prep email time</label>
          <input
            type="time"
            value={form.prep_send_time}
            onChange={e => setForm(p => ({ ...p, prep_send_time: e.target.value }))}
            className="w-full rounded-2xl px-4 py-3 text-sm"
          />
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex flex-wrap gap-3">
        <Button onClick={handleSubmit} size="sm" disabled={saving}>
          {saving ? "Adding..." : "Add cafe"}
        </Button>
        <Button variant="ghost" onClick={onCancel} size="sm" disabled={saving}>Cancel</Button>
      </div>
    </Card>
  );
}

function OwnerAccessSection({ cafe }) {
  const [owners, setOwners] = useState([]);
  const [loadingOwners, setLoadingOwners] = useState(true);
  const [showAddOwner, setShowAddOwner] = useState(false);
  const [addingOwner, setAddingOwner] = useState(false);
  const [workingOwnerId, setWorkingOwnerId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editOwnerId, setEditOwnerId] = useState(null);
  const [editForm, setEditForm] = useState({ email: '', full_name: '' });
  const [newOwner, setNewOwner] = useState({
    email: '',
    full_name: '',
    send_invite: true
  });

  const loadOwners = async () => {
    setLoadingOwners(true);
    setError('');
    try {
      const data = await adminOwnersApi.list({ cafeId: cafe.id, includeInactive: true });
      setOwners(data);
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setError(apiError || 'Could not load owner access list.');
    } finally {
      setLoadingOwners(false);
    }
  };

  useEffect(() => {
    loadOwners();
  }, [cafe.id]);

  const handleAddOwner = async () => {
    if (!newOwner.email.trim()) {
      setError('Owner email is required.');
      return;
    }

    setAddingOwner(true);
    setMessage('');
    setError('');

    try {
      const owner = await adminOwnersApi.create({
        email: newOwner.email.trim(),
        full_name: newOwner.full_name.trim(),
        cafe_ids: [cafe.id]
      });

      if (newOwner.send_invite && owner?.id) {
        await adminOwnersApi.sendInvite(owner.id);
      }

      await loadOwners();
      setShowAddOwner(false);
      setNewOwner({ email: '', full_name: '', send_invite: true });
      setMessage(newOwner.send_invite ? 'Owner added and invite sent.' : 'Owner added to this cafe.');
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setError(apiError || 'Could not add owner access.');
    } finally {
      setAddingOwner(false);
    }
  };

  const handleSendInvite = async (ownerId) => {
    setWorkingOwnerId(ownerId);
    setMessage('');
    setError('');
    try {
      await adminOwnersApi.sendInvite(ownerId);
      setMessage('Invite sent.');
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setError(apiError || 'Could not send invite.');
    } finally {
      setWorkingOwnerId(null);
    }
  };

  const handleRemoveAccess = async (ownerId) => {
    const confirmed = window.confirm(`Remove this owner's access to ${cafe.name}?`);
    if (!confirmed) return;

    setWorkingOwnerId(ownerId);
    setMessage('');
    setError('');
    try {
      await adminOwnersApi.unassignCafe(ownerId, cafe.id);
      await loadOwners();
      setMessage('Owner access removed from this cafe.');
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setError(apiError || 'Could not remove owner access.');
    } finally {
      setWorkingOwnerId(null);
    }
  };

  const handleDeactivate = async (ownerId) => {
    const confirmed = window.confirm('Deactivate this owner account for all cafes?');
    if (!confirmed) return;

    setWorkingOwnerId(ownerId);
    setMessage('');
    setError('');
    try {
      await adminOwnersApi.deactivate(ownerId);
      await loadOwners();
      setMessage('Owner account deactivated.');
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setError(apiError || 'Could not deactivate owner.');
    } finally {
      setWorkingOwnerId(null);
    }
  };

  const startEditOwner = (owner) => {
    setEditOwnerId(owner.id);
    setEditForm({
      email: owner.email || '',
      full_name: owner.full_name || ''
    });
    setMessage('');
    setError('');
  };

  const cancelEditOwner = () => {
    setEditOwnerId(null);
    setEditForm({ email: '', full_name: '' });
  };

  const handleSaveOwner = async (ownerId) => {
    if (!editForm.email.trim()) {
      setError('Owner email is required.');
      return;
    }

    setWorkingOwnerId(ownerId);
    setMessage('');
    setError('');
    try {
      await adminOwnersApi.update(ownerId, {
        email: editForm.email.trim(),
        full_name: editForm.full_name.trim() || null
      });
      await loadOwners();
      setEditOwnerId(null);
      setMessage('Owner details updated.');
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setError(apiError || 'Could not update owner.');
    } finally {
      setWorkingOwnerId(null);
    }
  };

  return (
    <div className="mt-8 border-t border-white/70 pt-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-ink-500">Owner access</p>
          <p className="mt-1 text-sm text-ink-500">Control who can sign in to this cafe and manage invitation flows.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setShowAddOwner((prev) => !prev)}>
          {showAddOwner ? 'Close' : '+ Add owner'}
        </Button>
      </div>

      {showAddOwner && (
        <Card className="mb-4 p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">Owner email</label>
              <input
                type="email"
                value={newOwner.email}
                onChange={(e) => setNewOwner((prev) => ({ ...prev, email: e.target.value }))}
                className="w-full rounded-2xl px-4 py-3 text-sm"
                placeholder="owner@yourcafe.com"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">Owner name</label>
              <input
                value={newOwner.full_name}
                onChange={(e) => setNewOwner((prev) => ({ ...prev, full_name: e.target.value }))}
                className="w-full rounded-2xl px-4 py-3 text-sm"
                placeholder="Jane Owner"
              />
            </div>
          </div>
          <label className="mt-4 inline-flex items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={newOwner.send_invite}
              onChange={(e) => setNewOwner((prev) => ({ ...prev, send_invite: e.target.checked }))}
            />
            Send sign-in invite code now
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button size="sm" onClick={handleAddOwner} disabled={addingOwner}>
              {addingOwner ? 'Adding...' : 'Add owner access'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAddOwner(false)} disabled={addingOwner}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {loadingOwners ? (
        <Spinner />
      ) : owners.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-ink-500">No owner access assigned for this cafe yet.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {owners.map((owner) => (
            <Card key={owner.id} className="p-5">
              {editOwnerId === owner.id ? (
                <div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                      className="w-full rounded-2xl px-4 py-3 text-sm"
                    />
                    <input
                      value={editForm.full_name}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, full_name: e.target.value }))}
                      className="w-full rounded-2xl px-4 py-3 text-sm"
                      placeholder="Owner name"
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button size="sm" onClick={() => handleSaveOwner(owner.id)} disabled={workingOwnerId === owner.id}>
                      {workingOwnerId === owner.id ? 'Saving...' : 'Save'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelEditOwner} disabled={workingOwnerId === owner.id}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <p className="font-display text-2xl font-semibold text-ink-950">{owner.full_name || 'Owner'}</p>
                    <p className="mt-1 text-sm text-ink-500">{owner.email}</p>
                    <div className="mt-3 flex items-center gap-2">
                      <Badge color={owner.active ? 'green' : 'gray'}>
                        {owner.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => handleSendInvite(owner.id)} disabled={workingOwnerId === owner.id || !owner.active}>
                      {workingOwnerId === owner.id ? 'Sending...' : 'Send invite'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => startEditOwner(owner)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleRemoveAccess(owner.id)} disabled={workingOwnerId === owner.id}>
                      Remove access
                    </Button>
                    {owner.active && (
                      <Button size="sm" variant="danger" onClick={() => handleDeactivate(owner.id)} disabled={workingOwnerId === owner.id}>
                        Deactivate
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      {message && <p className="mt-3 text-xs text-teal-600">{message}</p>}
    </div>
  );
}

function CafeDetail({ cafe, onCafeDeleted, onCafeUpdated }) {
  const [tab, setTab] = useState('menu');
  const [items, setItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', category: 'Beverage', price: '' });
  const [prepSendTime, setPrepSendTime] = useState(cafe.prep_send_time || '06:00');
  const [savingPrepTime, setSavingPrepTime] = useState(false);
  const [prepTimeMessage, setPrepTimeMessage] = useState('');
  const [deletingCafe, setDeletingCafe] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState('');
  const [editingCafeInfo, setEditingCafeInfo] = useState(false);
  const [savingCafeInfo, setSavingCafeInfo] = useState(false);
  const [cafeInfoMessage, setCafeInfoMessage] = useState('');
  const [cafeInfoForm, setCafeInfoForm] = useState({
    name: cafe.name || '',
    owner_name: cafe.owner_name || '',
    email: cafe.email || '',
    kitchen_lead_email: cafe.kitchen_lead_email || '',
    city: cafe.city || 'Toronto',
    holiday_behaviour: cafe.holiday_behaviour || 'Manual'
  });

  useEffect(() => {
    Promise.all([
      itemsApi.get(cafe.id),
      ingredientsApi.get(cafe.id),
      recipesApi.get(cafe.id),
      metricsApi.get(cafe.id)
    ]).then(([i, ing, r, m]) => {
      setItems(i);
      setIngredients(ing);
      setRecipes(r);
      setMetrics(m);
    }).finally(() => setLoading(false));
  }, [cafe.id]);

  useEffect(() => {
    setPrepSendTime(cafe.prep_send_time || '06:00');
    setPrepTimeMessage('');
  }, [cafe.id, cafe.prep_send_time]);

  useEffect(() => {
    setEditingCafeInfo(false);
    setSavingCafeInfo(false);
    setCafeInfoMessage('');
    setCafeInfoForm({
      name: cafe.name || '',
      owner_name: cafe.owner_name || '',
      email: cafe.email || '',
      kitchen_lead_email: cafe.kitchen_lead_email || '',
      city: cafe.city || 'Toronto',
      holiday_behaviour: cafe.holiday_behaviour || 'Manual'
    });
  }, [cafe.id, cafe.name, cafe.owner_name, cafe.email, cafe.kitchen_lead_email, cafe.city, cafe.holiday_behaviour]);

  const handleAddItem = async () => {
    await itemsApi.create(cafe.id, newItem);
    const updated = await itemsApi.get(cafe.id);
    setItems(updated);
    setShowAddItem(false);
    setNewItem({ name: '', category: 'Beverage', price: '' });
  };

  const handleToggleItem = async (item) => {
    await itemsApi.update(cafe.id, item.id, { ...item, active: !item.active });
    const updated = await itemsApi.get(cafe.id);
    setItems(updated);
  };

  const handleSavePrepTime = async () => {
    if (!prepSendTime) return;

    setSavingPrepTime(true);
    setPrepTimeMessage('');
    try {
      const updatedCafe = await cafesApi.setPrepTime(cafe.id, prepSendTime);
      setPrepTimeMessage('Prep email time saved.');
      if (typeof onCafeUpdated === 'function') {
        onCafeUpdated(updatedCafe);
      }
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setPrepTimeMessage(apiError || 'Could not save prep email time.');
    } finally {
      setSavingPrepTime(false);
    }
  };

  const handleSaveCafeInfo = async () => {
    if (!cafeInfoForm.name.trim() || !cafeInfoForm.email.trim()) {
      setCafeInfoMessage('Cafe name and owner email are required.');
      return;
    }

    setSavingCafeInfo(true);
    setCafeInfoMessage('');

    try {
      const updatedCafe = await cafesApi.patch(cafe.id, {
        name: cafeInfoForm.name.trim(),
        owner_name: cafeInfoForm.owner_name.trim(),
        email: cafeInfoForm.email.trim(),
        kitchen_lead_email: cafeInfoForm.kitchen_lead_email.trim(),
        city: cafeInfoForm.city.trim(),
        holiday_behaviour: cafeInfoForm.holiday_behaviour
      });

      setCafeInfoMessage('Cafe info updated.');
      setEditingCafeInfo(false);

      if (typeof onCafeUpdated === 'function') {
        onCafeUpdated(updatedCafe);
      }
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setCafeInfoMessage(apiError || 'Could not update cafe info.');
    } finally {
      setSavingCafeInfo(false);
    }
  };

  const handleCancelCafeInfoEdit = () => {
    setEditingCafeInfo(false);
    setCafeInfoMessage('');
    setCafeInfoForm({
      name: cafe.name || '',
      owner_name: cafe.owner_name || '',
      email: cafe.email || '',
      kitchen_lead_email: cafe.kitchen_lead_email || '',
      city: cafe.city || 'Toronto',
      holiday_behaviour: cafe.holiday_behaviour || 'Manual'
    });
  };

  const handleDeleteCafe = async () => {
    const confirmed = window.confirm(
      `Delete "${cafe.name}"? This will deactivate the cafe and hide it from the current admin view.`
    );
    if (!confirmed) return;

    setDeletingCafe(true);
    setDeleteMessage('');

    try {
      await cafesApi.delete(cafe.id);
      setDeleteMessage('Cafe deleted.');
      if (typeof onCafeDeleted === 'function') {
        await onCafeDeleted(cafe.id);
      }
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setDeleteMessage(apiError || 'Could not delete cafe. Please try again.');
    } finally {
      setDeletingCafe(false);
    }
  };

  if (loading) return <Spinner />;

  const tabs = [
    { key: 'menu', label: 'Menu items' },
    { key: 'ingredients', label: 'Ingredients' },
    { key: 'recipes', label: 'Recipes' },
    { key: 'settings', label: 'Settings' }
  ];

  return (
    <div className="space-y-6">
      <Card tone="dark" className="menu-hero-card p-6 md:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/70">
              Cafe studio
            </span>
            <h2 className="mt-5 font-display text-4xl font-semibold tracking-tight text-white">{cafe.name}</h2>
            <p className="mt-2 text-sm leading-6 text-white/70">{cafe.city} &mdash; {cafe.email}</p>
          </div>
          <Badge color={cafe.active ? 'green' : 'gray'}>{cafe.active ? 'Live' : 'Inactive'}</Badge>
        </div>
      </Card>

      {metrics && (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <MetricCard label="Total savings" value={fmt$(metrics.allTime.totalSavings)} color="text-teal-600" accent="mint" />
          <MetricCard label="Days running" value={metrics.daysRunning} accent="brand" />
          <MetricCard label="86 incidents" value={metrics.allTime.total86} color={metrics.allTime.total86 === 0 ? 'text-teal-600' : 'text-red-500'} accent={metrics.allTime.total86 === 0 ? 'mint' : 'coral'} />
          <MetricCard label="Waste reduction" value={metrics.wasteReductionPct + '%'} color="text-teal-600" accent="sand" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 rounded-[26px] border border-white/80 bg-white/70 p-1.5 shadow-soft">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-2.5 text-sm font-semibold transition duration-200 ${tab === t.key ? 'bg-ink-950 text-white shadow-lg shadow-slate-900/15' : 'text-ink-500 hover:bg-white hover:text-ink-900'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'menu' && (
        <div>
          <SectionHeader
            title="Menu catalog"
            subtitle={`${items.length} item${items.length === 1 ? '' : 's'} configured for this cafe.`}
            action={<Button size="sm" onClick={() => setShowAddItem(!showAddItem)}>+ Add item</Button>}
          />

          {showAddItem && (
            <Card className="mb-4 p-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">Name</label>
                  <input value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-2xl px-4 py-3 text-sm" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">Category</label>
                  <select value={newItem.category} onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))}
                    className="w-full rounded-2xl px-4 py-3 text-sm">
                    <option>Beverage</option>
                    <option>Food</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">Price ($)</label>
                  <input type="number" value={newItem.price} onChange={e => setNewItem(p => ({ ...p, price: e.target.value }))}
                    className="w-full rounded-2xl px-4 py-3 text-sm" />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button size="sm" onClick={handleAddItem}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAddItem(false)}>Cancel</Button>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <table className="menu-table text-sm">
              <thead>
                <tr>
                  {['Name', 'Category', 'Price', 'Status'].map(h => (
                    <th key={h} className="text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-white/50">
                    <td className="font-medium text-ink-900">{item.name}</td>
                    <td className="text-ink-500">{item.category}</td>
                    <td className="text-ink-700">${parseFloat(item.price || 0).toFixed(2)}</td>
                    <td>
                      <button onClick={() => handleToggleItem(item)}>
                        <Badge color={item.active ? 'green' : 'gray'}>{item.active ? 'Active' : 'Inactive'}</Badge>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === 'ingredients' && (
        <Card className="overflow-hidden">
          <table className="menu-table text-sm">
            <thead>
              <tr>
                {['Ingredient', 'Unit', 'Par level', 'Shelf life', 'Cost/unit'].map(h => (
                  <th key={h} className="text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ingredients.map(ing => (
                <tr key={ing.id} className="hover:bg-white/50">
                  <td className="font-medium text-ink-900">{ing.name}</td>
                  <td className="text-ink-500">{ing.unit}</td>
                  <td className="text-ink-700">{ing.par_level}</td>
                  <td className="text-ink-500">{ing.shelf_life_days} days</td>
                  <td className="text-ink-700">${parseFloat(ing.cost_per_unit || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'recipes' && (
        <Card className="overflow-hidden">
          <table className="menu-table text-sm">
            <thead>
              <tr>
                {['Menu item', 'Ingredient', 'Qty per portion', 'Unit', 'Station'].map(h => (
                  <th key={h} className="text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recipes.map(r => (
                <tr key={r.id} className="hover:bg-white/50">
                  <td className="font-medium text-ink-900">{r.item_name}</td>
                  <td className="text-ink-700">{r.ingredient_name}</td>
                  <td className="text-ink-500">{r.qty_per_portion}</td>
                  <td className="text-ink-500">{r.unit}</td>
                  <td><Badge color="blue">{r.station}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'settings' && (
        <Card className="p-6 md:p-7">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-ink-500">Cafe information</p>
              <p className="mt-1 text-sm text-ink-500">Update contact details, holiday handling, prep timing, and owner access.</p>
            </div>
            {!editingCafeInfo && (
              <Button size="sm" variant="secondary" onClick={() => setEditingCafeInfo(true)}>
                Edit info
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: 'name', label: 'Café name' },
              { key: 'owner_name', label: 'Owner name' },
              { key: 'email', label: 'Owner email' },
              { key: 'kitchen_lead_email', label: 'Kitchen lead email' },
              { key: 'city', label: 'City' }
            ].map(({ key, label }) => (
              <div key={key} className="rounded-[24px] border border-white/70 bg-white/60 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">{label}</p>
                {editingCafeInfo ? (
                  <input
                    value={cafeInfoForm[key]}
                    onChange={(e) => setCafeInfoForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="w-full rounded-2xl px-4 py-3 text-sm"
                  />
                ) : (
                  <p className="text-sm font-medium text-ink-900">{cafeInfoForm[key] || '—'}</p>
                )}
              </div>
            ))}
            <div className="rounded-[24px] border border-white/70 bg-white/60 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">Holiday behaviour</p>
              {editingCafeInfo ? (
                <select
                  value={cafeInfoForm.holiday_behaviour}
                  onChange={(e) => setCafeInfoForm((prev) => ({ ...prev, holiday_behaviour: e.target.value }))}
                  className="w-full rounded-2xl px-4 py-3 text-sm"
                >
                  <option>Manual</option>
                  <option>Reduced</option>
                  <option>Closed</option>
                  <option>Sunday pattern</option>
                </select>
              ) : (
                <p className="text-sm font-medium text-ink-900">{cafeInfoForm.holiday_behaviour || '—'}</p>
              )}
            </div>
          </div>

          {cafeInfoMessage && (
            <p className={`mt-4 text-xs ${cafeInfoMessage.includes('updated') ? 'text-teal-600' : 'text-red-600'}`}>
              {cafeInfoMessage}
            </p>
          )}

          {editingCafeInfo && (
            <div className="mt-5 flex flex-wrap gap-3">
              <Button size="sm" onClick={handleSaveCafeInfo} disabled={savingCafeInfo}>
                {savingCafeInfo ? 'Saving...' : 'Save changes'}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancelCafeInfoEdit} disabled={savingCafeInfo}>
                Cancel
              </Button>
            </div>
          )}

          <div className="mt-8 border-t border-white/70 pt-8">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-ink-500">Prep email time (Toronto timezone)</p>
            <div className="flex items-center gap-2 max-w-xs">
              <input
                type="time"
                value={prepSendTime}
                onChange={e => setPrepSendTime(e.target.value)}
                className="w-full rounded-2xl px-4 py-3 text-sm"
              />
              <Button size="sm" onClick={handleSavePrepTime} disabled={savingPrepTime}>
                {savingPrepTime ? 'Saving...' : 'Save'}
              </Button>
            </div>
            {prepTimeMessage && (
              <p className={`mt-3 text-xs ${prepTimeMessage.includes('saved') ? 'text-teal-600' : 'text-red-600'}`}>
                {prepTimeMessage}
              </p>
            )}
          </div>

          <OwnerAccessSection cafe={cafe} />

          <div className="mt-8 rounded-[28px] border border-red-100 bg-red-50/70 p-5">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-red-500">Danger zone</p>
            <p className="mt-2 text-sm text-red-600">Deleting a cafe deactivates it and removes it from the active admin workflow.</p>
            <Button
              className="mt-4"
              size="sm"
              variant="danger"
              onClick={handleDeleteCafe}
              disabled={deletingCafe}
            >
              {deletingCafe ? 'Deleting...' : 'Delete cafe'}
            </Button>
            {deleteMessage && (
              <p className={`mt-3 text-xs ${deleteMessage.includes('deleted') ? 'text-teal-600' : 'text-red-600'}`}>
                {deleteMessage}
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

export default function AdminPanel({ onCafeChange, currentCafeId }) {
  const [cafes, setCafes] = useState([]);
  const [selectedCafe, setSelectedCafe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddCafe, setShowAddCafe] = useState(false);

  const broadcastCafeSelection = (cafe) => {
    setSelectedCafe(cafe || null);

    if (cafe?.id) {
      try {
        window.localStorage.setItem(SELECTED_CAFE_STORAGE_KEY, String(cafe.id));
      } catch {
        // ignore localStorage failures
      }
    } else {
      try {
        window.localStorage.removeItem(SELECTED_CAFE_STORAGE_KEY);
      } catch {
        // ignore localStorage failures
      }
    }

    if (typeof onCafeChange === 'function') {
      onCafeChange(cafe || null);
    }

    window.dispatchEvent(new Event('menu:cafe-selected'));
  };

  useEffect(() => {
    cafesApi.getAll().then(data => {
      setCafes(data);

      if (!data.length) {
        broadcastCafeSelection(null);
        return;
      }

      let defaultCafe = data[0];

      if (currentCafeId) {
        const currentCafe = data.find(cafe => cafe.id === currentCafeId);
        if (currentCafe) defaultCafe = currentCafe;
      }

      try {
        const storedCafeId = parseInt(window.localStorage.getItem(SELECTED_CAFE_STORAGE_KEY), 10);
        if (!Number.isNaN(storedCafeId)) {
          const storedCafe = data.find(cafe => cafe.id === storedCafeId);
          if (storedCafe) defaultCafe = storedCafe;
        }
      } catch {
        // ignore localStorage read failures
      }

      broadcastCafeSelection(defaultCafe);
    }).finally(() => setLoading(false));
  }, []);

  const handleCafeAdded = async (createdCafe) => {
    const updated = await cafesApi.getAll();
    setCafes(updated);
    setShowAddCafe(false);

    if (!updated.length) {
      broadcastCafeSelection(null);
      return;
    }

    const createdInList = createdCafe
      ? updated.find(cafe => cafe.id === createdCafe.id)
      : null;
    const existingSelection = selectedCafe
      ? updated.find(cafe => cafe.id === selectedCafe.id)
      : null;

    const nextCafe = createdInList
      || existingSelection
      || [...updated].sort((a, b) => b.id - a.id)[0]
      || updated[0];

    broadcastCafeSelection(nextCafe);
  };

  const handleSelectCafe = (cafe) => {
    broadcastCafeSelection(cafe);
  };

  const handleCafeDeleted = async (deletedCafeId) => {
    const updated = await cafesApi.getAll();
    const visibleCafes = updated.filter(cafe => cafe.id !== deletedCafeId);
    setCafes(visibleCafes);

    if (!visibleCafes.length) {
      broadcastCafeSelection(null);
      return;
    }

    const nextCafe = visibleCafes.find(cafe => cafe.active) || visibleCafes[0];
    broadcastCafeSelection(nextCafe);
  };

  const handleCafeUpdated = (updatedCafe) => {
    if (!updatedCafe?.id) return;
    setCafes((prev) => prev.map((cafe) => (cafe.id === updatedCafe.id ? updatedCafe : cafe)));
    broadcastCafeSelection(updatedCafe);
  };

  if (loading) return <Spinner />;

  return (
    <div className="app-page">
      <div className="mb-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div>
          <span className="menu-eyebrow">Operations setup</span>
          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-ink-950 md:text-[3.2rem]">Admin studio</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-ink-500">
            Manage cafes, menus, recipes, owner access, and prep timing from one polished control surface.
          </p>
        </div>
        <Card className="menu-hero-card p-6 md:p-7">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-ink-500">Network snapshot</p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-[24px] border border-white/75 bg-white/70 p-4 shadow-sm">
              <p className="text-[0.68rem] uppercase tracking-[0.16em] text-ink-500">Cafes on Menu</p>
              <p className="mt-2 font-display text-3xl text-ink-950">{cafes.length}</p>
            </div>
            <div className="rounded-[24px] border border-white/75 bg-white/70 p-4 shadow-sm">
              <p className="text-[0.68rem] uppercase tracking-[0.16em] text-ink-500">Active now</p>
              <p className="mt-2 font-display text-3xl text-teal-600">{cafes.filter((cafe) => cafe.active).length}</p>
            </div>
          </div>
          <div className="mt-5">
            <Button size="sm" onClick={() => setShowAddCafe(!showAddCafe)}>
              {showAddCafe ? 'Close setup form' : '+ Add café'}
            </Button>
          </div>
        </Card>
      </div>

      {showAddCafe && (
        <AddCafeForm onSave={handleCafeAdded} onCancel={() => setShowAddCafe(false)} />
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.92fr_1.48fr]">
        <Card className="menu-hero-card p-5 md:p-6">
          <SectionHeader
            title="Cafe roster"
            subtitle={cafes.length ? 'Select a cafe to edit catalog, owners, and settings.' : 'Add your first cafe to get started.'}
          />
          <div className="flex flex-col gap-3">
            {cafes.map(cafe => (
              <CafeCard
                key={cafe.id}
                cafe={cafe}
                onSelect={handleSelectCafe}
                selected={selectedCafe?.id === cafe.id}
              />
            ))}
            {cafes.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-ink-200 bg-white/50 px-4 py-8 text-center text-sm text-ink-500">
                No cafés yet. Add your first one.
              </div>
            )}
          </div>
        </Card>

        <div>
          {selectedCafe
            ? <CafeDetail cafe={selectedCafe} onCafeDeleted={handleCafeDeleted} onCafeUpdated={handleCafeUpdated} />
            : (
              <Card className="p-10 text-center">
                <p className="font-display text-3xl font-semibold text-ink-950">Select a cafe to view details</p>
                <p className="mt-3 text-sm text-ink-500">Metrics, menus, owner access, and settings will appear here once a cafe is selected.</p>
              </Card>
            )
          }
        </div>
      </div>
    </div>
  );
}
