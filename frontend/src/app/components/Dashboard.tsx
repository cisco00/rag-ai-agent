import { useState, useEffect } from 'react';
import { BarChart3, Database, FileUp, MessageSquare, TrendingUp, Lightbulb, AlertTriangle, AlertCircle, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';

interface DashboardProps {
  onNavigate: (view: string) => void;
  isConfigured?: boolean;
}

export function Dashboard({ onNavigate, isConfigured }: DashboardProps) {
  const [stats, setStats] = useState([
    { label: 'Total Queries', value: '0', change: '0', icon: MessageSquare, color: 'blue' },
    { label: 'Databases Connected', value: '0', change: '0', icon: Database, color: 'green' },
    { label: 'Files Imported', value: '0', change: '0', icon: FileUp, color: 'purple' },
    { label: 'Shared Reports', value: '0', change: '0', icon: BarChart3, color: 'orange' },
  ]);

  const [recentQueries, setRecentQueries] = useState<any[]>([]);
  const [recentInsights, setRecentInsights] = useState<any[]>([]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const [historyRes, tablesRes, sharedRes, insightsRes, sourcesRes] = await Promise.all([
          api.get<{ history: any[] }>('/history?limit=10'),
          api.get<{ tables: any[] }>('/tables').catch(() => ({ tables: [] })),
          api.get<{ reports: any[] }>('/shared').catch(() => ({ reports: [] })),
          api.get<{ insights: any[] }>('/insights?limit=3').catch(() => ({ insights: [] })),
          api.get<any[]>('/data/sources').catch(() => [])
        ]);

        const historyLength = historyRes?.history?.length || 0;
        const tablesLength = tablesRes?.tables?.length || 0;
        const sharedLength = sharedRes?.reports?.length || 0;
        const filesCount = (sourcesRes || []).filter((s: any) => s.source_type === 'upload').length;

        setStats([
          { label: 'Total Queries', value: historyLength.toString(), change: '+0', icon: MessageSquare, color: 'blue' },
          { label: 'Databases Connected', value: tablesLength.toString(), change: '+0', icon: Database, color: 'green' },
          { label: 'Files Imported', value: filesCount.toString(), change: `+${filesCount}`, icon: FileUp, color: 'purple' },
          { label: 'Shared Reports', value: sharedLength.toString(), change: '+0', icon: BarChart3, color: 'orange' },
        ]);

        const formattedQueries = (historyRes?.history || []).map((h: any) => ({
          query: h.query,
          time: new Date(h.created_at).toLocaleDateString(),
          status: 'success'
        }));

        setRecentQueries(formattedQueries.slice(0, 4));
        setRecentInsights(insightsRes?.insights || []);
      } catch (error) {
        console.error('Error fetching dashboard stats:', error);
      }
    };
    fetchDashboardData();
  }, []);

  const getSeverityIcon = (severity: string) => {
    if (severity === 'high') return <AlertCircle className="size-4 text-red-600" />;
    if (severity === 'medium') return <AlertTriangle className="size-4 text-orange-600" />;
    return <Lightbulb className="size-4 text-blue-600" />;
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-2">Welcome back! Here's an overview of your analytics activity.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          const colorClasses = {
            blue: 'bg-blue-100 text-blue-600',
            green: 'bg-green-100 text-green-600',
            purple: 'bg-purple-100 text-purple-600',
            orange: 'bg-orange-100 text-orange-600',
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
        {/* Recent Queries */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Recent Queries</h2>
            <button className="text-sm text-blue-600 hover:text-blue-700">View All</button>
          </div>
          <div className="space-y-4">
            {recentQueries.map((query, index) => (
              <div key={index} className="flex items-start gap-4 p-4 rounded-lg hover:bg-gray-50 transition-colors">
                <MessageSquare className="size-5 text-gray-400 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-gray-900 font-medium">{query.query}</p>
                  <p className="text-sm text-gray-500 mt-1">{query.time}</p>
                </div>
                <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded">
                  {query.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Proactive Insights Summary */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Proactive Insights</h2>
            <button onClick={() => onNavigate('insights')} className="text-sm text-blue-600 hover:text-blue-700">View All</button>
          </div>
          <div className="space-y-4">
            {recentInsights.length === 0 ? (
              <div className="text-center py-8">
                <Lightbulb className="size-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No anomalies detected yet.</p>
              </div>
            ) : (
              recentInsights.map((insight, index) => (
                <div
                  key={index}
                  onClick={() => onNavigate('insights')}
                  className="p-4 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-2">
                    {getSeverityIcon(insight.severity)}
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-tight">{insight.metric_column}</span>
                  </div>
                  <p className="text-sm font-bold text-gray-900 line-clamp-1">{insight.headline}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className={`text-xs font-bold ${insight.change_pct > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {insight.change_pct > 0 ? '+' : ''}{insight.change_pct}%
                    </span>
                    <ChevronRight className="size-4 text-gray-400" />
                  </div>
                </div>
              ))
            )}
          </div>
          <button
            onClick={() => onNavigate('insights')}
            className="w-full mt-6 flex items-center justify-center gap-2 p-3 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          >
            Go to Insights Center
          </button>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Quick Actions</h2>
          <div className="space-y-3">
            <button
              onClick={() => onNavigate('query')}
              disabled={!isConfigured}
              className={`w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 transition-colors ${isConfigured ? 'hover:border-blue-300 hover:bg-blue-50' : 'opacity-50 cursor-not-allowed'}`}
            >
              <MessageSquare className="size-5 text-blue-600" />
              <span className="font-medium text-gray-900">New Query {!isConfigured && '(Requires DB)'}</span>
            </button>
            <button
              onClick={() => onNavigate('import')}
              disabled={!isConfigured}
              className={`w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 transition-colors ${isConfigured ? 'hover:border-green-300 hover:bg-green-50' : 'opacity-50 cursor-not-allowed'}`}
            >
              <FileUp className="size-5 text-green-600" />
              <span className="font-medium text-gray-900">Import File {!isConfigured && '(Requires DB)'}</span>
            </button>
            <button onClick={() => onNavigate('database')} className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors">
              <Database className="size-5 text-purple-600" />
              <span className="font-medium text-gray-900">Connect Database</span>
            </button>
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
