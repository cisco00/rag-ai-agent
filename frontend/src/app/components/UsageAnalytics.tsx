import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { Activity, Zap, CreditCard, RefreshCw, AlertCircle, Database } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Area, AreaChart
} from 'recharts';

interface UsageTotals {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_queries: number;
  estimated_cost_usd: number;
}

interface DailyTrend {
  date: string;
  queries: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
}

interface UsageData {
  status: string;
  org_id: number;
  timeframe_days: number;
  totals: UsageTotals;
  daily_trend: DailyTrend[];
  pricing_model: string;
  message?: string;
}

export function UsageAnalytics() {
  const [data, setData] = useState<UsageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<UsageData>('/billing/usage');
      setData(response);
    } catch (err: any) {
      console.error('Failed to fetch usage analytics', err);
      if (err.message?.includes('403')) {
        setError('Permission Denied: You do not have the required administrative role to view billing data.');
      } else if (err.message?.includes('401')) {
        setError('Authentication required: Please log in again.');
      } else {
        setError(err.message || 'The billing service is not responding. Please check backend logs for details.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, []);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatCurrency = (num: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 }).format(num);
  };

  const formatShortCurrency = (num: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Usage & Billing</h1>
          <p className="text-slate-500 mt-1">Monitor organization-wide AI compute usage and token costs, powered by Langfuse.</p>
        </div>
        <button
          onClick={fetchUsage}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 font-medium shadow-sm"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin text-blue-500' : ''} />
          {isLoading ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-start gap-3">
          <AlertCircle className="shrink-0 mt-0.5" size={18} />
          <div className="text-sm">
            <p className="font-bold">Error loading usage analytics</p>
            <p className="mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {data?.status === 'partial' && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-xl flex items-start gap-3">
          <AlertCircle className="shrink-0 mt-0.5 text-amber-500" size={18} />
          <div className="text-sm">
            <p className="font-bold">Telemetry Disabled or Unconfigured</p>
            <p className="mt-1 opacity-90">{data.message}</p>
            <p className="mt-2 opacity-90">To enable cost and usage tracking, configure <code className="bg-amber-200/50 px-1 py-0.5 rounded">LANGFUSE_PUBLIC_KEY</code> and <code className="bg-amber-200/50 px-1 py-0.5 rounded">LANGFUSE_SECRET_KEY</code> in the backend environment variables.</p>
          </div>
        </div>
      )}

      {!error && data && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full translate-x-16 -translate-y-16 group-hover:scale-110 transition-transform duration-500" />
              <div className="relative">
                <div className="flex items-center gap-3 text-slate-500 mb-2">
                  <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
                    <Zap size={18} />
                  </div>
                  <span className="font-medium text-sm">Total Queries</span>
                </div>
                <div className="text-3xl font-black text-slate-900 tracking-tight">
                  {formatNumber(data.totals.total_queries)}
                </div>
                <div className="mt-2 text-xs text-slate-400 font-medium uppercase tracking-wider">
                  Past 30 Days
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full translate-x-16 -translate-y-16 group-hover:scale-110 transition-transform duration-500" />
              <div className="relative">
                <div className="flex items-center gap-3 text-slate-500 mb-2">
                  <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
                    <Database size={18} />
                  </div>
                  <span className="font-medium text-sm">Total Tokens</span>
                </div>
                <div className="text-3xl font-black text-slate-900 tracking-tight flex items-baseline gap-2">
                  {formatNumber(data.totals.total_tokens)}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-medium">
                    {formatNumber(data.totals.prompt_tokens)} prompt
                  </span>
                  <span className="text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full font-medium">
                    {formatNumber(data.totals.completion_tokens)} comp
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm relative overflow-hidden group md:col-span-2">
              <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-50 rounded-full translate-x-16 -translate-y-24 group-hover:scale-110 transition-transform duration-500" />
              <div className="relative flex justify-between items-center h-full">
                <div>
                  <div className="flex items-center gap-3 text-slate-500 mb-2">
                    <div className="bg-emerald-100 p-2 rounded-lg text-emerald-600">
                      <CreditCard size={18} />
                    </div>
                    <span className="font-medium text-sm">Estimated Cost</span>
                  </div>
                  <div className="text-4xl font-black text-emerald-700 tracking-tight">
                    {formatShortCurrency(data.totals.estimated_cost_usd)}
                  </div>
                  <div className="mt-2 text-xs text-slate-400 font-medium">
                    Pricing applied: <span className="font-mono text-emerald-600 break-all">{data.pricing_model === 'none' ? 'No telemetry data' : '$0.001 per token (Fallback)'}</span>
                  </div>
                </div>
                
                {data.totals.estimated_cost_usd > 0 && (
                   <div className="hidden sm:block text-right">
                     <div className="text-sm text-slate-500 mb-1">Avg cost / query</div>
                     <div className="text-xl font-bold text-slate-700">
                       {formatCurrency(data.totals.estimated_cost_usd / (data.totals.total_queries || 1))}
                     </div>
                   </div>
                )}
              </div>
            </div>
          </div>

          {/* Charts Area */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
             {/* Cost Over Time */}
             <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-6">
                <Activity size={18} className="text-emerald-500" />
                <h2 className="text-lg font-bold text-slate-800 tracking-tight">Daily Cost Trend</h2>
              </div>
              <div className="h-72">
                {data.daily_trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.daily_trend}>
                      <defs>
                        <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickFormatter={(val) => {
                          const date = new Date(val);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickFormatter={(val) => `$${val}`}
                        width={40}
                      />
                      <RechartsTooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: number) => [formatCurrency(value), 'Cost']}
                        labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="cost" 
                        stroke="#10b981" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorCost)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400">No telemetry data recorded</div>
                )}
              </div>
            </div>

            {/* Queries Over Time */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-6">
                <Zap size={18} className="text-blue-500" />
                <h2 className="text-lg font-bold text-slate-800 tracking-tight">AI Queries Volume</h2>
              </div>
              <div className="h-72">
                 {data.daily_trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.daily_trend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickFormatter={(val) => {
                          const date = new Date(val);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        allowDecimals={false}
                        width={30}
                      />
                      <RechartsTooltip 
                         contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)' }}
                         formatter={(value: number) => [value, 'Queries']}
                         labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="queries" 
                        stroke="#3b82f6" 
                        strokeWidth={3}
                        dot={{ r: 3, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                 ) : (
                  <div className="h-full flex items-center justify-center text-slate-400">No query data recorded</div>
                 )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Loading Skeleton */}
      {isLoading && !data && (
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className={`bg-slate-100 rounded-2xl h-36 ${i === 3 ? 'md:col-span-2' : ''}`} />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-100 rounded-2xl h-[340px]" />
            <div className="bg-slate-100 rounded-2xl h-[340px]" />
          </div>
        </div>
      )}
    </div>
  );
}
