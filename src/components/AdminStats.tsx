import React, { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Clock, IndianRupee, Loader2, RefreshCw, Store, TrendingUp } from 'lucide-react';
import type { AdminAnalyticsResponse, Language, ShopConfig } from '../types';

interface AdminStatsProps {
  lang: Language;
  token: string;
  shops: ShopConfig[];
  liveEventCounter: number;
}

interface TooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  unitPrefix?: string;
  unitSuffix?: string;
}

const ChartTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  label,
  unitPrefix = '',
  unitSuffix = '',
}) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 backdrop-blur-sm px-3.5 py-2.5 shadow-lg text-xs">
      <div className="font-semibold text-slate-900 mb-1.5 border-b border-slate-100 pb-1">
        {label}
      </div>
      <div className="space-y-1">
        {payload.map((entry, idx) => (
          <div key={`${entry.dataKey || entry.name || idx}`} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 text-slate-600">
              <span
                className="w-2.5 h-2.5 rounded-xs shrink-0"
                style={{ backgroundColor: entry.color || '#2563eb' }}
              />
              <span className="truncate max-w-[160px]">{entry.name}</span>
            </div>
            <span className="font-mono font-semibold tabular-nums text-slate-900">
              {unitPrefix}
              {typeof entry.value === 'number'
                ? Number.isInteger(entry.value)
                  ? entry.value.toLocaleString('en-IN')
                  : entry.value.toFixed(2)
                : entry.value}
              {unitSuffix}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const AdminStats: React.FC<AdminStatsProps> = ({
  lang,
  token,
  shops,
  liveEventCounter,
}) => {
  const [days, setDays] = useState<7 | 14 | 30>(14);
  const [shopFilter, setShopFilter] = useState<string>('all');
  const [peakMetric, setPeakMetric] = useState<'jobsCount' | 'pagesCount'>('jobsCount');
  const [analytics, setAnalytics] = useState<AdminAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const fetchAnalytics = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/admin/analytics?days=${days}&shopId=${encodeURIComponent(shopFilter)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!res.ok) {
        setError(lang === 'hi' ? 'आंकड़े लोड नहीं हो सके।' : 'Failed to load analytics.');
        return;
      }
      const data = (await res.json()) as AdminAnalyticsResponse;
      setAnalytics(data);
    } catch {
      setError(lang === 'hi' ? 'सर्वर से संपर्क नहीं हो सका।' : 'Unable to reach analytics server.');
    } finally {
      setLoading(false);
    }
  }, [token, days, shopFilter, lang]);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics, liveEventCounter]);

  if (loading && !analytics) {
    return (
      <div className="py-16 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error && !analytics) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-800">
        {error}
      </div>
    );
  }

  if (!analytics) return null;

  const { summary, dailyVolume, shopsMeta, revenueTrendsPerShop, peakHours } = analytics;
  const hasAnyJobs = summary.totalJobs > 0 || shopsMeta.some((s) => s.totalJobs > 0);

  return (
    <div className="space-y-6">
      {/* Filter & Timeframe Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {lang === 'hi' ? 'प्रिंट वॉल्यूम, आय व पीक ट्रैफ़िक रिपोर्ट' : 'Print Volume, Revenue & Traffic Analytics'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {lang === 'hi'
              ? `पिछले ${days} दिनों का रीयल-टाइम डेटा`
              : `Real-time store telemetry across the last ${days} days`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                  days === d
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {d}D
              </button>
            ))}
          </div>

          <select
            value={shopFilter}
            onChange={(e) => setShopFilter(e.target.value)}
            aria-label={lang === 'hi' ? 'शॉप फ़िल्टर' : 'Filter by Shop'}
            className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900"
          >
            <option value="all">{lang === 'hi' ? 'सभी शॉप्स' : 'All Shops'}</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.settings.shopName}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void fetchAnalytics()}
            disabled={loading}
            className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            aria-label="Refresh Stats"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {!hasAnyJobs && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          {lang === 'hi'
            ? 'इस अवधि में अभी कोई प्रिंट जॉब दर्ज नहीं है। जैसे ही ग्राहक प्रिंट अपलोड और पेमेंट करेंगे, चार्ट अपने आप अपडेट हो जाएंगे।'
            : 'No print jobs recorded in this period yet. Charts update automatically as customers upload documents and complete UPI payments.'}
        </div>
      )}

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{lang === 'hi' ? `आय (${days} दिन)` : `Revenue (${days}d)`}</span>
            <IndianRupee className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            ₹{summary.totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
            {summary.paidJobs} {lang === 'hi' ? 'पेड ऑर्डर' : 'paid'} · Avg ₹{summary.avgOrderValue.toFixed(0)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{lang === 'hi' ? 'प्रिंट वॉल्यूम (पेज)' : 'Print Volume'}</span>
            <BarChart3 className="w-4 h-4 text-blue-600" />
          </div>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {summary.totalPages.toLocaleString('en-IN')}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
            B&W {summary.bwPages} · Color {summary.colorPages}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{lang === 'hi' ? 'सबसे व्यस्त समय' : 'Peak Traffic Hour'}</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {summary.peakHourLabel}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
            {summary.peakHourJobs} {lang === 'hi' ? 'प्रिंट जॉब्स' : 'jobs at peak hour'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{lang === 'hi' ? 'शीर्ष ब्रांच' : 'Top Performing Shop'}</span>
            <Store className="w-4 h-4 text-slate-700" />
          </div>
          <p className="mt-1.5 text-base font-bold text-slate-900 truncate" title={summary.topShopName}>
            {summary.topShopName}
          </p>
          <p className="mt-1 text-[11px] text-emerald-700 font-mono font-semibold tabular-nums">
            ₹{summary.topShopRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Charts Grid Row 1: Daily Print Volume + Revenue Trends Per Shop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Print Volume (Stacked Bar Chart: B&W vs Color Pages) */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {lang === 'hi' ? 'दैनिक प्रिंट वॉल्यूम (B&W बनाम Color)' : 'Daily Print Volume (Pages)'}
              </h3>
              <p className="text-xs text-slate-500">
                {lang === 'hi'
                  ? 'प्रतिदिन प्रिंट हुए ब्लैक एंड वाइट और कलर पेज'
                  : 'Black & White vs Full Color pages printed per day'}
              </p>
            </div>
            <span className="text-xs font-mono font-semibold tabular-nums text-slate-700">
              {summary.totalJobs} {lang === 'hi' ? 'जॉब्स' : 'jobs'}
            </span>
          </div>

          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyVolume} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      unitSuffix={lang === 'hi' ? ' पेज' : ' pages'}
                    />
                  }
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                <Bar
                  dataKey="bwPages"
                  name={lang === 'hi' ? 'B&W पेज' : 'B&W Pages'}
                  stackId="pages"
                  fill="#1e293b"
                  radius={[0, 0, 0, 0]}
                  maxBarSize={36}
                />
                <Bar
                  dataKey="colorPages"
                  name={lang === 'hi' ? 'Color पेज' : 'Color Pages'}
                  stackId="pages"
                  fill="#2563eb"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Revenue Trends Per Shop (Multi-Line Chart) */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <span>
                  {lang === 'hi' ? 'प्रति शॉप दैनिक आय ट्रेंड' : 'Revenue Trends Per Shop'}
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                {lang === 'hi'
                  ? `सभी ${shopsMeta.length} शॉप्स की सत्यापित UPI आय (₹)`
                  : `Verified UPI revenue comparison across ${shopsMeta.length} branch${shopsMeta.length === 1 ? '' : 'es'}`}
              </p>
            </div>
          </div>

          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueTrendsPerShop} margin={{ top: 8, right: 10, left: -4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `₹${v}`}
                />
                <Tooltip content={<ChartTooltip unitPrefix="₹" />} />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                {shopsMeta.map((shop) => (
                  <Line
                    key={shop.id}
                    type="monotone"
                    dataKey={shop.id}
                    name={shop.name}
                    stroke={shop.color}
                    strokeWidth={2.5}
                    dot={{ r: 3, strokeWidth: 1.5 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Chart Row 2: Peak Hour Traffic (24-Hour Distribution AreaChart) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {lang === 'hi' ? 'पीक ऑवर ट्रैफ़िक (24 घंटे का विश्लेषण)' : 'Peak Hour Traffic (24-Hour Distribution)'}
            </h3>
            <p className="text-xs text-slate-500">
              {lang === 'hi'
                ? 'किस समय सबसे ज़्यादा ग्राहक डॉक्यूमेंट प्रिंट करवाते हैं'
                : 'Hourly customer print demand from 00:00 to 23:00'}
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setPeakMetric('jobsCount')}
              className={`min-h-[32px] rounded-lg px-3 text-xs font-semibold transition-colors cursor-pointer ${
                peakMetric === 'jobsCount'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'hi' ? 'जॉब्स संख्या' : 'Print Jobs'}
            </button>
            <button
              type="button"
              onClick={() => setPeakMetric('pagesCount')}
              className={`min-h-[32px] rounded-lg px-3 text-xs font-semibold transition-colors cursor-pointer ${
                peakMetric === 'pagesCount'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'hi' ? 'पेज वॉल्यूम' : 'Page Volume'}
            </button>
          </div>
        </div>

        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={peakHours} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="peakTrafficFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="hourLabel"
                interval={2}
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={{ stroke: '#e2e8f0' }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    unitSuffix={
                      peakMetric === 'jobsCount'
                        ? lang === 'hi'
                          ? ' जॉब्स'
                          : ' jobs'
                        : lang === 'hi'
                        ? ' पेज'
                        : ' pages'
                    }
                  />
                }
              />
              <Area
                type="monotone"
                dataKey={peakMetric}
                name={
                  peakMetric === 'jobsCount'
                    ? lang === 'hi'
                      ? 'प्रिंट जॉब्स'
                      : 'Print Jobs'
                    : lang === 'hi'
                    ? 'प्रिंट पेज'
                    : 'Printed Pages'
                }
                stroke="#059669"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#peakTrafficFill)"
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-Shop Performance Breakdown Table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            {lang === 'hi' ? 'शॉप-वार प्रदर्शन तालिका' : 'Branch Performance Breakdown'}
          </h3>
          <span className="text-xs text-slate-500">
            {lang === 'hi' ? `पिछले ${days} दिन` : `Last ${days} days`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                <th className="py-2.5 pr-3">{lang === 'hi' ? 'शॉप / ब्रांच' : 'Shop / Branch'}</th>
                <th className="py-2.5 pr-3 text-right">{lang === 'hi' ? 'जॉब्स' : 'Jobs'}</th>
                <th className="py-2.5 pr-3 text-right">{lang === 'hi' ? 'पेज' : 'Pages'}</th>
                <th className="py-2.5 pr-3 text-right">WhatsApp</th>
                <th className="py-2.5 pr-3 text-right">{lang === 'hi' ? 'आय (₹)' : 'Revenue'}</th>
                <th className="py-2.5 text-right w-40">{lang === 'hi' ? 'हिस्सेदारी' : 'Share'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shopsMeta.map((shop) => (
                <tr key={shop.id} className="hover:bg-slate-50/80">
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: shop.color }}
                      />
                      <div>
                        <div className="font-semibold text-slate-900">{shop.name}</div>
                        <div className="text-[11px] font-mono text-slate-500">{shop.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-right font-mono tabular-nums text-slate-800">
                    {shop.totalJobs}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono tabular-nums text-slate-800">
                    {shop.totalPages}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono tabular-nums text-emerald-700">
                    {shop.whatsappJobs}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                    ₹{shop.totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-2 w-full">
                      <div className="w-20 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, shop.sharePercent)}%`,
                            backgroundColor: shop.color,
                          }}
                        />
                      </div>
                      <span className="font-mono tabular-nums text-slate-600 w-10 text-right">
                        {shop.sharePercent.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
