import React, { useState, useEffect } from 'react';
import { prepListApi, prepSummaryApi, forecastApi } from '../../lib/api';
import { Spinner, Button, Card } from '../shared';

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

export default function KitchenView({ cafeId, cafeName, dataApi = null }) {
  const prepClient = dataApi?.prepList || prepListApi;
  const prepSummaryClient = dataApi?.prepSummary || prepSummaryApi;
  const forecastClient = dataApi?.forecast || forecastApi;

  const [prepList, setPrepList] = useState([]);
  const [prepSummary, setPrepSummary] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [actualInputs, setActualInputs] = useState({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingToggleId, setSavingToggleId] = useState(null);
  const [savingActualId, setSavingActualId] = useState(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const today = new Date().toISOString().split('T')[0];

  const formatQty = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    if (Math.abs(number - Math.round(number)) < 0.001) return String(Math.round(number));
    return number.toFixed(1).replace(/\.0$/, '');
  };

  const getErrorMessage = (err, fallback) => err?.response?.data?.error || fallback;

  const getInitialActualInputs = (list) => {
    const next = {};
    for (const item of list) {
      const actual = item.actual_prepped_quantity;
      next[item.id] = actual === null || actual === undefined ? '' : String(Number(actual));
    }
    return next;
  };

  const loadSummary = async () => {
    const summary = await prepSummaryClient.get(cafeId, today);
    setPrepSummary(summary);
  };

  const load = async () => {
    if (!cafeId) return;
    setError('');
    try {
      const [list, fc, summary] = await Promise.all([
        prepClient.get(cafeId, today),
        forecastClient.get(cafeId, today),
        prepSummaryClient.get(cafeId, today)
      ]);
      setPrepList(list);
      setForecast(fc);
      setPrepSummary(summary);
      setActualInputs(getInitialActualInputs(list));
      setLastUpdated(new Date());
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load prep list.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafeId, prepClient, prepSummaryClient, forecastClient]);

  const handleToggle = async (item) => {
    setSavingToggleId(item.id);
    setError('');
    try {
      const updated = await prepClient.update(cafeId, item.id, { completed: !item.completed });
      setPrepList((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, ...updated } : entry)));
      await loadSummary();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not update prep item status.'));
    } finally {
      setSavingToggleId(null);
    }
  };

  const hasActualChanged = (item) => {
    const draft = String(actualInputs[item.id] ?? '').trim();
    const current = item.actual_prepped_quantity;

    if (!draft && (current === null || current === undefined)) return false;
    if (!draft) return true;

    const parsedDraft = Number(draft);
    if (!Number.isFinite(parsedDraft)) return true;

    const parsedCurrent = current === null || current === undefined ? null : Number(current);
    if (!Number.isFinite(parsedCurrent)) return true;

    return Math.abs(parsedDraft - parsedCurrent) >= 0.001;
  };

  const handleActualSave = async (item) => {
    const raw = String(actualInputs[item.id] ?? '').trim();
    const parsed = raw === '' ? null : Number(raw);

    if (raw !== '' && !Number.isFinite(parsed)) {
      setError('Actual prep quantity must be a number.');
      return;
    }

    setSavingActualId(item.id);
    setError('');

    try {
      const updated = await prepClient.update(cafeId, item.id, {
        actual_prepped_quantity: parsed
      });

      setPrepList((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, ...updated } : entry)));
      setActualInputs((prev) => ({
        ...prev,
        [item.id]:
          updated.actual_prepped_quantity === null || updated.actual_prepped_quantity === undefined
            ? ''
            : String(Number(updated.actual_prepped_quantity))
      }));
      await loadSummary();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save actual prep quantity.'));
    } finally {
      setSavingActualId(null);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      await forecastClient.generate(cafeId, today);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not regenerate prep list.'));
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
  const summaryTotals = prepSummary?.totals || {};
  const topVarianceRows = (prepSummary?.items || [])
    .filter((item) => item.actualPreppedQty !== null)
    .sort((a, b) => Math.abs(b.varianceVsNetQty || 0) - Math.abs(a.varianceVsNetQty || 0))
    .slice(0, 6);

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

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mt-3">
            {error}
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

      {/* End-of-day variance summary */}
      {prepList.length > 0 && (
        <Card className="p-4 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">End-of-day variance</p>
              <p className="text-xs text-gray-500">Compares net need vs actual prep entered by staff.</p>
            </div>
            <p className="text-xs text-gray-500">
              Actuals captured: <strong className="text-gray-700">{summaryTotals.withActuals || 0}/{summaryTotals.itemCount || prepList.length}</strong>
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">On target</p>
              <p className="text-xl font-semibold text-teal-600">{summaryTotals.onTargetCount || 0}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Over prepped</p>
              <p className="text-xl font-semibold text-amber-600">{summaryTotals.overPreppedCount || 0}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Under prepped</p>
              <p className="text-xl font-semibold text-red-600">{summaryTotals.underPreppedCount || 0}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Completed checks</p>
              <p className="text-xl font-semibold text-navy-900">{summaryTotals.completedCount || 0}/{summaryTotals.itemCount || prepList.length}</p>
            </div>
          </div>

          {(summaryTotals.pendingActualCount || 0) > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              Enter actual prep for {summaryTotals.pendingActualCount} more item(s) to complete today&apos;s variance view.
            </p>
          )}

          {topVarianceRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Ingredient', 'Net need', 'Actual', 'Variance'].map((heading) => (
                      <th key={heading} className="text-left text-xs text-gray-400 font-medium px-2 py-2">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topVarianceRows.map((row) => {
                    const variance = Number(row.varianceVsNetQty || 0);
                    const varianceClass = variance > 0.05 ? 'text-amber-700' : variance < -0.05 ? 'text-red-600' : 'text-teal-600';
                    const variancePrefix = variance > 0 ? '+' : '';

                    return (
                      <tr key={`${row.prepId}-${row.ingredientId}`} className="border-b border-gray-50">
                        <td className="px-2 py-2 text-gray-800 font-medium">{row.ingredientName}</td>
                        <td className="px-2 py-2 text-gray-600">{formatQty(row.netQty)} {row.unit}</td>
                        <td className="px-2 py-2 text-gray-700">{formatQty(row.actualPreppedQty)} {row.unit}</td>
                        <td className={`px-2 py-2 font-semibold ${varianceClass}`}>{variancePrefix}{formatQty(variance)} {row.unit}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
                  className={`px-4 py-3 transition-colors
                    ${idx < items.length - 1 ? 'border-b border-gray-50' : ''}
                    ${item.completed ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => handleToggle(item)}
                      disabled={savingToggleId === item.id}
                      className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all
                        ${item.completed ? 'bg-teal-500 border-teal-500' : 'border-gray-300'}`}
                      aria-label={item.completed ? 'Mark as not done' : 'Mark as done'}
                    >
                      {item.completed && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <p className={`text-base font-medium ${item.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                          {item.ingredient_name}
                        </p>
                        <p className={`text-base font-semibold whitespace-nowrap ${item.completed ? 'text-gray-400' : 'text-navy-900'}`}>
                          {formatQty(item.net_quantity ?? item.quantity_needed)} {item.unit}
                        </p>
                      </div>

                      <p className="text-xs text-gray-500 mb-2">
                        Forecast {formatQty(item.forecast_quantity ?? item.quantity_needed)} {item.unit}
                        {' • '}
                        On hand {formatQty(item.on_hand_quantity)} {item.unit}
                        {' • '}
                        Net {formatQty(item.net_quantity ?? item.quantity_needed)} {item.unit}
                      </p>

                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-500">Actual prepped</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={actualInputs[item.id] ?? ''}
                            onChange={(event) => setActualInputs((prev) => ({
                              ...prev,
                              [item.id]: event.target.value
                            }))}
                            className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-navy-900"
                          />
                          <span className="text-xs text-gray-500">{item.unit}</span>
                        </div>

                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleActualSave(item)}
                          disabled={savingActualId === item.id || !hasActualChanged(item)}
                        >
                          {savingActualId === item.id ? 'Saving...' : 'Save actual'}
                        </Button>
                      </div>
                    </div>
                  </div>
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
