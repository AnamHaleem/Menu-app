import React, { useEffect, useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { metricsApi, logsApi, weatherApi, forecastApi } from '../../lib/api';
import { MetricCard, Spinner, SectionHeader, Button, Card, Badge } from '../shared';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

const fmt$ = (v) => '$' + Math.round(Number(v) || 0).toLocaleString();
const fmtPct = (v) => Math.round(Number(v) || 0) + '%';
const fmtMult = (v) => `${Number(v || 1).toFixed(2)}x`;

function QuickStat({ label, value, sublabel }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/10 p-4">
      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/50">{label}</p>
      <p className="mt-3 font-display text-3xl text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-white/60">{sublabel}</p>
    </div>
  );
}

function CommandStat({ label, value, sublabel }) {
  return (
    <div className="rounded-[24px] border border-white/75 bg-white/75 p-4 shadow-sm">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-ink-500">{label}</p>
      <p className="mt-2 text-2xl font-display font-semibold text-ink-950">{value}</p>
      <p className="mt-2 text-sm text-ink-500">{sublabel}</p>
    </div>
  );
}

export default function OwnerDashboard({ cafeId, cafeName, dataApi = null }) {
  const metricsClient = dataApi?.metrics || metricsApi;
  const logsClient = dataApi?.logs || logsApi;
  const weatherClient = dataApi?.weather || weatherApi;
  const forecastClient = dataApi?.forecast || forecastApi;

  const [metrics, setMetrics] = useState(null);
  const [logs, setLogs] = useState([]);
  const [weather, setWeather] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [logForm, setLogForm] = useState({ waste_value: '', items_86d: '', actual_covers: '', notes: '' });
  const [showLogForm, setShowLogForm] = useState(false);

  useEffect(() => {
    if (!cafeId) return;

    setLoading(true);
    Promise.all([
      metricsClient.get(cafeId),
      logsClient.get(cafeId, 42),
      weatherClient.get('Toronto'),
      forecastClient.get(cafeId, new Date().toISOString().split('T')[0])
    ])
      .then(([nextMetrics, nextLogs, nextWeather, nextForecast]) => {
        setMetrics(nextMetrics);
        setLogs(nextLogs);
        setWeather(nextWeather);
        setForecast(nextForecast);
      })
      .finally(() => setLoading(false));
  }, [cafeId, metricsClient, logsClient, weatherClient, forecastClient]);

  const handleSendPrepList = async () => {
    setSending(true);
    try {
      const result = await forecastClient.sendEmail(cafeId, new Date().toISOString().split('T')[0]);
      const recipient = result?.to || 'recipient email';
      window.alert(`Prep list sent to ${recipient}`);
    } catch (error) {
      const apiMessage = error?.response?.data?.error;
      window.alert('Failed to send: ' + (apiMessage || error.message));
    } finally {
      setSending(false);
    }
  };

  const handleLogSubmit = async () => {
    const today = new Date().toISOString().split('T')[0];
    await logsClient.create(cafeId, { date: today, ...logForm });
    const updatedLogs = await logsClient.get(cafeId, 42);
    const updatedMetrics = await metricsClient.get(cafeId);
    setLogs(updatedLogs);
    setMetrics(updatedMetrics);
    setShowLogForm(false);
    setLogForm({ waste_value: '', items_86d: '', actual_covers: '', notes: '' });
  };

  if (loading) {
    return (
      <div className="app-page">
        <Spinner />
      </div>
    );
  }

  const last42 = logs.slice(0, 42).reverse();
  const labels = last42.map((log) => {
    const date = new Date(log.date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const wasteChartData = {
    labels,
    datasets: [
      {
        label: 'Waste ($)',
        data: last42.map((log) => parseFloat(log.waste_value || 0)),
        borderColor: '#DF6A4F',
        backgroundColor: 'rgba(223, 106, 79, 0.14)',
        fill: true,
        tension: 0.35,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2.5
      }
    ]
  };

  const incidentChartData = {
    labels,
    datasets: [
      {
        label: '86 Incidents',
        data: last42.map((log) => parseInt(log.items_86d || 0, 10)),
        backgroundColor: last42.map((log) => (parseInt(log.items_86d || 0, 10) === 0 ? '#169673' : '#DF6A4F')),
        borderRadius: 14,
        borderSkipped: false
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 30, 51, 0.94)',
        titleColor: '#ffffff',
        bodyColor: 'rgba(255, 255, 255, 0.9)',
        padding: 14,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        borderWidth: 1,
        cornerRadius: 14
      }
    },
    scales: {
      x: {
        ticks: { color: '#7B8FA6', font: { size: 10 }, maxTicksLimit: 10 },
        grid: { color: 'rgba(123, 143, 166, 0.12)', drawBorder: false }
      },
      y: {
        ticks: { color: '#7B8FA6', font: { size: 10 } },
        grid: { color: 'rgba(123, 143, 166, 0.12)', drawBorder: false },
        beginAtZero: true
      }
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

  const todayLabel = new Date().toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="app-page">
      <div className="mb-6 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Card tone="dark" className="menu-hero-card p-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/70">
              Operations cockpit
            </span>
            {forecast?.isHoliday && <Badge color="amber">{forecast.holidayName}</Badge>}
          </div>

          <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight text-white md:text-[3.4rem]">
            {cafeName}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-white/70">
            {weather ? `${weather.condition}, ${weather.temp}°C in Toronto` : 'Weather feed loading'}
            <span className="mx-3 text-white/25">•</span>
            {todayLabel}
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <QuickStat
              label="Total savings"
              value={fmt$(metrics?.allTime?.totalSavings)}
              sublabel={`Projected annual ${fmt$(metrics?.allTime?.annualised)}`}
            />
            <QuickStat
              label="Forecast accuracy"
              value={fmtPct(metrics?.forecastAccuracy)}
              sublabel={`${metrics?.daysRunning || 0} live operating day${metrics?.daysRunning === 1 ? '' : 's'}`}
            />
            <QuickStat
              label="86 incidents"
              value={metrics?.allTime?.total86 || 0}
              sublabel={metrics?.allTime?.total86 === 0 ? 'Zero recorded so far' : 'Tracked since go-live'}
            />
          </div>
        </Card>

        <Card className="menu-hero-card p-6 md:p-7">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-ink-500">Today&apos;s command center</p>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-ink-950">Capture the day while it&apos;s happening.</h2>
          <p className="mt-3 text-sm leading-7 text-ink-500">
            Send the prep brief to the kitchen, then log real results so the forecast loop gets sharper over time.
          </p>

          <div className="mt-7 flex flex-wrap gap-4 rounded-[24px] bg-ink-100/50 p-2">
            <Button onClick={handleSendPrepList} disabled={sending} size="lg">
              {sending ? 'Sending...' : 'Send prep list'}
            </Button>
            <Button variant="secondary" onClick={() => setShowLogForm((current) => !current)} size="lg">
              {showLogForm ? 'Hide log form' : 'Log today'}
            </Button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <CommandStat
              label="Waste reduction"
              value={fmtPct(metrics?.wasteReductionPct)}
              sublabel="Compared with week-one baseline."
            />
            <CommandStat
              label="Learning loop"
              value={forecast?.learning?.enabled ? 'Active' : 'Pending'}
              sublabel={
                forecast?.learning?.enabled
                  ? `${forecast.learning.itemsAdjusted || 0} item(s) adjusted today.`
                  : 'Run backend migrations to unlock item-level tuning.'
              }
            />
          </div>
        </Card>
      </div>

      {showLogForm && (
        <Card className="menu-hero-card mb-6 p-6 md:p-7">
          <SectionHeader title="Daily log" subtitle="Capture actual waste, 86s, footfall, and context while it is fresh." />
          <div className="grid gap-4 md:grid-cols-4">
            {[
              { key: 'waste_value', label: 'Waste value ($)', type: 'number' },
              { key: 'items_86d', label: '86 incidents', type: 'number' },
              { key: 'actual_covers', label: 'Customers served', type: 'number' },
              { key: 'notes', label: 'Notes', type: 'text' }
            ].map(({ key, label, type }) => (
              <div key={key}>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">{label}</label>
                <input
                  type={type}
                  value={logForm[key]}
                  onChange={(event) => setLogForm((prev) => ({ ...prev, [key]: event.target.value }))}
                  className="w-full rounded-2xl px-4 py-3 text-sm"
                />
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-4 rounded-[24px] bg-ink-100/45 p-2">
            <Button onClick={handleLogSubmit} size="lg">Save today&apos;s numbers</Button>
            <Button variant="ghost" onClick={() => setShowLogForm(false)} size="lg">Cancel</Button>
          </div>
        </Card>
      )}

      {metrics && (
        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Waste saved all time"
            value={fmt$(metrics.allTime.wasteSaved)}
            sub="Compared with projected waste without the system."
            color="text-teal-600"
            accent="mint"
          />
          <MetricCard
            label="Waste saved this month"
            value={fmt$(metrics.last30.waste)}
            sub="Captured in the last 30 days."
            accent="brand"
          />
          <MetricCard
            label="Labour saved"
            value={fmt$(metrics.allTime['labourSaved$'])}
            sub="Calculated at a $21/hr kitchen lead rate."
            color="text-navy-900"
            accent="sand"
          />
          <MetricCard
            label="86 incidents this month"
            value={metrics.last30.incidents86}
            sub={metrics.last30.incidents86 === 0 ? 'No incidents recorded this month.' : 'Track closely and adjust recipes.'}
            color={metrics.last30.incidents86 === 0 ? 'text-teal-600' : 'text-red-500'}
            accent={metrics.last30.incidents86 === 0 ? 'mint' : 'coral'}
          />
        </div>
      )}

      {forecast?.learning && (
        <Card className="menu-hero-card mb-6 p-6 md:p-7">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <SectionHeader
                title="Auto-learning loop"
                subtitle="Menu compares actual prep with net need so future recommendations can tune themselves."
              />
            </div>
            <Badge color={forecast.learning.enabled ? 'green' : 'amber'}>
              {forecast.learning.enabled ? 'Learning active' : 'Learning pending'}
            </Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Items with history"
              value={forecast.learning.itemsWithHistory || 0}
              sub="Matched actual-vs-forecast samples."
              accent="brand"
              className="p-4"
            />
            <MetricCard
              label="Items adjusted"
              value={forecast.learning.itemsAdjusted || 0}
              sub="Multiplier moved away from 1.00."
              color="text-teal-600"
              accent="mint"
              className="p-4"
            />
            <MetricCard
              label="History window"
              value={`${forecast.learning.historyDays || 0}d`}
              sub="Rolling lookback used for tuning."
              accent="sand"
              className="p-4"
            />
            <MetricCard
              label="Confidence samples"
              value={forecast.learning.confidenceSamples || 0}
              sub="Needed before trusting full adjustment."
              accent="coral"
              className="p-4"
            />
          </div>

          <div className="mt-6 overflow-x-auto">
            {tunedItems.length > 0 ? (
              <table className="menu-table text-sm">
                <thead>
                  <tr>
                    {['Item', 'Learning multiplier', 'Samples', 'Predicted qty'].map((heading) => (
                      <th key={heading} className="text-left">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tunedItems.map((item) => (
                    <tr key={item.name} className="hover:bg-white/50">
                      <td className="font-medium text-ink-900">{item.name}</td>
                      <td className="text-ink-700">{fmtMult(item.multiplier)}</td>
                      <td className="text-ink-500">{item.samples}</td>
                      <td className="text-ink-700">{Math.round(item.predicted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="rounded-[24px] border border-dashed border-ink-200 bg-white/60 px-5 py-4 text-sm text-ink-500">
                Learning is enabled but there are not enough historical matched samples yet for item-level tuning.
              </p>
            )}
          </div>
        </Card>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card className="menu-hero-card p-6 md:p-7">
          <SectionHeader title="Daily waste value" subtitle="Last 42 operating days" />
          <div style={{ height: 260 }}>
            <Line
              data={wasteChartData}
              options={{
                ...chartOptions,
                scales: {
                  ...chartOptions.scales,
                  y: {
                    ...chartOptions.scales.y,
                    ticks: {
                      ...chartOptions.scales.y.ticks,
                      callback: (value) => '$' + value
                    }
                  }
                }
              }}
            />
          </div>
        </Card>

        <Card className="menu-hero-card p-6 md:p-7">
          <SectionHeader title="86 incident trend" subtitle="Green bars indicate zero incidents for the day" />
          <div style={{ height: 260 }}>
            <Bar data={incidentChartData} options={chartOptions} />
          </div>
        </Card>
      </div>

      <Card className="menu-hero-card overflow-hidden">
        <div className="border-b border-white/70 px-6 py-5">
          <SectionHeader title="Daily log history" subtitle="Recent operating notes, waste, and customer counts." />
        </div>
        <div className="overflow-x-auto">
          <table className="menu-table text-sm">
            <thead>
              <tr>
                {['Date', 'Waste ($)', '86 incidents', 'Customers', 'Notes'].map((heading) => (
                  <th key={heading} className="text-left">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 14).map((log) => (
                <tr key={log.id} className="hover:bg-white/50">
                  <td className="text-ink-500">{new Date(log.date).toLocaleDateString('en-CA')}</td>
                  <td className="font-semibold text-coral-500">${parseFloat(log.waste_value || 0).toFixed(2)}</td>
                  <td>
                    {parseInt(log.items_86d || 0, 10) === 0 ? (
                      <Badge color="green">None</Badge>
                    ) : (
                      <Badge color="red">{log.items_86d}</Badge>
                    )}
                  </td>
                  <td className="text-ink-700">{log.actual_covers || '—'}</td>
                  <td className="max-w-sm text-sm text-ink-500">{log.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
