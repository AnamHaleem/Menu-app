import React, { useEffect, useMemo, useState } from 'react';
import { adminHqApi } from '../../lib/api';
import KitchenView from '../kitchen/KitchenView';
import { Badge, Button, Card, DateRangePicker, Empty, MetricCard, Spinner, buildRelativeDateRange } from '../shared';

const TODAY_ISO = new Date().toISOString().split('T')[0];

const fmtMoney = (value) => `$${Math.round(Number(value) || 0).toLocaleString()}`;
const fmtPct = (value) => `${Math.round(Number(value) || 0)}%`;
const fmtDate = (value) => {
  if (!value) return 'No data yet';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
};

function badgeColorForStatus(value) {
  if (['Drift', 'Missing today', 'No POS data', 'No actuals', 'Paused', 'Stale', 'Missing'].includes(value)) return 'red';
  if (['Watch', 'Lagging', 'Behind', 'Growing', 'Warming up'].includes(value)) return 'amber';
  if (['Stable', 'Live', 'Current', 'Generated today', 'Strong'].includes(value)) return 'green';
  return 'gray';
}

function riskBadgeColor(level) {
  if (level === 'High') return 'red';
  if (level === 'Medium') return 'amber';
  return 'green';
}

function matchesFilter(row, filterKey) {
  switch (filterKey) {
    case 'attention':
      return row.riskLevel !== 'Low' || row.issueCount > 0;
    case 'prep':
      return row.prepStatus !== 'Generated today';
    case 'actuals':
      return ['No actuals', 'Behind', 'Missing'].includes(row.loggingStatus) || row.actualCaptureRate < 35;
    case 'forecast':
      return ['Watch', 'Drift', 'Warming up'].includes(row.forecastStatus);
    case 'data':
      return row.unmappedTransactions > 0 || row.duplicateItemGroups > 0 || row.ingredientsMissingUnit > 0;
    default:
      return true;
  }
}

function SupportActionButton({ label, sublabel, onClick, busy = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="w-full rounded-[22px] border border-slate-200 bg-white px-4 py-4 text-left transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <p className="text-sm font-semibold text-slate-900">{busy ? 'Working…' : label}</p>
      <p className="mt-1 text-xs text-slate-500">{sublabel}</p>
    </button>
  );
}

function QueueRow({ cafe, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(cafe)}
      className={[
        'w-full rounded-[24px] border px-4 py-4 text-left transition-all duration-200',
        selected
          ? 'border-blue-200 bg-blue-50/70 shadow-[0_8px_24px_rgba(37,99,235,0.08)]'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-950">{cafe.cafeName}</p>
          <p className="mt-1 text-xs text-slate-500">
            {cafe.city || 'City not set'}{cafe.ownerName ? ` · ${cafe.ownerName}` : ''}
          </p>
        </div>
        <Badge color={riskBadgeColor(cafe.riskLevel)}>{cafe.riskLevel} risk</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge color={badgeColorForStatus(cafe.prepStatus)}>{cafe.prepStatus}</Badge>
        <Badge color={badgeColorForStatus(cafe.loggingStatus)}>{cafe.loggingStatus}</Badge>
        <Badge color={badgeColorForStatus(cafe.forecastStatus)}>{cafe.forecastStatus}</Badge>
        <Badge color={badgeColorForStatus(cafe.syncStatus)}>{cafe.syncStatus}</Badge>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-slate-400 uppercase tracking-[0.14em] font-semibold">Actuals</p>
          <p className="mt-1 font-semibold text-slate-900">{fmtPct(cafe.actualCaptureRate)}</p>
        </div>
        <div>
          <p className="text-slate-400 uppercase tracking-[0.14em] font-semibold">Matched</p>
          <p className="mt-1 font-semibold text-slate-900">{cafe.actualForecastSamples}</p>
        </div>
        <div>
          <p className="text-slate-400 uppercase tracking-[0.14em] font-semibold">Issues</p>
          <p className="mt-1 font-semibold text-slate-900">{cafe.issueCount}</p>
        </div>
      </div>
    </button>
  );
}

export default function CafeOpsConsole({ selectedCafe, onSelectCafe }) {
  const [dateRange, setDateRange] = useState(() => buildRelativeDateRange(30));
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterKey, setFilterKey] = useState('all');
  const [query, setQuery] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [feedback, setFeedback] = useState({ tone: '', message: '' });
  const [workspaceVersion, setWorkspaceVersion] = useState(0);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const snapshot = await adminHqApi.get({
        ...dateRange,
        selectedCafeId: selectedCafe?.id || undefined
      });
      setDashboard(snapshot);
      setFeedback((prev) => (prev.tone === 'error' ? prev : { tone: '', message: '' }));
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setFeedback({
        tone: 'error',
        message: apiError || 'Could not load the cafe operations console right now.'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [dateRange.startDate, dateRange.endDate, selectedCafe?.id]);

  useEffect(() => {
    const resolvedCafe = dashboard?.selectedCafe?.cafe;
    if (!resolvedCafe) return;
    if (selectedCafe?.id === resolvedCafe.id) return;
    onSelectCafe?.(resolvedCafe);
  }, [dashboard?.selectedCafe?.cafeId]);

  const cafes = dashboard?.cafeHealth || [];
  const counts = useMemo(() => ({
    all: cafes.length,
    attention: cafes.filter((row) => matchesFilter(row, 'attention')).length,
    prep: cafes.filter((row) => matchesFilter(row, 'prep')).length,
    actuals: cafes.filter((row) => matchesFilter(row, 'actuals')).length,
    forecast: cafes.filter((row) => matchesFilter(row, 'forecast')).length,
    data: cafes.filter((row) => matchesFilter(row, 'data')).length
  }), [cafes]);

  const filteredCafes = useMemo(() => {
    const search = query.trim().toLowerCase();
    return cafes
      .filter((row) => matchesFilter(row, filterKey))
      .filter((row) => {
        if (!search) return true;
        return (
          String(row.cafeName || '').toLowerCase().includes(search) ||
          String(row.city || '').toLowerCase().includes(search) ||
          String(row.ownerName || '').toLowerCase().includes(search)
        );
      })
      .sort((a, b) => b.riskScore - a.riskScore || a.cafeName.localeCompare(b.cafeName));
  }, [cafes, filterKey, query]);

  const selectedCafeDetail = dashboard?.selectedCafe || filteredCafes[0] || null;

  const handleSelectCafe = (row) => {
    onSelectCafe?.(row.cafe || { id: row.cafeId, name: row.cafeName });
  };

  const handleAction = async (action) => {
    if (!selectedCafeDetail?.cafeId) return;
    setBusyAction(action);
    setFeedback({ tone: '', message: '' });

    try {
      const result = await adminHqApi.runSupportAction(selectedCafeDetail.cafeId, {
        action,
        date: TODAY_ISO
      });

      setFeedback({
        tone: 'success',
        message: result?.message || 'Action completed.'
      });

      if (action === 'rerun_forecast' || action === 'refresh_learning') {
        setWorkspaceVersion((prev) => prev + 1);
      }

      await loadDashboard();
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setFeedback({
        tone: 'error',
        message: apiError || 'Could not complete that action right now.'
      });
    } finally {
      setBusyAction('');
    }
  };

  const filterTabs = [
    { key: 'all', label: 'All cafes' },
    { key: 'attention', label: 'Needs attention' },
    { key: 'prep', label: 'Prep' },
    { key: 'actuals', label: 'Actuals' },
    { key: 'forecast', label: 'Forecast' },
    { key: 'data', label: 'Data quality' }
  ];

  if (loading && !dashboard) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard label="Needs attention" value={counts.attention} sub="cafes with active issues or elevated risk" color="text-red-600" />
        <MetricCard label="Prep missing" value={counts.prep} sub="cafes without a prep list generated for today" color="text-amber-600" />
        <MetricCard label="Actuals behind" value={counts.actuals} sub="cafes missing close-out or prep actual capture" color="text-slate-900" />
        <MetricCard label="Forecast watchlist" value={counts.forecast} sub="cafes in watch, drift, or warming-up mode" color="text-blue-600" />
      </div>

      <DateRangePicker value={dateRange} onChange={setDateRange} className="mb-0" />

      {feedback.message && (
        <div className={[
          'rounded-2xl border px-4 py-3 text-sm',
          feedback.tone === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        ].join(' ')}>
          {feedback.message}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-5 items-start">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Operations queue</p>
              <h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-950">All cafes</h2>
              <p className="mt-1 text-sm text-slate-500">Filter the fleet, spot intervention needs, then drill into one cafe’s live workspace.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={loadDashboard}>Refresh</Button>
          </div>

          <div className="mt-4">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search cafe, city, or owner"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {filterTabs.map((tab) => (
              <Button
                key={tab.key}
                size="sm"
                variant={filterKey === tab.key ? 'primary' : 'secondary'}
                onClick={() => setFilterKey(tab.key)}
              >
                {tab.label} ({counts[tab.key] || 0})
              </Button>
            ))}
          </div>

          <div className="mt-5 space-y-3 max-h-[calc(100vh-22rem)] overflow-y-auto pr-1">
            {filteredCafes.length ? filteredCafes.map((row) => (
              <QueueRow
                key={row.cafeId}
                cafe={row}
                selected={selectedCafeDetail?.cafeId === row.cafeId}
                onSelect={handleSelectCafe}
              />
            )) : (
              <Empty message="No cafes match the current filter." />
            )}
          </div>
        </Card>

        {selectedCafeDetail ? (
          <div className="space-y-5">
            <Card className="p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Selected cafe</p>
                    <Badge color={riskBadgeColor(selectedCafeDetail.riskLevel)}>{selectedCafeDetail.riskLevel} risk</Badge>
                  </div>
                  <h2 className="mt-2 text-[30px] leading-none font-bold tracking-[-0.04em] text-slate-950">{selectedCafeDetail.cafeName}</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    {selectedCafeDetail.city || 'City not set'}{selectedCafeDetail.ownerName ? ` · ${selectedCafeDetail.ownerName}` : ''} · {selectedCafeDetail.ownerAccessCount} owner access seat(s)
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge color={badgeColorForStatus(selectedCafeDetail.prepStatus)}>{selectedCafeDetail.prepStatus}</Badge>
                  <Badge color={badgeColorForStatus(selectedCafeDetail.loggingStatus)}>{selectedCafeDetail.loggingStatus}</Badge>
                  <Badge color={badgeColorForStatus(selectedCafeDetail.forecastStatus)}>{selectedCafeDetail.forecastStatus}</Badge>
                  <Badge color={badgeColorForStatus(selectedCafeDetail.syncStatus)}>{selectedCafeDetail.syncStatus}</Badge>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Savings</p>
                  <p className="mt-2 text-2xl font-bold text-slate-950">{fmtMoney(selectedCafeDetail.totalSavings)}</p>
                  <p className="mt-1 text-xs text-slate-500">all-time savings tracked</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Forecast accuracy</p>
                  <p className="mt-2 text-2xl font-bold text-slate-950">{fmtPct(selectedCafeDetail.forecastAccuracy)}</p>
                  <p className="mt-1 text-xs text-slate-500">{selectedCafeDetail.actualForecastSamples} matched samples in range</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Actual capture</p>
                  <p className="mt-2 text-2xl font-bold text-slate-950">{fmtPct(selectedCafeDetail.actualCaptureRate)}</p>
                  <p className="mt-1 text-xs text-slate-500">{selectedCafeDetail.prepRowsInRange} prep rows reviewed</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Learning coverage</p>
                  <p className="mt-2 text-2xl font-bold text-slate-950">{fmtPct(selectedCafeDetail.learningCoveragePct)}</p>
                  <p className="mt-1 text-xs text-slate-500">{selectedCafeDetail.learningItems}/{selectedCafeDetail.activeItems} active items covered</p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Operational status</p>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-slate-400 text-[11px] uppercase tracking-[0.14em] font-semibold">POS sync</p>
                        <p className="mt-1 font-semibold text-slate-900">{selectedCafeDetail.syncStatus}</p>
                        <p className="mt-1 text-xs text-slate-500">Last transaction: {fmtDate(selectedCafeDetail.lastTransactionDate)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-slate-400 text-[11px] uppercase tracking-[0.14em] font-semibold">Daily actuals</p>
                        <p className="mt-1 font-semibold text-slate-900">{selectedCafeDetail.loggingStatus}</p>
                        <p className="mt-1 text-xs text-slate-500">Last close-out: {fmtDate(selectedCafeDetail.lastDailyLogDate)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-slate-400 text-[11px] uppercase tracking-[0.14em] font-semibold">Prep status</p>
                        <p className="mt-1 font-semibold text-slate-900">{selectedCafeDetail.prepStatus}</p>
                        <p className="mt-1 text-xs text-slate-500">{selectedCafeDetail.prepItemsToday} prep row(s) generated today</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-slate-400 text-[11px] uppercase tracking-[0.14em] font-semibold">Forecast health</p>
                        <p className="mt-1 font-semibold text-slate-900">{selectedCafeDetail.forecastStatus}</p>
                        <p className="mt-1 text-xs text-slate-500">Average absolute error {selectedCafeDetail.avgAbsErrorPct === null ? 'not ready' : fmtPct(selectedCafeDetail.avgAbsErrorPct)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Current issues</p>
                    <div className="mt-3 space-y-3">
                      {selectedCafeDetail.alerts?.length ? selectedCafeDetail.alerts.map((alert, index) => (
                        <div key={`${alert.title}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
                            <Badge color={alert.severity === 'high' || alert.severity === 'critical' ? 'red' : alert.severity === 'medium' ? 'amber' : 'blue'}>
                              {alert.severity}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{alert.description}</p>
                        </div>
                      )) : (
                        <Empty message="No operational issues are flagged for this cafe in the selected window." />
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Admin actions</p>
                    <div className="mt-3 grid grid-cols-1 gap-3">
                      <SupportActionButton
                        label="Rebuild forecast"
                        sublabel="Refresh the prep list from the latest ML, rules, and weather context."
                        onClick={() => handleAction('rerun_forecast')}
                        busy={busyAction === 'rerun_forecast'}
                      />
                      <SupportActionButton
                        label="Resend prep list"
                        sublabel="Send a manual prep email to the owner and kitchen contacts right now."
                        onClick={() => handleAction('send_prep_list')}
                        busy={busyAction === 'send_prep_list'}
                      />
                      <SupportActionButton
                        label="Refresh learning"
                        sublabel="Recompute learning state from the latest prep actuals and outcomes."
                        onClick={() => handleAction('refresh_learning')}
                        busy={busyAction === 'refresh_learning'}
                      />
                      <SupportActionButton
                        label="Send close-out reminder"
                        sublabel="Prompt the cafe to submit today’s numbers through the owner portal."
                        onClick={() => handleAction('send_check_in')}
                        busy={busyAction === 'send_check_in'}
                      />
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Owner contacts</p>
                    <div className="mt-3 space-y-3">
                      {selectedCafeDetail.ownerContacts?.length ? selectedCafeDetail.ownerContacts.map((contact) => (
                        <div key={contact.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900">{contact.full_name || contact.email}</p>
                              <p className="mt-1 text-xs text-slate-500 truncate">{contact.email}</p>
                            </div>
                            <Badge color={contact.active ? 'green' : 'gray'}>{contact.access_role}</Badge>
                          </div>
                        </div>
                      )) : (
                        <Empty message="No owner contacts assigned yet." />
                      )}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Data quality</p>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4">
                        <p className="text-lg font-bold text-slate-950">{selectedCafeDetail.unmappedTransactions}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-400">Unmapped tx</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4">
                        <p className="text-lg font-bold text-slate-950">{selectedCafeDetail.duplicateItemGroups}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-400">Duplicate items</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4">
                        <p className="text-lg font-bold text-slate-950">{selectedCafeDetail.ingredientsMissingUnit}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-400">Missing units</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Live execution workspace</p>
                <h3 className="mt-2 text-xl font-bold tracking-[-0.03em] text-slate-950">Prep, actuals, and variance for {selectedCafeDetail.cafeName}</h3>
                <p className="mt-1 text-sm text-slate-500">Use this section when an admin needs to step into one cafe, review today’s run sheet, or debug production behavior.</p>
              </div>

              <KitchenView
                key={`${selectedCafeDetail.cafeId}-${workspaceVersion}`}
                cafeId={selectedCafeDetail.cafeId}
                cafeName={selectedCafeDetail.cafeName}
                embedded
              />
            </Card>
          </div>
        ) : (
          <Card className="p-8">
            <Empty message="Select a cafe from the operations queue to open its workspace." />
          </Card>
        )}
      </div>
    </div>
  );
}
