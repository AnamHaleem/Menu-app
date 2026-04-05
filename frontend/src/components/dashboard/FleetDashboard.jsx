import React, { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { adminHqApi } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  DateRangePicker,
  Empty,
  MetricCard,
  SectionHeader,
  Spinner,
  buildRelativeDateRange
} from '../shared';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const fmtMoney = (value) => `$${Math.round(Number(value) || 0).toLocaleString()}`;
const fmtPct = (value) => `${Math.round(Number(value) || 0)}%`;
const fmtSignedPct = (value) => {
  const numeric = Number(value) || 0;
  return `${numeric > 0 ? '+' : ''}${Math.round(numeric)}%`;
};
const fmtDateTime = (value) => {
  if (!value) return 'Not imported yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not imported yet';
  return date.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function alertBadgeColor(severity) {
  if (severity === 'critical' || severity === 'high') return 'red';
  if (severity === 'medium') return 'amber';
  return 'blue';
}

function riskBadgeColor(level) {
  if (level === 'High') return 'red';
  if (level === 'Medium') return 'amber';
  return 'green';
}

function statusTone(value) {
  if (['Live', 'Stable', 'Strong', 'Generated today', 'Current'].includes(value)) return 'green';
  if (['Lagging', 'Watch', 'Growing', 'Behind'].includes(value)) return 'amber';
  if (['Stale', 'Missing today', 'Drift', 'No POS data', 'No actuals', 'Paused'].includes(value)) return 'red';
  return 'gray';
}

function DeltaPill({ label, value, tone = 'green' }) {
  const color = tone === 'red'
    ? 'text-red-600 bg-red-50 border-red-100'
    : tone === 'amber'
      ? 'text-amber-700 bg-amber-50 border-amber-100'
      : 'text-emerald-700 bg-emerald-50 border-emerald-100';

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${color}`}>
      {label}: {value}
    </span>
  );
}

function QuickActionButton({ label, sublabel, onClick, busy = false, variant = 'secondary' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={[
        'w-full rounded-[22px] border px-4 py-4 text-left transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'primary'
          ? 'border-blue-100 bg-blue-50 hover:bg-blue-100'
          : 'border-slate-200 bg-white hover:bg-slate-50'
      ].join(' ')}
    >
      <p className="text-sm font-semibold text-slate-900">{busy ? 'Working…' : label}</p>
      <p className="mt-1 text-xs text-slate-500">{sublabel}</p>
    </button>
  );
}

function SupportActionGrid({ selectedCafe, onAction, busyAction }) {
  if (!selectedCafe) return null;

  const actions = [
    {
      key: 'rerun_forecast',
      label: 'Rebuild forecast',
      sublabel: 'Refresh tomorrow’s prep list from the latest data and learning state.'
    },
    {
      key: 'send_prep_list',
      label: 'Resend prep list',
      sublabel: 'Trigger a manual prep email to the owner / kitchen contacts now.'
    },
    {
      key: 'refresh_learning',
      label: 'Refresh learning',
      sublabel: 'Re-sync actual-vs-forecast learning signals for this cafe.'
    },
    {
      key: 'send_check_in',
      label: 'Send check-in reminder',
      sublabel: 'Prompt the cafe to submit their end-of-day actuals.'
    }
  ];

  return (
    <div className="grid grid-cols-1 gap-3">
      {actions.map((action) => (
        <QuickActionButton
          key={action.key}
          label={action.label}
          sublabel={action.sublabel}
          busy={busyAction === action.key}
          onClick={() => onAction(action.key)}
        />
      ))}
    </div>
  );
}

function AuditFeed({ rows }) {
  if (!rows?.length) {
    return <Empty message="No admin interventions have been logged yet." />;
  }

  return (
    <div className="space-y-3">
      {rows.slice(0, 10).map((row) => (
        <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{row.summary}</p>
              <p className="mt-1 text-xs text-slate-500">
                {new Date(row.createdAt).toLocaleString('en-CA')} · {row.actorEmail || row.actorSource}
              </p>
            </div>
            <Badge color={alertBadgeColor(row.severity)}>{row.severity}</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FleetDashboard({ selectedCafe, onSelectCafe }) {
  const [dateRange, setDateRange] = useState(() => buildRelativeDateRange(30));
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionState, setActionState] = useState('');
  const [feedback, setFeedback] = useState({ tone: '', message: '' });
  const [modelDraft, setModelDraft] = useState({
    learning_enabled: true,
    ai_decision_enabled: true,
    weather_sensitivity: 1
  });

  const fetchDashboard = async () => {
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
        message: apiError || 'Could not load the fleet dashboard right now.'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [dateRange.startDate, dateRange.endDate, selectedCafe?.id]);

  useEffect(() => {
    if (!dashboard?.selectedCafe) return;
    setModelDraft({
      learning_enabled: dashboard.selectedCafe.learningEnabled,
      ai_decision_enabled: dashboard.selectedCafe.aiDecisionEnabled,
      weather_sensitivity: dashboard.selectedCafe.weatherSensitivity || 1
    });
  }, [dashboard?.selectedCafe?.cafeId, dashboard?.selectedCafe?.learningEnabled, dashboard?.selectedCafe?.aiDecisionEnabled, dashboard?.selectedCafe?.weatherSensitivity]);

  useEffect(() => {
    if (!dashboard?.selectedCafe?.cafe) return;
    if (selectedCafe?.id === dashboard.selectedCafe.cafe.id) return;
    onSelectCafe?.(dashboard.selectedCafe.cafe);
  }, [dashboard?.selectedCafe?.cafeId]);

  const chartData = useMemo(() => {
    const bars = dashboard?.chartSeries?.savingsByCafe || [];
    return {
      labels: bars.map((row) => row.cafeName),
      datasets: [
        {
          label: 'Total savings',
          data: bars.map((row) => row.totalSavings),
          backgroundColor: '#2563eb',
          borderRadius: 12,
          maxBarThickness: 42
        }
      ]
    };
  }, [dashboard?.chartSeries?.savingsByCafe]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      x: {
        ticks: { color: '#64748b', font: { size: 11 } },
        grid: { display: false }
      },
      y: {
        ticks: {
          color: '#94a3b8',
          font: { size: 11 },
          callback: (value) => `$${Number(value).toLocaleString()}`
        },
        grid: { color: 'rgba(148,163,184,0.14)' }
      }
    }
  };

  const selectedCafeDetail = dashboard?.selectedCafe || null;
  const shadowCenter = dashboard?.modelCenter?.shadow || {
    summary: {
      modelsCount: 0,
      shadowModelsCount: 0,
      comparedRows: 0,
      mlAvgAbsErrorPct: 0,
      ruleAvgAbsErrorPct: 0,
      liftPct: 0,
      avgConfidenceScore: 0,
      improvedCafes: 0,
      worseCafes: 0,
      latestImportedAt: null,
      bestModelVersionId: null,
      bestModelKey: null,
      bestModelDisplayName: null
    },
    models: [],
    cafes: [],
    bestModel: null,
    recentRuns: []
  };

  const handleSelectCafe = (row) => {
    onSelectCafe?.(row.cafe);
  };

  const handleSupportAction = async (action) => {
    if (!selectedCafeDetail) return;
    setActionState(action);
    setFeedback({ tone: '', message: '' });
    try {
      const result = await adminHqApi.runSupportAction(selectedCafeDetail.cafeId, { action });
      setFeedback({ tone: 'success', message: result.message || 'Action completed.' });
      await fetchDashboard();
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setFeedback({ tone: 'error', message: apiError || 'That support action failed.' });
    } finally {
      setActionState('');
    }
  };

  const handleSaveModelControls = async () => {
    if (!selectedCafeDetail) return;
    setActionState('save_model');
    setFeedback({ tone: '', message: '' });
    try {
      await adminHqApi.updateModelControls(selectedCafeDetail.cafeId, modelDraft);
      setFeedback({ tone: 'success', message: 'Model controls updated.' });
      await fetchDashboard();
    } catch (err) {
      const apiError = err?.response?.data?.error;
      setFeedback({ tone: 'error', message: apiError || 'Could not update model controls.' });
    } finally {
      setActionState('');
    }
  };

  if (loading) return <Spinner />;
  if (!dashboard) return <Empty message="We couldn’t assemble the fleet dashboard yet." />;

  return (
    <div className="p-4 md:p-6 max-w-[1440px] mx-auto space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.04em] text-slate-950">Fleet HQ</h1>
          <p className="mt-2 text-sm text-slate-500">
            Cross-cafe visibility for savings, adoption, forecast quality, and owner support.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="secondary" onClick={() => { window.location.hash = '/admin'; }}>
            Open cafe setup
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (selectedCafeDetail?.cafe) {
                onSelectCafe?.(selectedCafeDetail.cafe);
              }
              window.location.hash = '/kitchen';
            }}
            disabled={!selectedCafeDetail}
          >
            Open cafe operations
          </Button>
        </div>
      </div>

      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {feedback.message && (
        <Card className={`p-4 ${feedback.tone === 'error' ? 'border border-red-200 bg-red-50/90' : 'border border-emerald-200 bg-emerald-50/90'}`}>
          <p className={`text-sm font-semibold ${feedback.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
            {feedback.message}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <MetricCard label="Total savings" value={fmtMoney(dashboard.overview.totalSavings)} color="text-blue-700" sub={dashboard.range.label} />
        <MetricCard label="Waste prevented" value={fmtMoney(dashboard.overview.wasteSaved)} color="text-emerald-600" sub="modelled against baseline waste" />
        <MetricCard label="Labour saved" value={fmtMoney(dashboard.overview.labourSaved)} color="text-slate-900" sub="estimated prep time reclaimed" />
        <MetricCard label="Avg forecast accuracy" value={fmtPct(dashboard.overview.avgForecastAccuracy)} color="text-slate-900" sub={`${dashboard.overview.activeCafes} active café(s)`} />
        <MetricCard label="High-priority issues" value={dashboard.overview.criticalAlerts} color={dashboard.overview.criticalAlerts ? 'text-red-600' : 'text-emerald-600'} sub={`${dashboard.overview.prepReadyToday} cafés ready for today`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.45fr,0.95fr] gap-6">
        <Card className="p-6">
          <SectionHeader title="Savings leaderboard" action={<span className="text-xs text-slate-400">{dashboard.range.label}</span>} />
          {chartData.labels.length ? (
            <div className="h-[300px]">
              <Bar data={chartData} options={chartOptions} />
            </div>
          ) : (
            <Empty message="No savings data in the selected date range yet." />
          )}
        </Card>

        <Card className="p-6">
          <SectionHeader title="Admin alerts" action={<Badge color={dashboard.overview.criticalAlerts ? 'red' : 'green'}>{dashboard.alerts.length} open</Badge>} />
          {dashboard.alerts.length ? (
            <div className="space-y-3">
              {dashboard.alerts.slice(0, 6).map((alert, index) => (
                <div key={`${alert.cafeId}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{alert.cafeName} · {alert.description}</p>
                    </div>
                    <Badge color={alertBadgeColor(alert.severity)}>{alert.severity}</Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty message="No fleet alerts right now." />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr,0.95fr] gap-6">
        <Card className="p-6">
          <SectionHeader title="Cafe health monitor" action={<span className="text-xs text-slate-400">Click a café row to inspect or support it</span>} />
          {dashboard.cafeHealth.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Cafe', 'Savings', 'Accuracy', 'Actual capture', 'Sync', 'Forecast', 'Risk'].map((header) => (
                      <th key={header} className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dashboard.cafeHealth.map((row) => (
                    <tr
                      key={row.cafeId}
                      onClick={() => handleSelectCafe(row)}
                      className={[
                        'cursor-pointer border-b border-slate-100 transition-colors',
                        selectedCafeDetail?.cafeId === row.cafeId ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      ].join(' ')}
                    >
                      <td className="px-3 py-3 align-top">
                        <p className="font-semibold text-slate-900">{row.cafeName}</p>
                        <p className="mt-1 text-xs text-slate-500">{row.city} · {row.ownerName || 'No owner name'}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-900">{fmtMoney(row.totalSavings)}</td>
                      <td className="px-3 py-3 text-slate-700">{fmtPct(row.forecastAccuracy)}</td>
                      <td className="px-3 py-3 text-slate-700">{fmtPct(row.actualCaptureRate)}</td>
                      <td className="px-3 py-3"><Badge color={statusTone(row.syncStatus)}>{row.syncStatus}</Badge></td>
                      <td className="px-3 py-3"><Badge color={statusTone(row.forecastStatus)}>{row.forecastStatus}</Badge></td>
                      <td className="px-3 py-3"><Badge color={riskBadgeColor(row.riskLevel)}>{row.riskLevel}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty message="No cafés available yet." />
          )}
        </Card>

        <Card className="p-6">
          <SectionHeader
            title={selectedCafeDetail ? `${selectedCafeDetail.cafeName} support desk` : 'Support desk'}
            action={selectedCafeDetail ? <Badge color={riskBadgeColor(selectedCafeDetail.riskLevel)}>{selectedCafeDetail.riskLevel} risk</Badge> : null}
          />

          {selectedCafeDetail ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Owner access</p>
                  <p className="mt-2 text-[24px] leading-none font-bold text-slate-950">{selectedCafeDetail.ownerAccessCount}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Prep time</p>
                  <p className="mt-2 text-[24px] leading-none font-bold text-slate-950">{selectedCafeDetail.cafe.prep_send_time}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <DeltaPill label="Recipe coverage" value={fmtPct(selectedCafeDetail.recipeCoveragePct)} tone={selectedCafeDetail.recipeCoveragePct < 80 ? 'red' : 'green'} />
                <DeltaPill label="Learning coverage" value={fmtPct(selectedCafeDetail.learningCoveragePct)} tone={selectedCafeDetail.learningCoveragePct < 40 ? 'amber' : 'green'} />
                <DeltaPill label="Reporting" value={fmtPct(selectedCafeDetail.reportingRate)} tone={selectedCafeDetail.reportingRate < 50 ? 'amber' : 'green'} />
              </div>

              <SupportActionGrid selectedCafe={selectedCafeDetail} onAction={handleSupportAction} busyAction={actionState} />

              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Model controls</p>
                <div className="mt-4 space-y-3">
                  <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">Enable auto-learning</span>
                      <span className="mt-1 block text-xs text-slate-500">Allow item multipliers to adapt from actual-vs-forecast history.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean(modelDraft.learning_enabled)}
                      onChange={(event) => setModelDraft((prev) => ({ ...prev, learning_enabled: event.target.checked }))}
                    />
                  </label>

                  <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">Enable AI decision layer</span>
                      <span className="mt-1 block text-xs text-slate-500">Use OpenAI to apply conservative day-level adjustments on top of the base forecast.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean(modelDraft.ai_decision_enabled)}
                      onChange={(event) => setModelDraft((prev) => ({ ...prev, ai_decision_enabled: event.target.checked }))}
                    />
                  </label>

                  <label className="block rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <span className="block text-sm font-semibold text-slate-900">Weather sensitivity</span>
                    <span className="mt-1 block text-xs text-slate-500">How strongly weather shifts influence forecast quantities for this cafe.</span>
                    <div className="mt-3 flex items-center gap-3">
                      <input
                        type="range"
                        min="0.5"
                        max="1.5"
                        step="0.05"
                        value={modelDraft.weather_sensitivity}
                        onChange={(event) => setModelDraft((prev) => ({ ...prev, weather_sensitivity: Number(event.target.value) }))}
                        className="w-full"
                      />
                      <div className="w-14 text-right text-sm font-semibold text-slate-900">
                        {Number(modelDraft.weather_sensitivity).toFixed(2)}x
                      </div>
                    </div>
                  </label>
                </div>

                <div className="mt-4">
                  <Button onClick={handleSaveModelControls} disabled={actionState === 'save_model'}>
                    {actionState === 'save_model' ? 'Saving…' : 'Save model controls'}
                  </Button>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Owner-facing team</p>
                {selectedCafeDetail.ownerContacts?.length ? (
                  <div className="mt-3 space-y-2">
                    {selectedCafeDetail.ownerContacts.map((contact) => (
                      <div key={contact.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{contact.fullName}</p>
                          <p className="text-xs text-slate-500 truncate">{contact.email}</p>
                        </div>
                        <Badge color={contact.active ? 'green' : 'gray'}>{contact.accessRole}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">No owner/team access is assigned yet.</p>
                )}
              </div>
            </div>
          ) : (
            <Empty message="Select a café from the health monitor to support it here." />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="p-6">
          <SectionHeader title="Data quality center" action={<Badge color={dashboard.dataQuality.summary.lowRecipeCoverageCafes ? 'amber' : 'green'}>{dashboard.dataQuality.summary.lowRecipeCoverageCafes} low-coverage cafés</Badge>} />
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Duplicate item groups</p>
              <p className="mt-2 text-[28px] leading-none font-bold text-slate-950">{dashboard.dataQuality.summary.duplicateItemGroups}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Ingredients missing units</p>
              <p className="mt-2 text-[28px] leading-none font-bold text-slate-950">{dashboard.dataQuality.summary.ingredientsMissingUnit}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Unmapped POS rows</p>
              <p className="mt-2 text-[28px] leading-none font-bold text-slate-950">{dashboard.dataQuality.summary.unmappedTransactions}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Avg actual capture</p>
              <p className="mt-2 text-[28px] leading-none font-bold text-slate-950">{fmtPct(dashboard.overview.avgActualCaptureRate)}</p>
            </div>
          </div>

          <div className="space-y-3">
            {dashboard.dataQuality.cafes.slice(0, 6).map((row) => (
              <div key={row.cafeId} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{row.cafeName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {row.duplicateItemGroups} duplicate groups · {row.ingredientsMissingUnit} missing units · {row.unmappedTransactions} unmapped rows
                    </p>
                  </div>
                  <Badge color={riskBadgeColor(row.riskLevel)}>{row.riskLevel}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title="ML / Forecast control center" action={<Badge color={dashboard.modelCenter.summary.driftCafes ? 'red' : 'green'}>{dashboard.modelCenter.summary.driftCafes} drift cafés</Badge>} />
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Model</p>
              <p className="mt-2 text-lg font-bold text-slate-950">{dashboard.modelCenter.config.model}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Global AI switch</p>
              <p className="mt-2 text-lg font-bold text-slate-950">{dashboard.modelCenter.config.aiEnabled ? 'Enabled' : 'Off'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Learning coverage</p>
              <p className="mt-2 text-[28px] leading-none font-bold text-slate-950">{fmtPct(dashboard.modelCenter.summary.avgLearningCoveragePct)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Avg abs error</p>
              <p className="mt-2 text-[28px] leading-none font-bold text-slate-950">{fmtPct(dashboard.modelCenter.summary.avgAbsErrorPct)}</p>
            </div>
          </div>

          <div className="space-y-3">
            {dashboard.modelCenter.cafes.slice(0, 6).map((row) => (
              <div key={row.cafeId} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{row.cafeName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {fmtPct(row.learningCoveragePct)} learning coverage · {row.actualForecastSamples} matched samples · weather {Number(row.weatherSensitivity || 1).toFixed(2)}x
                    </p>
                  </div>
                  <Badge color={statusTone(row.forecastStatus)}>{row.forecastStatus}</Badge>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-[24px] border border-blue-100 bg-blue-50/70 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">Shadow model performance</p>
                <p className="mt-1 text-sm text-slate-600">
                  Compare candidate model predictions against the live rules engine without changing production forecasts.
                </p>
              </div>
              <Badge color={shadowCenter.summary.liftPct > 0 ? 'green' : shadowCenter.summary.modelsCount ? 'amber' : 'gray'}>
                {shadowCenter.summary.modelsCount ? `${fmtSignedPct(shadowCenter.summary.liftPct)} vs rules` : 'No shadow model imported'}
              </Badge>
            </div>

            {shadowCenter.summary.modelsCount ? (
              <>
                <div className="mt-4 grid grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="rounded-2xl border border-white/70 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Best shadow model</p>
                    <p className="mt-2 text-sm font-bold text-slate-950">{shadowCenter.summary.bestModelDisplayName || shadowCenter.summary.bestModelKey}</p>
                    <p className="mt-1 text-xs text-slate-500">{shadowCenter.summary.comparedRows} compared rows</p>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Shadow error</p>
                    <p className="mt-2 text-[28px] leading-none font-bold text-slate-950">{fmtPct(shadowCenter.summary.mlAvgAbsErrorPct)}</p>
                    <p className="mt-1 text-xs text-slate-500">Confidence {fmtPct(shadowCenter.summary.avgConfidenceScore * 100)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Rules error</p>
                    <p className="mt-2 text-[28px] leading-none font-bold text-slate-950">{fmtPct(shadowCenter.summary.ruleAvgAbsErrorPct)}</p>
                    <p className="mt-1 text-xs text-slate-500">Improved cafés: {shadowCenter.summary.improvedCafes}</p>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Latest import</p>
                    <p className="mt-2 text-sm font-bold text-slate-950">{fmtDateTime(shadowCenter.summary.latestImportedAt)}</p>
                    <p className="mt-1 text-xs text-slate-500">{shadowCenter.summary.shadowModelsCount} shadow-ready model(s)</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-white/70 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Model comparison</p>
                    <div className="mt-3 space-y-3">
                      {shadowCenter.models.slice(0, 4).map((row) => (
                        <div key={row.modelVersionId} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{row.displayName}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {row.comparedRows} rows · {row.cafesCovered} cafés · {fmtPct(row.avgConfidenceScore * 100)} confidence
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-slate-900">{fmtPct(row.mlAvgAbsErrorPct)}</p>
                              <p className={`mt-1 text-xs font-semibold ${row.liftPct > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{fmtSignedPct(row.liftPct)} vs rules</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/70 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Cafés improved by the best model</p>
                    <div className="mt-3 space-y-3">
                      {shadowCenter.cafes.slice(0, 4).map((row) => (
                        <div key={row.cafeId} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{row.cafeName}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                ML {fmtPct(row.mlAvgAbsErrorPct)} · rules {fmtPct(row.ruleAvgAbsErrorPct)} · {row.comparedRows} matched rows
                              </p>
                            </div>
                            <Badge color={row.liftPct > 0 ? 'green' : row.liftPct < 0 ? 'amber' : 'gray'}>{fmtSignedPct(row.liftPct)}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-white px-4 py-5">
                <p className="text-sm font-semibold text-slate-900">No shadow models imported yet</p>
                <p className="mt-1 text-xs text-slate-500">
                  Once your training script produces candidate predictions, import them through the admin ML shadow endpoint and we’ll compare them against live rule-based forecasts here.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="p-6">
          <SectionHeader title="Benchmarking" action={<span className="text-xs text-slate-400">Who is leading and who needs intervention?</span>} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Top savings</p>
              <div className="mt-3 space-y-3">
                {dashboard.benchmarking.topSavings.map((row, index) => (
                  <div key={row.cafeId} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{index + 1}. {row.cafeName}</p>
                      <p className="text-xs text-slate-500">{fmtPct(row.wasteReductionPct)} waste reduction</p>
                    </div>
                    <span className="text-sm font-semibold text-blue-700">{fmtMoney(row.totalSavings)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Highest risk</p>
              <div className="mt-3 space-y-3">
                {dashboard.benchmarking.highestRisk.map((row, index) => (
                  <div key={row.cafeId} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{index + 1}. {row.cafeName}</p>
                      <p className="text-xs text-slate-500">{row.issueCount} active issue(s)</p>
                    </div>
                    <Badge color={riskBadgeColor(row.riskLevel)}>{row.riskLevel}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title="Audit trail" action={<span className="text-xs text-slate-400">Support actions and control changes</span>} />
          <AuditFeed rows={dashboard.auditTrail} />
        </Card>
      </div>
    </div>
  );
}
