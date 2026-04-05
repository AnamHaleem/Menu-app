import React, { useState, useEffect } from 'react';
import { prepListApi, prepSummaryApi, forecastApi } from '../../lib/api';
import { Spinner, Button, Card, Badge } from '../shared';

const STATION_THEMES = {
  Coffee: {
    shell: 'from-sand-100/95 via-white to-white',
    dot: 'bg-amber-500',
    text: 'text-amber-800'
  },
  Cold: {
    shell: 'from-navy-100/80 via-white to-white',
    dot: 'bg-sky-500',
    text: 'text-navy-900'
  },
  Hot: {
    shell: 'from-coral-100/90 via-white to-white',
    dot: 'bg-red-500',
    text: 'text-red-700'
  },
  Pastry: {
    shell: 'from-sand-100/80 via-white to-white',
    dot: 'bg-orange-400',
    text: 'text-amber-800'
  },
  Other: {
    shell: 'from-ink-100 via-white to-white',
    dot: 'bg-ink-500',
    text: 'text-ink-700'
  }
};

function SummaryStat({ label, value, tone = 'default' }) {
  const tones = {
    default: 'text-ink-900',
    mint: 'text-teal-600',
    amber: 'text-amber-600',
    coral: 'text-red-600'
  };

  return (
    <div className="rounded-[24px] border border-white/70 bg-white/70 p-4 shadow-sm">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-ink-500">{label}</p>
      <p className={`mt-2 text-2xl font-display font-semibold ${tones[tone] || tones.default}`}>{value}</p>
    </div>
  );
}

function NoticeBanner({ tone = 'blue', title, children }) {
  const tones = {
    blue: 'border-navy-100 bg-navy-100/60 text-navy-900',
    amber: 'border-sand-100 bg-sand-100/70 text-amber-800',
    red: 'border-red-100 bg-red-50 text-red-700'
  };

  return (
    <div className={`rounded-[24px] border px-5 py-4 ${tones[tone] || tones.blue}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-6 opacity-90">{children}</p>
    </div>
  );
}

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
      const [list, nextForecast, summary] = await Promise.all([
        prepClient.get(cafeId, today),
        forecastClient.get(cafeId, today),
        prepSummaryClient.get(cafeId, today)
      ]);
      setPrepList(list);
      setForecast(nextForecast);
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

  if (loading) {
    return (
      <div className="app-page">
        <Spinner />
      </div>
    );
  }

  const byStation = {};
  prepList.forEach((item) => {
    const station = item.station || 'Other';
    if (!byStation[station]) byStation[station] = [];
    byStation[station].push(item);
  });

  const totalItems = prepList.length;
  const completedItems = prepList.filter((item) => item.completed).length;
  const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  const allDone = totalItems > 0 && completedItems === totalItems;
  const summaryTotals = prepSummary?.totals || {};
  const topVarianceRows = (prepSummary?.items || [])
    .filter((item) => item.actualPreppedQty !== null)
    .sort((a, b) => Math.abs(b.varianceVsNetQty || 0) - Math.abs(a.varianceVsNetQty || 0))
    .slice(0, 6);

  return (
    <div className="app-page">
      <Card className="menu-hero-card border-transparent bg-ink-950 p-7 text-white shadow-float md:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/70">
                Kitchen command
              </span>
              {forecast?.weather && (
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-sm text-white/70">
                  {forecast.weather.condition} · {forecast.weather.temp}°C
                </span>
              )}
            </div>

            <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-white md:text-[3.2rem]">
              Today&apos;s Prep List
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-white/70">
              {cafeName} ·{' '}
              {new Date().toLocaleDateString('en-CA', {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
              })}
            </p>

            {lastUpdated && (
              <p className="mt-4 text-sm text-white/50">
                Last refreshed at {lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              className="border-white/10 bg-white/10 text-white shadow-none hover:bg-white/20 hover:text-white"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? 'Refreshing...' : prepList.length ? 'Refresh recommendations' : 'Generate prep list'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="mt-6 space-y-4">
        {forecast?.isHoliday && forecast?.holidayBehaviour === 'Manual' && (
          <NoticeBanner tone="amber" title={`Public holiday: ${forecast.holidayName}`}>
            Quantities were adjusted automatically. Give the list a quick review before the team starts prep.
          </NoticeBanner>
        )}

        {forecast?.closed && (
          <NoticeBanner tone="red" title="Closed today">
            {forecast.holiday}. No prep is required unless you want to regenerate manually.
          </NoticeBanner>
        )}

        {forecast?.learning && (
          <NoticeBanner tone="blue" title="Auto-learning status">
            {forecast.learning.enabled
              ? `Active now. ${forecast.learning.itemsAdjusted || 0} item(s) were tuned using ${forecast.learning.itemsWithHistory || 0} item(s) with usable history.`
              : 'Not active yet. Run backend migrations to enable item-level tuning.'}
          </NoticeBanner>
        )}

        {error && (
          <NoticeBanner tone="red" title="Kitchen sync issue">
            {error}
          </NoticeBanner>
        )}
      </div>

      {totalItems > 0 && (
        <Card className="menu-hero-card mt-6 p-6 md:p-7">
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-ink-500">Prep progress</p>
                  <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-950">
                    {completedItems} of {totalItems} item{totalItems === 1 ? '' : 's'} complete
                  </h2>
                </div>
                <Badge color={allDone ? 'green' : 'blue'}>{pct}% complete</Badge>
              </div>

              <div className="mt-5 h-3 overflow-hidden rounded-full bg-ink-100">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${allDone ? 'from-teal-600 to-navy-700' : 'from-navy-900 to-teal-600'} transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <p className="mt-4 text-sm leading-6 text-ink-500">
                {allDone
                  ? 'Everything on today’s list is complete. Great work.'
                  : 'Use the station cards below to mark completion and capture actual prep quantities as the shift moves.'}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <SummaryStat label="On target" value={summaryTotals.onTargetCount || 0} tone="mint" />
              <SummaryStat label="Over prepped" value={summaryTotals.overPreppedCount || 0} tone="amber" />
              <SummaryStat label="Under prepped" value={summaryTotals.underPreppedCount || 0} tone="coral" />
              <SummaryStat
                label="Actuals captured"
                value={`${summaryTotals.withActuals || 0}/${summaryTotals.itemCount || prepList.length}`}
                tone="default"
              />
            </div>
          </div>
        </Card>
      )}

      {prepList.length === 0 && (
        <Card className="menu-hero-card mt-6 p-8 text-center md:p-10">
          <div className="mx-auto max-w-lg">
            <span className="menu-eyebrow">Ready when you are</span>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-ink-950">No prep list has been generated for today yet.</h2>
            <p className="mt-4 text-sm leading-7 text-ink-500">
              Create the first run for today and we’ll organize prep by station, track completion, and surface end-of-day variance.
            </p>
            <div className="mt-7">
              <Button onClick={handleGenerate} disabled={generating} size="lg">
                {generating ? 'Generating...' : 'Generate today’s prep list'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {prepList.length > 0 && (
        <Card className="menu-hero-card mt-6 p-6 md:p-7">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-ink-500">Variance summary</p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-950">End-of-day variance</h2>
              <p className="mt-2 text-sm leading-6 text-ink-500">
                Compare net need against actual prep entered by the team to tighten tomorrow&apos;s recommendations.
              </p>
            </div>
            <p className="text-sm text-ink-500">
              Actuals captured:{' '}
              <strong className="font-semibold text-ink-900">
                {summaryTotals.withActuals || 0}/{summaryTotals.itemCount || prepList.length}
              </strong>
            </p>
          </div>

          {(summaryTotals.pendingActualCount || 0) > 0 && (
            <div className="mt-5 rounded-[20px] border border-sand-100 bg-sand-100/75 px-4 py-3 text-sm text-amber-800">
              Enter actual prep for {summaryTotals.pendingActualCount} more item(s) to complete today&apos;s variance view.
            </div>
          )}

          {topVarianceRows.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="menu-table text-sm">
                <thead>
                  <tr>
                    {['Ingredient', 'Net need', 'Actual', 'Variance'].map((heading) => (
                      <th key={heading} className="text-left">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topVarianceRows.map((row) => {
                    const variance = Number(row.varianceVsNetQty || 0);
                    const varianceClass = variance > 0.05 ? 'text-amber-700' : variance < -0.05 ? 'text-red-600' : 'text-teal-600';
                    const variancePrefix = variance > 0 ? '+' : '';

                    return (
                      <tr key={`${row.prepId}-${row.ingredientId}`} className="hover:bg-white/50">
                        <td className="font-medium text-ink-900">{row.ingredientName}</td>
                        <td className="text-ink-600">{formatQty(row.netQty)} {row.unit}</td>
                        <td className="text-ink-700">{formatQty(row.actualPreppedQty)} {row.unit}</td>
                        <td className={`font-semibold ${varianceClass}`}>{variancePrefix}{formatQty(variance)} {row.unit}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <div className="mt-6 space-y-5">
        {Object.entries(byStation).map(([station, items]) => {
          const theme = STATION_THEMES[station] || STATION_THEMES.Other;
          const stationDone = items.every((item) => item.completed);

          return (
            <Card key={station} className="menu-hero-card overflow-hidden">
              <div className={`border-b border-white/70 bg-gradient-to-r ${theme.shell} px-5 py-4 md:px-6`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`h-3 w-3 rounded-full ${theme.dot}`} />
                  <div>
                    <p className={`font-display text-2xl font-semibold ${theme.text}`}>{station}</p>
                    <p className="text-sm text-ink-500">{items.length} prep task{items.length === 1 ? '' : 's'} assigned to this station.</p>
                  </div>
                  {stationDone && <Badge color="green" className="ml-auto">Done</Badge>}
                </div>
              </div>

              <div className="divide-y divide-ink-100/80">
                {items.map((item) => (
                  <div key={item.id} className={`px-5 py-5 md:px-6 ${item.completed ? 'bg-white/40' : 'bg-transparent'}`}>
                    <div className="flex items-start gap-4">
                      <button
                        type="button"
                        onClick={() => handleToggle(item)}
                        disabled={savingToggleId === item.id}
                        className={`mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 transition duration-200 ${
                          item.completed
                            ? 'border-teal-600 bg-teal-600 text-white'
                            : 'border-ink-200 bg-white text-transparent hover:border-navy-700'
                        }`}
                        aria-label={item.completed ? 'Mark as not done' : 'Mark as done'}
                      >
                        {item.completed && (
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <p className={`text-lg font-semibold ${item.completed ? 'text-ink-500 line-through' : 'text-ink-950'}`}>
                              {item.ingredient_name}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-ink-500">
                              Forecast {formatQty(item.forecast_quantity ?? item.quantity_needed)} {item.unit}
                              <span className="mx-2 text-ink-200">•</span>
                              On hand {formatQty(item.on_hand_quantity)} {item.unit}
                              <span className="mx-2 text-ink-200">•</span>
                              Net need {formatQty(item.net_quantity ?? item.quantity_needed)} {item.unit}
                            </p>
                          </div>

                          <div className="inline-flex items-center rounded-full border border-navy-100 bg-navy-100/60 px-4 py-2 font-display text-xl font-semibold text-navy-900">
                            {formatQty(item.net_quantity ?? item.quantity_needed)} {item.unit}
                          </div>
                        </div>

                        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">Actual prepped</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={actualInputs[item.id] ?? ''}
                                onChange={(event) => setActualInputs((prev) => ({
                                  ...prev,
                                  [item.id]: event.target.value
                                }))}
                                className="w-28 rounded-2xl px-4 py-2.5 text-sm"
                              />
                              <span className="text-sm text-ink-500">{item.unit}</span>
                            </div>
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
            </Card>
          );
        })}
      </div>
    </div>
  );
}
