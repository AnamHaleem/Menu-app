import React, { useState, useEffect } from 'react';
import { prepListApi, forecastApi } from '../../lib/api';
import { Spinner, Badge, Button, Card } from '../shared';

const STATION_COLORS = {
  Coffee: 'bg-amber-50 border-amber-200 text-amber-800',
  Cold: 'bg-blue-50 border-blue-200 text-blue-800',
  Hot: 'bg-red-50 border-red-200 text-red-800',
  Pastry: 'bg-purple-50 border-purple-200 text-purple-800'
};

const STATION_DOT = {
  Coffee: 'bg-amber-400',
  Cold: 'bg-blue-400',
  Hot: 'bg-red-400',
  Pastry: 'bg-purple-400'
};

export default function KitchenView({ cafeId, cafeName }) {
  const [prepList, setPrepList] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const today = new Date().toISOString().split('T')[0];

  const load = async () => {
    if (!cafeId) return;
    try {
      const [list, fc] = await Promise.all([
        prepListApi.get(cafeId, today),
        forecastApi.get(cafeId, today)
      ]);
      setPrepList(list);
      setForecast(fc);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [cafeId]);

  const handleToggle = async (item) => {
    const updated = await prepListApi.toggle(cafeId, item.id, !item.completed);
    setPrepList(prev => prev.map(p => p.id === item.id ? { ...p, completed: updated.completed } : p));
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await forecastApi.generate(cafeId, today);
      await load();
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <Spinner />;

  // Group by station
  const byStation = {};
  prepList.forEach(item => {
    const station = item.station || 'Other';
    if (!byStation[station]) byStation[station] = [];
    byStation[station].push(item);
  });

  const totalItems = prepList.length;
  const completedItems = prepList.filter(p => p.completed).length;
  const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  const allDone = totalItems > 0 && completedItems === totalItems;

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Today's Prep List</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {cafeName} &mdash; {new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          {forecast?.weather && (
            <div className="text-right">
              <p className="text-sm font-medium text-gray-700">{forecast.weather.condition}</p>
              <p className="text-xs text-gray-400">{forecast.weather.temp}°C</p>
            </div>
          )}
        </div>

        {/* Holiday warning */}
        {forecast?.isHoliday && forecast?.holidayBehaviour === 'Manual' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 mt-3">
            <strong>Public holiday: {forecast.holidayName}</strong> — quantities adjusted. Review before prepping.
          </div>
        )}

        {forecast?.closed && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mt-3">
            <strong>Closed today</strong> — {forecast.holiday}. No prep required.
          </div>
        )}

        {forecast?.learning && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800 mt-3">
            <strong>Auto-learning</strong>{' '}
            {forecast.learning.enabled
              ? `active — adjusted ${forecast.learning.itemsAdjusted || 0} item(s) using ${forecast.learning.itemsWithHistory || 0} item(s) with history.`
              : 'not active yet. Run backend migrations to enable item-level tuning.'}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {totalItems > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">{completedItems} of {totalItems} items done</span>
            <span className={`text-sm font-semibold ${allDone ? 'text-teal-600' : 'text-gray-700'}`}>{pct}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-teal-500' : 'bg-navy-900'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {allDone && (
            <p className="text-center text-sm text-teal-600 font-medium mt-3">All prepped — great work!</p>
          )}
        </div>
      )}

      {/* No prep list yet */}
      {prepList.length === 0 && (
        <Card className="p-8 text-center mb-6">
          <p className="text-gray-400 text-sm mb-4">No prep list for today yet.</p>
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating...' : 'Generate today\'s prep list'}
          </Button>
        </Card>
      )}

      {/* Prep list by station */}
      {Object.entries(byStation).map(([station, items]) => {
        const stationColor = STATION_COLORS[station] || 'bg-gray-50 border-gray-200 text-gray-700';
        const dotColor = STATION_DOT[station] || 'bg-gray-400';
        const stationDone = items.every(i => i.completed);

        return (
          <div key={station} className="mb-5">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-t-xl border ${stationColor}`}>
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
              <span className="text-sm font-semibold uppercase tracking-wider">{station}</span>
              {stationDone && <span className="ml-auto text-xs font-medium opacity-70">Done</span>}
            </div>
            <div className="bg-white border border-t-0 border-gray-100 rounded-b-xl overflow-hidden">
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-4 px-4 py-4 cursor-pointer hover:bg-gray-50 transition-colors
                    ${idx < items.length - 1 ? 'border-b border-gray-50' : ''}
                    ${item.completed ? 'opacity-50' : ''}`}
                  onClick={() => handleToggle(item)}
                >
                  {/* Checkbox */}
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all
                    ${item.completed ? 'bg-teal-500 border-teal-500' : 'border-gray-300'}`}>
                    {item.completed && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>

                  {/* Name */}
                  <span className={`flex-1 text-base font-medium ${item.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                    {item.ingredient_name}
                  </span>

                  {/* Quantity */}
                  <span className={`text-base font-semibold ${item.completed ? 'text-gray-300' : 'text-navy-900'}`}>
                    {parseFloat(item.quantity_needed)} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Regenerate button */}
      {prepList.length > 0 && (
        <div className="mt-4 text-center">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            {generating ? 'Regenerating...' : 'Regenerate prep list'}
          </button>
          {lastUpdated && (
            <p className="text-xs text-gray-300 mt-1">
              Last updated {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
