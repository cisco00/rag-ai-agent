import { useState, useEffect } from 'react';
import { Database, FileUp, MessageSquare, TrendingUp, Lightbulb, AlertTriangle, AlertCircle, ChevronRight, LayoutGrid, Bell, RotateCw } from 'lucide-react';
import { api } from '../../lib/api';

interface DashboardProps {
  onNavigate: (view: string, query?: string) => void;
  isConfigured?: boolean;
}

export function Dashboard({ onNavigate, isConfigured }: DashboardProps) {
  const [stats, setStats] = useState([
    { label: 'Total Queries', value: '0', change: '+0', icon: MessageSquare, color: 'blue' },
    { label: 'Dashboards', value: '0', change: '+0', icon: LayoutGrid, color: 'purple' },
    { label: 'Active Alerts', value: '0', change: '+0', icon: Bell, color: 'orange' },
    { label: 'Insights Detected', value: '0', change: '+0', icon: Lightbulb, color: 'yellow' },
  ]);

  const [recentQueries, setRecentQueries] = useState<any[]>([]);
  const [recentInsights, setRecentInsights] = useState<any[]>([]);
  const [suggestedQueries, setSuggestedQueries] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  const fetchSuggestions = async (isRefresh = false) => {
    if (!isConfigured) return;
    setIsLoadingSuggestions(true);
    try {
      const data = await api.get<{ queries: string[] }>(`/analytics/suggested-queries${isRefresh ? '?refresh=true' : ''}`);
      if (data && data.queries) {
        setSuggestedQueries(data.queries.slice(0, 4));
      }
    } catch (err) {
      console.error('Failed to fetch suggestions:', err);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const [historyRes, insightsRes, dashboardsRes, alertsRes] = await Promise.all([
          api.get<{ history: any[] }>('/analytics/history?limit=10'),
          api.get<{ insights: any[] }>('/insights?limit=3').catch(() => ({ insights: [] })),
          api.get<{ dashboards: any[] }>('/dashboards').catch(() => ({ dashboards: [] })),
          api.get<{ alerts: any[] }>('/alerts').catch(() => ({ alerts: [] })),
        ]);

        const historyLength = historyRes?.history?.length || 0;
        const dashboardsCount = dashboardsRes?.dashboards?.length || 0;
        const activeAlertsCount = (alertsRes?.alerts || []).filter((a: any) => a.is_active).length;
        const insightsCount = insightsRes?.insights?.length || 0;

        setStats([
          { label: 'Total Queries', value: historyLength.toString(), change: `+${historyLength}`, icon: MessageSquare, color: 'blue' },
          { label: 'Dashboards', value: dashboardsCount.toString(), change: `+${dashboardsCount}`, icon: LayoutGrid, color: 'purple' },
          { label: 'Active Alerts', value: activeAlertsCount.toString(), change: `+${activeAlertsCount}`, icon: Bell, color: 'orange' },
          { label: 'Insights Detected', value: insightsCount.toString(), change: `+${insightsCount}`, icon: Lightbulb, color: 'yellow' },
        ]);

        const formattedQueries = (historyRes?.history || []).map((h: any) => ({
          query: h.query,
          time: new Date(h.created_at).toLocaleDateString(),
          status: 'success',
        }));

        setRecentQueries(formattedQueries.slice(0, 4));
        setRecentInsights(insightsRes?.insights || []);
      } catch (error) {
        console.error('Error fetching dashboard stats:', error);
      }
    };

    fetchDashboardData();
    fetchSuggestions();
  }, [isConfigured]);

  const handleRefreshSuggestions = () => {
    fetchSuggestions(true);
  };

  const getSeverityIcon = (severity: string) => {
    if (severity === 'high') return <AlertCircle className="size-4 text-red-600" />;
    if (severity === 'medium') return <AlertTriangle className="size-4 text-orange-600" />;
    return <Lightbulb className="size-4 text-blue-600" />;
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Overview</h1>
        <p className="text-gray-600 mt-2">Welcome back! Here's an overview of your analytics activity.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          const colorClasses = {
            blue: 'bg-blue-100 text-blue-600',
            purple: 'bg-purple-100 text-purple-600',
            orange: 'bg-orange-100 text-orange-600',
            yellow: 'bg-yellow-100 text-yellow-600',
          }[stat.color];

          return (
            <div key={index} className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-lg ${colorClasses}`}>
                  <Icon className="size-6" />
                </div>
                <span className="text-sm font-medium text-green-600">{stat.change}</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-1">{stat.value}</div>
              <div className="text-sm text-gray-600">{stat.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Discovery Card */}
        {isConfigured && (
          <div className="lg:col-span-3 bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-8 text-white shadow-lg overflow-hidden relative group">
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Lightbulb className="size-8 text-blue-200" />
                  <h2 className="text-2xl font-bold">Discover Your Data</h2>
                </div>
                <button
                  onClick={handleRefreshSuggestions}
                  disabled={isLoadingSuggestions}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors flex items-center gap-2 text-sm"
                  title="Generate new analytical questions"
                >
                  <RotateCw className={`size-4 ${isLoadingSuggestions ? 'animate-spin' : ''}`} />
                  Refresh Insights
                </button>
              </div>
              <p className="text-blue-100 mb-8 max-w-2xl text-lg">
                Our AI has analyzed your database schema and is ready to answer your questions.
                Try one of these suggested analyses or start a new query.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {suggestedQueries.length > 0 ? (
                  suggestedQueries.map((query, idx) => (
                    <button
                      key={idx}
                      onClick={() => onNavigate('query', query)}
                      className="group flex items-center justify-between p-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl transition-all text-left"
                    >
                      <span className="font-medium">{query}</span>
                      <ChevronRight className="size-5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))
                ) : (
                  [1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-14 bg-white/5 animate-pulse rounded-xl" />
                  ))
                )}
              </div>
            </div>

            {/* Decorative backgrounds */}
            <div className="absolute -right-20 -bottom-20 size-80 bg-white/10 rounded-full blur-3xl" />
            <div className="absolute -left-20 -top-20 size-60 bg-blue-400/20 rounded-full blur-3xl" />
          </div>
        )}

        {/* Recent Queries */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Recent Queries</h2>
            <button onClick={() => onNavigate('query')} className="text-sm text-blue-600 hover:text-blue-700">View All</button>
          </div>
          <div className="space-y-4">
            {recentQueries.length === 0 ? (
              <div className="text-center py-8">
                <MessageSquare className="size-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No queries yet. Start by asking a question!</p>
              </div>
            ) : (
              recentQueries.map((query, index) => (
                <div key={index} className="flex items-start gap-4 p-4 rounded-lg hover:bg-gray-50 transition-colors">
                  <MessageSquare className="size-5 text-gray-400 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-900 font-medium truncate">{query.query}</p>
                    <p className="text-sm text-gray-500 mt-1">{query.time}</p>
                  </div>
                  <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded flex-shrink-0">
                    {query.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right column: Insights + Quick Actions stacked */}
        <div className="flex flex-col gap-6">
          {/* Proactive Insights Summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">Proactive Insights</h2>
              <button onClick={() => onNavigate('insights')} className="text-sm text-blue-600 hover:text-blue-700">View All</button>
            </div>
            <div className="space-y-3">
              {recentInsights.length === 0 ? (
                <div className="text-center py-6">
                  <Lightbulb className="size-10 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No anomalies detected yet.</p>
                </div>
              ) : (
                recentInsights.map((insight, index) => (
                  <div
                    key={index}
                    onClick={() => onNavigate('insights')}
                    className="p-3 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {getSeverityIcon(insight.severity)}
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-tight">{insight.metric_column}</span>
                    </div>
                    <p className="text-sm font-bold text-gray-900 line-clamp-1">{insight.headline}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-xs font-bold ${insight.change_pct > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {insight.change_pct > 0 ? '+' : ''}{insight.change_pct}%
                      </span>
                      <ChevronRight className="size-4 text-gray-400" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <button
                onClick={() => onNavigate('query')}
                disabled={!isConfigured}
                className={`w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 transition-colors ${isConfigured ? 'hover:border-blue-300 hover:bg-blue-50' : 'opacity-50 cursor-not-allowed'}`}
              >
                <MessageSquare className="size-5 text-blue-600" />
                <span className="font-medium text-gray-900">New Query{!isConfigured && ' (Requires DB)'}</span>
              </button>
              <button
                onClick={() => onNavigate('import')}
                className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 hover:border-green-300 hover:bg-green-50 transition-colors"
              >
                <FileUp className="size-5 text-green-600" />
                <span className="font-medium text-gray-900">Import File</span>
              </button>
              <button
                onClick={() => onNavigate('database')}
                className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors"
              >
                <Database className="size-5 text-purple-600" />
                <span className="font-medium text-gray-900">Connect Database</span>
              </button>
              <button
                onClick={() => onNavigate('alerts')}
                disabled={!isConfigured}
                className={`w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 transition-colors ${isConfigured ? 'hover:border-orange-300 hover:bg-orange-50' : 'opacity-50 cursor-not-allowed'}`}
              >
                <Bell className="size-5 text-orange-600" />
                <span className="font-medium text-gray-900">Manage Alerts{!isConfigured && ' (Requires DB)'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Feature Highlights */}
      <div className="mt-8 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-8 text-white">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp className="size-8" />
          <h2 className="text-2xl font-bold">Get Started with Natural Language Analytics</h2>
        </div>
        <p className="text-blue-100 mb-6">
          Ask questions about your data in plain English and get instant insights with automated visualizations.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/10 backdrop-blur rounded-lg p-4">
            <h3 className="font-bold mb-2">1. Connect Your Data</h3>
            <p className="text-sm text-blue-100">Link your database or upload CSV/Excel files</p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-lg p-4">
            <h3 className="font-bold mb-2">2. Ask Questions</h3>
            <p className="text-sm text-blue-100">Use natural language to query your data</p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-lg p-4">
            <h3 className="font-bold mb-2">3. Share Insights</h3>
            <p className="text-sm text-blue-100">Export reports and share with your team</p>
          </div>
        </div>
      </div>
    </div>
  );
}
