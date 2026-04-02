import React, { useState, useEffect } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { metricsApi, logsApi, weatherApi, forecastApi } from '../../lib/api';
import { MetricCard, Spinner, SectionHeader, Button, Card, Badge } from '../shared';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

const fmt$ = (v) => '$' + Math.round(Number(v) || 0).toLocaleString();
const fmtPct = (v) => Math.round(Number(v) || 0) + '%';

export default function OwnerDashboard({ cafeId, cafeName }) {
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
    Promise.all([
      metricsApi.get(cafeId),
      logsApi.get(cafeId, 42),
      weatherApi.get('Toronto'),
      forecastApi.get(cafeId, new Date().toISOString().split('T')[0])
    ]).then(([m, l, w, f]) => {
      setMetrics(m);
      setLogs(l);
      setWeather(w);
      setForecast(f);
    }).finally(() => setLoading(false));
  }, [cafeId]);

  const handleSendPrepList = async () => {
    setSending(true);
    try {
      await forecastApi.sendEmail(cafeId, new Date().toISOString().split('T')[0]);
      alert('Prep list sent successfully');
    } catch (e) {
      alert('Failed to send: ' + e.message);
    } finally {
      setSending(false);
    }
  };

  const handleLogSubmit = async () => {
    const today = new Date().toISOString().split('T')[0];
    await logsApi.create(cafeId, { date: today, ...logForm });
    const updated = await logsApi.get(cafeId, 42);
    const updatedMetrics = await metricsApi.get(cafeId);
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
            Log today
          </Button>
          <Button onClick={handleSendPrepList} disabled={sending} size="sm">
            {sending ? 'Sending...' : 'Send prep list'}
          </Button>
        </div>
      </div>

      {/* Daily log form */}
      {showLogForm && (
        <Card className="mb-6 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-4">Today's numbers</p>
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
      )}

      {/* Hero metrics */}
      {metrics && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-2 gap-4 mb-4">
            <div className="col-span-2 md:col-span-1 bg-navy-900 text-white rounded-xl p-6">
              <p className="text-xs text-blue-200 uppercase tracking-wide font-medium mb-2">Total savings since going live</p>
              <p className="text-5xl font-semibold">{fmt$(metrics.allTime.totalSavings)}</p>
              <p className="text-sm text-blue-200 mt-2">Projected annual: <strong className="text-white">{fmt$(metrics.allTime.annualised)}</strong></p>
            </div>
            <div className="col-span-2 md:col-span-1 bg-teal-600 text-white rounded-xl p-6">
              <p className="text-xs text-green-100 uppercase tracking-wide font-medium mb-2">Forecast accuracy (30-day)</p>
              <p className="text-5xl font-semibold">{fmtPct(metrics.forecastAccuracy)}</p>
              <p className="text-sm text-green-100 mt-2">Days running: <strong className="text-white">{metrics.daysRunning}</strong></p>
            </div>
          </div>

          {/* Secondary metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <MetricCard label="Waste saved all time" value={fmt$(metrics.allTime.wasteSaved)} sub="vs projected without system" color="text-teal-600" />
            <MetricCard label="Waste saved this month" value={fmt$(metrics.last30.waste)} sub="last 30 days" />
            <MetricCard label="86 incidents all time" value={metrics.allTime.total86} sub={metrics.allTime.total86 === 0 ? 'Zero incidents' : 'trending down'} color={metrics.allTime.total86 === 0 ? 'text-teal-600' : 'text-red-500'} />
            <MetricCard label="Labour saved" value={fmt$(metrics.allTime['labourSaved$'])} sub="at $21/hr kitchen lead rate" color="text-teal-600" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <MetricCard label="Avg daily waste before" value={fmt$(metrics.baseline.avgDailyWaste)} sub="week 1 baseline" />
            <MetricCard label="Avg daily waste after" value={fmt$(metrics.avgDailyWasteAfter)} sub="post-system average" />
            <MetricCard label="Waste reduction" value={fmtPct(metrics.wasteReductionPct)} sub="vs week 1 baseline" color="text-teal-600" />
            <MetricCard label="86 incidents this month" value={metrics.last30.incidents86} sub="last 30 days" color={metrics.last30.incidents86 === 0 ? 'text-teal-600' : 'text-red-500'} />
          </div>
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
          <SectionHeader title="Daily log — last 14 days" />
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
