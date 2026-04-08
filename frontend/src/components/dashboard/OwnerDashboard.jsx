import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { metricsApi, logsApi, weatherApi, forecastApi } from '../../lib/api';
import {
  MetricCard,
  Spinner,
  SectionHeader,
  Button,
  Card,
  Badge,
  DateRangePicker,
  buildRelativeDateRange,
  formatDateRangeLabel
} from '../shared';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

const fmt$ = (v) => '$' + Math.round(Number(v) || 0).toLocaleString();
const fmtPct = (v) => Math.round(Number(v) || 0) + '%';
const fmtMult = (v) => `${Number(v || 1).toFixed(2)}x`;

function getTodayTorontoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function normalizeLogDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

export default function OwnerDashboard({ cafeId, cafeName, dataApi = null }) {
  const location = useLocation();
  const metricsClient = dataApi?.metrics || metricsApi;
  const logsClient = dataApi?.logs || logsApi;
  const weatherClient = dataApi?.weather || weatherApi;
  const forecastClient = dataApi?.forecast || forecastApi;
  const logFormRef = useRef(null);
  const checkInRequest = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return {
      open: params.get('checkIn') === '1' || params.get('action') === 'checkin',
      logDate: normalizeLogDate(params.get('logDate')) || getTodayTorontoDate()
    };
  }, [location.search]);

  const [metrics, setMetrics] = useState(null);
  const [logs, setLogs] = useState([]);
  const [weather, setWeather] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [dateRange, setDateRange] = useState(() => buildRelativeDateRange(30));
  const [logForm, setLogForm] = useState({ waste_value: '', items_86d: '', actual_covers: '', notes: '' });
  const [showLogForm, setShowLogForm] = useState(false);

  useEffect(() => {
    if (!cafeId) return;
    setLoading(true);
    Promise.all([
      metricsClient.get(cafeId, dateRange),
      logsClient.get(cafeId, dateRange),
      weatherClient.get('Toronto'),
      forecastClient.get(cafeId, new Date().toISOString().split('T')[0])
    ]).then(([m, l, w, f]) => {
      setMetrics(m);
      setLogs(l);
      setWeather(w);
      setForecast(f);
    }).finally(() => setLoading(false));
  }, [cafeId, metricsClient, logsClient, weatherClient, forecastClient, dateRange.startDate, dateRange.endDate]);

  useEffect(() => {
    if (checkInRequest.open) {
      setShowLogForm(true);
    }
  }, [checkInRequest.open, cafeId]);

  useEffect(() => {
    if (!showLogForm) return;
    const existingLog = logs.find((log) => normalizeLogDate(log.date) === checkInRequest.logDate);
    setLogForm({
      waste_value: existingLog?.waste_value != null ? String(existingLog.waste_value) : '',
      items_86d: existingLog?.items_86d != null ? String(existingLog.items_86d) : '',
      actual_covers: existingLog?.actual_covers != null ? String(existingLog.actual_covers) : '',
      notes: existingLog?.notes || ''
    });
  }, [logs, showLogForm, checkInRequest.logDate]);

  useEffect(() => {
    if (!showLogForm || !checkInRequest.open || !logFormRef.current) return;
    logFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showLogForm, checkInRequest.open]);

  const handleSendPrepList = async () => {
    setSending(true);
    try {
      const result = await forecastClient.sendEmail(cafeId, new Date().toISOString().split('T')[0]);
      const recipient = result?.to || 'recipient email';
      alert(`Prep list sent to ${recipient}`);
    } catch (e) {
      const apiMessage = e?.response?.data?.error;
      alert('Failed to send: ' + (apiMessage || e.message));
    } finally {
      setSending(false);
    }
  };

  const handleLogSubmit = async () => {
    await logsClient.create(cafeId, { date: checkInRequest.logDate, ...logForm });
    const updated = await logsClient.get(cafeId, dateRange);
    const updatedMetrics = await metricsClient.get(cafeId, dateRange);
    setLogs(updated);
    setMetrics(updatedMetrics);
    setShowLogForm(false);
    setLogForm({ waste_value: '', items_86d: '', actual_covers: '', notes: '' });
  };

  if (loading) return <Spinner />;

  const last42 = logs.slice(0, 42).reverse();
  const labels = last42.map(l => {
    const d = new Date(l.date);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  const wasteChartData = {
    labels,
    datasets: [{
      label: 'Waste ($)',
      data: last42.map(l => parseFloat(l.waste_value || 0)),
      borderColor: '#ef4444',
      backgroundColor: 'rgba(239,68,68,0.08)',
      fill: true,
      tension: 0.3,
      pointRadius: 2,
      borderWidth: 2
    }]
  };

  const incidentChartData = {
    labels,
    datasets: [{
      label: '86 Incidents',
      data: last42.map(l => parseInt(l.items_86d || 0)),
      backgroundColor: last42.map(l => parseInt(l.items_86d || 0) === 0 ? '#1D9E75' : '#ef4444'),
      borderRadius: 4
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#9ca3af', font: { size: 10 }, maxTicksLimit: 10 }, grid: { color: 'rgba(0,0,0,0.04)' } },
      y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)' }, beginAtZero: true }
    }
  };

  const predictionEntries = Object.entries(forecast?.predictions || {});
  const tunedItems = predictionEntries
    .map(([name, details]) => ({
      name,
      multiplier: Number(details?.learningMultiplier || 1),
      samples: Number(details?.learningSamples || 0),
      predicted: Number(details?.predicted || 0)
    }))
    .filter((item) => item.samples > 0)
    .sort((a, b) => Math.abs(b.multiplier - 1) - Math.abs(a.multiplier - 1))
    .slice(0, 6);
  const analysisLabel = metrics?.range?.label || formatDateRangeLabel(dateRange.startDate, dateRange.endDate);
  const checkInDateLabel = useMemo(() => {
    const safeDate = normalizeLogDate(checkInRequest.logDate);
    if (!safeDate) return 'today';
    const parsed = new Date(`${safeDate}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return safeDate;
    return parsed.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
  }, [checkInRequest.logDate]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{cafeName}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {weather ? `${weather.condition}, ${weather.temp}°C in Toronto` : 'Loading weather...'}
            {forecast?.isHoliday && <span className="ml-2"><Badge color="amber">{forecast.holidayName}</Badge></span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowLogForm(!showLogForm)} size="sm">
            {checkInRequest.open ? 'Open close-out form' : 'Log today'}
          </Button>
          <Button onClick={handleSendPrepList} disabled={sending} size="sm">
            {sending ? 'Sending...' : 'Send prep list'}
          </Button>
        </div>
      </div>

      {checkInRequest.open && (
        <Card className="mb-6 p-5 border border-blue-100 bg-blue-50/70">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-blue-500">Daily close-out</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                Enter {checkInDateLabel}&apos;s numbers for {cafeName}.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                We&apos;ll save waste, 86 incidents, covers, and notes directly into the portal instead of sending you to a separate form.
              </p>
            </div>
            <Button size="sm" onClick={() => setShowLogForm(true)}>
              Open check-in
            </Button>
          </div>
        </Card>
      )}

      <DateRangePicker value={dateRange} onChange={setDateRange} className="mb-6" />

      {/* Daily log form */}
      {showLogForm && (
        <div ref={logFormRef}>
          <Card className="mb-6 p-5">
            <p className="text-sm font-semibold text-gray-700 mb-1">Daily numbers</p>
            <p className="text-xs text-gray-500 mb-4">Logging for {checkInDateLabel}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { key: 'waste_value', label: 'Waste value ($)', type: 'number' },
                { key: 'items_86d', label: '86 incidents', type: 'number' },
                { key: 'actual_covers', label: 'Customers served', type: 'number' },
                { key: 'notes', label: 'Notes', type: 'text' }
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-400 mb-1">{label}</label>
                  <input
                    type={type}
                    value={logForm[key]}
                    onChange={e => setLogForm(p => ({ ...p, [key]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-900"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleLogSubmit} size="sm">Save</Button>
              <Button variant="ghost" onClick={() => setShowLogForm(false)} size="sm">Cancel</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Hero metrics */}
      {metrics && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-2 gap-4 mb-4">
            <div className="col-span-2 md:col-span-1 bg-navy-900 text-white rounded-xl p-6">
              <p className="text-xs text-blue-200 uppercase tracking-wide font-medium mb-2">Savings in selected range</p>
              <p className="text-5xl font-semibold">{fmt$(metrics.allTime.totalSavings)}</p>
              <p className="text-sm text-blue-200 mt-2">Window: <strong className="text-white">{analysisLabel}</strong></p>
            </div>
            <div className="col-span-2 md:col-span-1 bg-teal-600 text-white rounded-xl p-6">
              <p className="text-xs text-green-100 uppercase tracking-wide font-medium mb-2">Forecast accuracy</p>
              <p className="text-5xl font-semibold">{fmtPct(metrics.forecastAccuracy)}</p>
              <p className="text-sm text-green-100 mt-2">Logged days: <strong className="text-white">{metrics.daysRunning}</strong></p>
            </div>
          </div>

          {/* Secondary metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <MetricCard label="Waste saved" value={fmt$(metrics.allTime.wasteSaved)} sub={analysisLabel} color="text-teal-600" />
            <MetricCard label="Waste recorded" value={fmt$(metrics.last30.waste)} sub="trailing 30 days to end date" />
            <MetricCard label="86 incidents" value={metrics.allTime.total86} sub={metrics.allTime.total86 === 0 ? 'Zero incidents' : analysisLabel} color={metrics.allTime.total86 === 0 ? 'text-teal-600' : 'text-red-500'} />
            <MetricCard label="Labour saved" value={fmt$(metrics.allTime['labourSaved$'])} sub="estimated within selected range" color="text-teal-600" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <MetricCard label="Baseline avg waste" value={fmt$(metrics.baseline.avgDailyWaste)} sub="first 7 logged days in range" />
            <MetricCard label="Avg daily waste" value={fmt$(metrics.avgDailyWasteAfter)} sub={analysisLabel} />
            <MetricCard label="Waste reduction" value={fmtPct(metrics.wasteReductionPct)} sub="vs baseline avg" color="text-teal-600" />
            <MetricCard label="86 incidents (30d)" value={metrics.last30.incidents86} sub="rolling window to end date" color={metrics.last30.incidents86 === 0 ? 'text-teal-600' : 'text-red-500'} />
          </div>

          {forecast?.learning && (
            <Card className="p-5 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Auto-learning loop</h3>
                <Badge color={forecast.learning.enabled ? 'green' : 'amber'}>
                  {forecast.learning.enabled ? 'Learning active' : 'Learning pending migration'}
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <MetricCard
                  label="Items with history"
                  value={forecast.learning.itemsWithHistory || 0}
                  sub="with actual-vs-forecast samples"
                />
                <MetricCard
                  label="Items adjusted"
                  value={forecast.learning.itemsAdjusted || 0}
                  sub="multiplier changed from 1.00"
                  color="text-teal-600"
                />
                <MetricCard
                  label="History window"
                  value={`${forecast.learning.historyDays || 0}d`}
                  sub="lookback period"
                />
                <MetricCard
                  label="Confidence samples"
                  value={forecast.learning.confidenceSamples || 0}
                  sub="to trust full adjustment"
                />
              </div>

              {tunedItems.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-50">
                        {['Item', 'Learning multiplier', 'Samples', 'Predicted qty'].map(h => (
                          <th key={h} className="text-left text-xs text-gray-400 font-medium px-3 py-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tunedItems.map(item => (
                        <tr key={item.name} className="border-b border-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-900">{item.name}</td>
                          <td className="px-3 py-2 text-gray-700">{fmtMult(item.multiplier)}</td>
                          <td className="px-3 py-2 text-gray-600">{item.samples}</td>
                          <td className="px-3 py-2 text-gray-700">{Math.round(item.predicted)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-400">
                  Learning is enabled but there are not enough historical matched samples yet for item-level tuning.
                </p>
              )}
            </Card>
          )}
        </>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card className="p-5">
          <SectionHeader title="Daily waste value" />
          <div style={{ height: 200 }}>
            <Line data={wasteChartData} options={{ ...chartOptions, scales: { ...chartOptions.scales, y: { ...chartOptions.scales.y, ticks: { ...chartOptions.scales.y.ticks, callback: v => '$' + v } } } }} />
          </div>
        </Card>
        <Card className="p-5">
          <SectionHeader title="86 incidents — green = zero" />
          <div style={{ height: 200 }}>
            <Bar data={incidentChartData} options={chartOptions} />
          </div>
        </Card>
      </div>

      {/* Recent log table */}
      <Card>
        <div className="p-5 border-b border-gray-50">
          <SectionHeader title={`Daily log — ${analysisLabel}`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50">
                {['Date', 'Waste ($)', '86 incidents', 'Customers', 'Notes'].map(h => (
                  <th key={h} className="text-left text-xs text-gray-400 font-medium px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 14).map(log => (
                <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 text-gray-500">{new Date(log.date).toLocaleDateString('en-CA')}</td>
                  <td className="px-5 py-3 text-red-500 font-medium">${parseFloat(log.waste_value || 0).toFixed(2)}</td>
                  <td className="px-5 py-3">
                    {parseInt(log.items_86d || 0) === 0
                      ? <Badge color="green">None</Badge>
                      : <Badge color="red">{log.items_86d}</Badge>}
                  </td>
                  <td className="px-5 py-3 text-gray-700">{log.actual_covers || '—'}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs max-w-xs truncate">{log.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
