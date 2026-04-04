import React, { useState, useEffect } from 'react';
import { cafesApi, itemsApi, ingredientsApi, recipesApi, metricsApi } from '../../lib/api';
import { Spinner, Badge, Button, Card, SectionHeader, MetricCard } from '../shared';

const fmt$ = (v) => '$' + Math.round(Number(v) || 0).toLocaleString();
const SELECTED_CAFE_STORAGE_KEY = 'menu.selectedCafeId';

function CafeCard({ cafe, onSelect, selected }) {
  const [metrics, setMetrics] = useState(null);
  useEffect(() => {
    metricsApi.get(cafe.id).then(setMetrics).catch(() => {});
  }, [cafe.id]);

  return (
    <div
      onClick={() => onSelect(cafe)}
      className={`p-5 rounded-xl border cursor-pointer transition-all ${selected ? 'border-navy-900 bg-navy-100' : 'border-gray-100 bg-white hover:border-gray-300'}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold text-gray-900">{cafe.name}</p>
          <p className="text-xs text-gray-400">{cafe.city} &mdash; {cafe.owner_name}</p>
        </div>
        <Badge color={cafe.active ? 'green' : 'gray'}>{cafe.active ? 'Active' : 'Inactive'}</Badge>
      </div>
      {metrics && (
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="text-lg font-semibold text-teal-600">{fmt$(metrics.allTime.totalSavings)}</p>
            <p className="text-xs text-gray-400">saved</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-gray-700">{metrics.daysRunning}</p>
            <p className="text-xs text-gray-400">days</p>
          </div>
          <div className="text-center">
            <p className={`text-lg font-semibold ${metrics.allTime.total86 === 0 ? 'text-teal-600' : 'text-red-500'}`}>{metrics.allTime.total86}</p>
            <p className="text-xs text-gray-400">86 incidents</p>
          </div>
        </div>
      )}
    </div>
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
    <Card className="p-6 mb-6">
      <p className="font-semibold text-gray-900 mb-4">Add new cafe</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {[
          { key: "name", label: "Cafe name" },
          { key: "owner_name", label: "Owner name" },
          { key: "email", label: "Owner email" },
          { key: "kitchen_lead_email", label: "Kitchen lead email" },
          { key: "city", label: "City" }
        ].map(({ key, label }) => (
          <div key={key}>
            <label className="block text-xs text-gray-400 mb-1">{label}</label>
            <input
              value={form[key]}
              onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
            />
          </div>
        ))}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Holiday behaviour</label>
          <select
            value={form.holiday_behaviour}
            onChange={e => setForm(p => ({ ...p, holiday_behaviour: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
          >
            <option>Manual</option>
            <option>Reduced</option>
            <option>Closed</option>
            <option>Sunday pattern</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Prep email time</label>
          <input
            type="time"
            value={form.prep_send_time}
            onChange={e => setForm(p => ({ ...p, prep_send_time: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-3">{error}</p>
      )}

      <div className="flex gap-2">
        <Button onClick={handleSubmit} size="sm" disabled={saving}>
          {saving ? "Adding..." : "Add cafe"}
        </Button>
        <Button variant="ghost" onClick={onCancel} size="sm" disabled={saving}>Cancel</Button>
      </div>
    </Card>
  );
}

function CafeDetail({ cafe, onCafeDeleted }) {
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
      await cafesApi.setPrepTime(cafe.id, prepSendTime);
      setPrepTimeMessage('Prep email time saved.');
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setPrepTimeMessage(apiError || 'Could not save prep email time.');
    } finally {
      setSavingPrepTime(false);
    }
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
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">{cafe.name}</h2>
        <p className="text-sm text-gray-400">{cafe.city} &mdash; {cafe.email}</p>
      </div>

      {/* Metrics row */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MetricCard label="Total savings" value={fmt$(metrics.allTime.totalSavings)} color="text-teal-600" />
          <MetricCard label="Days running" value={metrics.daysRunning} />
          <MetricCard label="86 incidents" value={metrics.allTime.total86} color={metrics.allTime.total86 === 0 ? 'text-teal-600' : 'text-red-500'} />
          <MetricCard label="Waste reduction" value={metrics.wasteReductionPct + '%'} color="text-teal-600" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-100 mb-6 gap-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === t.key ? 'text-navy-900 border-b-2 border-navy-900' : 'text-gray-400 hover:text-gray-600'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Menu items tab */}
      {tab === 'menu' && (
        <div>
          <SectionHeader
            title={`${items.length} items`}
            action={<Button size="sm" onClick={() => setShowAddItem(!showAddItem)}>+ Add item</Button>}
          />

          {showAddItem && (
            <Card className="p-4 mb-4">
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Name</label>
                  <input value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Category</label>
                  <select value={newItem.category} onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900">
                    <option>Beverage</option>
                    <option>Food</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Price ($)</label>
                  <input type="number" value={newItem.price} onChange={e => setNewItem(p => ({ ...p, price: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddItem}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAddItem(false)}>Cancel</Button>
              </div>
            </Card>
          )}

          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50">
                  {['Name', 'Category', 'Price', 'Status'].map(h => (
                    <th key={h} className="text-left text-xs text-gray-400 font-medium px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{item.name}</td>
                    <td className="px-5 py-3 text-gray-500">{item.category}</td>
                    <td className="px-5 py-3 text-gray-700">${parseFloat(item.price || 0).toFixed(2)}</td>
                    <td className="px-5 py-3">
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

      {/* Ingredients tab */}
      {tab === 'ingredients' && (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50">
                {['Ingredient', 'Unit', 'Par level', 'Shelf life', 'Cost/unit'].map(h => (
                  <th key={h} className="text-left text-xs text-gray-400 font-medium px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ingredients.map(ing => (
                <tr key={ing.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">{ing.name}</td>
                  <td className="px-5 py-3 text-gray-500">{ing.unit}</td>
                  <td className="px-5 py-3 text-gray-700">{ing.par_level}</td>
                  <td className="px-5 py-3 text-gray-500">{ing.shelf_life_days} days</td>
                  <td className="px-5 py-3 text-gray-700">${parseFloat(ing.cost_per_unit || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Recipes tab */}
      {tab === 'recipes' && (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50">
                {['Menu item', 'Ingredient', 'Qty per portion', 'Unit', 'Station'].map(h => (
                  <th key={h} className="text-left text-xs text-gray-400 font-medium px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recipes.map(r => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">{r.item_name}</td>
                  <td className="px-5 py-3 text-gray-700">{r.ingredient_name}</td>
                  <td className="px-5 py-3 text-gray-500">{r.qty_per_portion}</td>
                  <td className="px-5 py-3 text-gray-400">{r.unit}</td>
                  <td className="px-5 py-3"><Badge color="blue">{r.station}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Settings tab */}
      {tab === 'settings' && (
        <Card className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { label: 'Café name', value: cafe.name },
              { label: 'Owner name', value: cafe.owner_name },
              { label: 'Owner email', value: cafe.email },
              { label: 'Kitchen lead email', value: cafe.kitchen_lead_email },
              { label: 'City', value: cafe.city },
              { label: 'Holiday behaviour', value: cafe.holiday_behaviour }
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className="text-sm font-medium text-gray-900">{value || '—'}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-400 mb-2">Prep email time (Toronto timezone)</p>
            <div className="flex items-center gap-2 max-w-xs">
              <input
                type="time"
                value={prepSendTime}
                onChange={e => setPrepSendTime(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
              />
              <Button size="sm" onClick={handleSavePrepTime} disabled={savingPrepTime}>
                {savingPrepTime ? 'Saving...' : 'Save'}
              </Button>
            </div>
            {prepTimeMessage && (
              <p className={`text-xs mt-2 ${prepTimeMessage.includes('saved') ? 'text-teal-600' : 'text-red-600'}`}>
                {prepTimeMessage}
              </p>
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-400 mb-2">Danger zone</p>
            <Button
              size="sm"
              variant="danger"
              onClick={handleDeleteCafe}
              disabled={deletingCafe}
            >
              {deletingCafe ? 'Deleting...' : 'Delete cafe'}
            </Button>
            {deleteMessage && (
              <p className={`text-xs mt-2 ${deleteMessage.includes('deleted') ? 'text-teal-600' : 'text-red-600'}`}>
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

  if (loading) return <Spinner />;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Admin</h1>
          <p className="text-sm text-gray-400 mt-0.5">{cafes.length} café{cafes.length !== 1 ? 's' : ''} on Menu</p>
        </div>
        <Button size="sm" onClick={() => setShowAddCafe(!showAddCafe)}>+ Add café</Button>
      </div>

      {showAddCafe && (
        <AddCafeForm onSave={handleCafeAdded} onCancel={() => setShowAddCafe(false)} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Cafe list */}
        <div className="md:col-span-1">
          <SectionHeader title="Cafés" />
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
              <div className="text-center py-8 text-sm text-gray-400">
                No cafés yet. Add your first one.
              </div>
            )}
          </div>
        </div>

        {/* Cafe detail */}
        <div className="md:col-span-2">
          {selectedCafe
            ? <CafeDetail cafe={selectedCafe} onCafeDeleted={handleCafeDeleted} />
            : <div className="text-center py-16 text-sm text-gray-400">Select a café to view details</div>
          }
        </div>
      </div>
    </div>
  );
}
