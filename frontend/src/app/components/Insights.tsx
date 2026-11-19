import { useState, useEffect } from 'react';
import {
    Lightbulb, CheckCircle, Clock, AlertTriangle, AlertCircle,
    TrendingUp, TrendingDown, ChevronRight, RefreshCcw, Sparkles,
    Trash2, Zap, Filter, ArrowUpDown,
} from 'lucide-react';
import { api } from '../../lib/api';

interface Insight {
    id: string;
    metric_table: string;
    metric_column: string;
    change_pct: number | null;
    period: string;
    headline: string;
    explanation: string;
    likely_causes: string[];
    recommended_action?: string;
    severity: 'high' | 'medium' | 'low';
    seen: number;
    created_at: string;
}

type SeverityFilter = 'all' | 'unseen' | 'high' | 'medium' | 'low';
type SortKey = 'date' | 'severity' | 'change';

export function Insights() {
    const [insights, setInsights] = useState<Insight[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [filter, setFilter] = useState<SeverityFilter>('all');
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const fetchInsights = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await api.get<{ insights: Insight[] }>('/insights?limit=50');
            setInsights(data.insights || []);
        } catch (err: any) {
            setError('Failed to load insights. Please try again.');
            console.error('Error fetching insights:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchInsights();
    }, []);

    const generateInsights = async () => {
        setIsGenerating(true);
        setError(null);
        try {
            await api.post('/insights/generate', {});
            // Poll with up to 5 retries (every 5s, up to 25s) to pick up new insights.
            // Watchdog runs can take 10-30s for real databases, so a single 3s delay is too short.
            let attempts = 0;
            const previousCount = insights.length;
            const poll = async () => {
                attempts++;
                try {
                    const data = await api.get<{ insights: Insight[] }>('/insights?limit=50');
                    const fresh = data.insights || [];
                    setInsights(fresh);
                    if (fresh.length > previousCount || attempts >= 5) {
                        setIsGenerating(false);
                        return;
                    }
                } catch {
                    // keep polling
                }
                if (attempts < 5) setTimeout(poll, 5000);
                else setIsGenerating(false);
            };
            setTimeout(poll, 5000);
        } catch (err: any) {
            const msg = err?.response?.data?.detail || 'Could not start analysis. Check your database connection.';
            setError(msg);
            setIsGenerating(false);
        }
    };

    const markSeen = async (id: string) => {
        try {
            await api.post(`/insights/${id}/seen`, {});
            setInsights(prev => prev.map(i => i.id === id ? { ...i, seen: 1 } : i));
        } catch {
            // silent — UI already optimistically updated
        }
    };

    const markAllSeen = async () => {
        try {
            await api.post('/insights/mark-all-seen', {});
            setInsights(prev => prev.map(i => ({ ...i, seen: 1 })));
        } catch {
            setError('Failed to mark all as read.');
        }
    };

    const deleteInsight = async (id: string) => {
        setDeletingId(id);
        try {
            await api.delete(`/insights/${id}`);
            setInsights(prev => prev.filter(i => i.id !== id));
        } catch {
            setError('Failed to dismiss insight.');
        } finally {
            setDeletingId(null);
        }
    };

    const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

    const filteredInsights = insights
        .filter(i => {
            if (filter === 'unseen') return i.seen === 0;
            if (filter === 'high' || filter === 'medium' || filter === 'low') return i.severity === filter;
            return true;
        })
        .sort((a, b) => {
            if (sortKey === 'severity') {
                return (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3);
            }
            if (sortKey === 'change') {
                return Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0);
            }
            // default: date desc
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

    const unseenCount = insights.filter(i => i.seen === 0).length;
    const highCount   = insights.filter(i => i.severity === 'high').length;
    const mediumCount = insights.filter(i => i.severity === 'medium').length;
    const lowCount    = insights.filter(i => i.severity === 'low').length;

    const getSeverityBg = (severity: string) => {
        if (severity === 'high')   return 'bg-red-50';
        if (severity === 'medium') return 'bg-orange-50';
        return 'bg-blue-50';
    };

    const SeverityIcon = ({ severity }: { severity: string }) => {
        if (severity === 'high')   return <AlertCircle   className="size-5 text-red-600" />;
        if (severity === 'medium') return <AlertTriangle className="size-5 text-orange-600" />;
        return <Lightbulb className="size-5 text-blue-600" />;
    };

    const FILTERS: { key: SeverityFilter; label: string; count?: number }[] = [
        { key: 'all',    label: 'All',    count: insights.length },
        { key: 'unseen', label: 'Unseen', count: unseenCount },
        { key: 'high',   label: 'High',   count: highCount },
        { key: 'medium', label: 'Medium', count: mediumCount },
        { key: 'low',    label: 'Low',    count: lowCount },
    ];

    return (
        <div className="p-8 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                        <TrendingUp className="size-8 text-blue-600" />
                        Proactive Insights
                    </h1>
                    <p className="text-gray-600 mt-2">AI-detected anomalies and metric shifts from your databases.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchInsights}
                        disabled={isLoading}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Refresh"
                    >
                        <RefreshCcw className={`size-5 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={markAllSeen}
                        disabled={unseenCount === 0}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
                    >
                        <CheckCircle className="size-4" />
                        Mark all read
                    </button>
                    <button
                        onClick={generateInsights}
                        disabled={isGenerating}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
                        title="Run AI watchdog scan now"
                    >
                        {isGenerating ? (
                            <Sparkles className="size-4 animate-pulse" />
                        ) : (
                            <Zap className="size-4" />
                        )}
                        {isGenerating ? 'Analysing…' : 'Generate Now'}
                    </button>
                </div>
            </div>

            {/* Error banner */}
            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700">
                    <AlertCircle className="size-5 shrink-0 mt-0.5" />
                    <div className="flex-1 text-sm">{error}</div>
                    <button onClick={() => setError(null)} className="text-xs font-bold hover:underline">Dismiss</button>
                </div>
            )}

            {/* Generating banner */}
            {isGenerating && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3 text-blue-700 text-sm">
                    <Sparkles className="size-5 shrink-0 animate-pulse" />
                    Scanning your data for anomalies — this may take 10–30 seconds…
                </div>
            )}

            {/* Filters + Sort */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="flex flex-wrap gap-2">
                    <Filter className="size-4 text-gray-400 self-center mr-1" />
                    {FILTERS.map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                                filter === f.key
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            {f.label}
                            {f.count !== undefined && f.count > 0 && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                                    filter === f.key ? 'bg-white/20' : 'bg-gray-300/60'
                                }`}>{f.count}</span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <ArrowUpDown className="size-4 text-gray-400" />
                    <select
                        value={sortKey}
                        onChange={e => setSortKey(e.target.value as SortKey)}
                        className="text-sm font-medium text-gray-600 bg-gray-100 border-0 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-200 transition-colors outline-none"
                    >
                        <option value="date">Newest first</option>
                        <option value="severity">Severity</option>
                        <option value="change">Largest change</option>
                    </select>
                </div>
            </div>

            {/* Content */}
            {isLoading && insights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                    <RefreshCcw className="size-10 text-gray-300 animate-spin mb-4" />
                    <p className="text-gray-500">Loading insights…</p>
                </div>
            ) : filteredInsights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                    <CheckCircle className="size-16 text-green-200 mb-4" />
                    <h3 className="text-xl font-bold text-gray-900">
                        {filter === 'all' ? 'No insights yet' : `No ${filter} insights`}
                    </h3>
                    <p className="text-gray-500 mt-2 text-center max-w-sm">
                        {filter === 'all'
                            ? 'Click "Generate Now" to run an AI scan of your database for anomalies and metric shifts.'
                            : 'Try a different filter, or generate new insights.'}
                    </p>
                    {filter === 'all' && (
                        <button
                            onClick={generateInsights}
                            disabled={isGenerating}
                            className="mt-6 flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
                        >
                            <Zap className="size-4" />
                            Generate Now
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid gap-6">
                    {filteredInsights.map((insight) => (
                        <div
                            key={insight.id}
                            className={`relative bg-white rounded-xl border-2 transition-all p-6 ${
                                insight.seen === 0
                                    ? 'border-blue-100 shadow-md ring-1 ring-blue-50'
                                    : 'border-gray-100 opacity-80'
                            }`}
                        >
                            {/* Unseen dot */}
                            {insight.seen === 0 && (
                                <div className="absolute top-4 right-4 h-3 w-3 bg-blue-600 rounded-full animate-pulse" />
                            )}

                            <div className="flex items-start gap-4">
                                <div className={`p-3 rounded-lg shrink-0 ${getSeverityBg(insight.severity)}`}>
                                    <SeverityIcon severity={insight.severity} />
                                </div>

                                <div className="flex-1 min-w-0">
                                    {/* Meta row */}
                                    <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                            {insight.metric_table} · {insight.metric_column}
                                        </span>
                                        <span className="text-xs text-gray-400 flex items-center gap-1">
                                            <Clock className="size-3" />
                                            {new Date(insight.created_at).toLocaleString()}
                                        </span>
                                    </div>

                                    <h2 className="text-xl font-bold text-gray-900 mb-2">{insight.headline}</h2>

                                    {/* Change pill */}
                                    {insight.change_pct !== null && insight.change_pct !== undefined && (
                                        <div className="flex items-center gap-3 mb-4">
                                            <span className={`flex items-center gap-1 px-2 py-1 rounded text-sm font-bold ${
                                                insight.change_pct > 0
                                                    ? 'bg-green-100 text-green-700'
                                                    : 'bg-red-100 text-red-700'
                                            }`}>
                                                {insight.change_pct > 0
                                                    ? <TrendingUp className="size-4" />
                                                    : <TrendingDown className="size-4" />}
                                                {Math.abs(insight.change_pct).toFixed(1)}%
                                            </span>
                                            <span className="text-sm text-gray-500">{insight.period}</span>
                                        </div>
                                    )}

                                    <p className="text-gray-700 leading-relaxed mb-6">{insight.explanation}</p>

                                    {/* Detail grid */}
                                    <div className={`grid gap-4 ${insight.recommended_action ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
                                        {insight.likely_causes?.length > 0 && (
                                            <div className="bg-gray-50 rounded-lg p-4">
                                                <h4 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                                                    <AlertTriangle className="size-4 text-orange-500" />
                                                    Likely Causes
                                                </h4>
                                                <ul className="space-y-2">
                                                    {insight.likely_causes.map((cause, i) => (
                                                        <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                                                            <ChevronRight className="size-4 text-gray-400 mt-0.5 shrink-0" />
                                                            {cause}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {insight.recommended_action && (
                                            <div className="bg-blue-50 rounded-lg p-4">
                                                <h4 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                                                    <Zap className="size-4 text-blue-500" />
                                                    Recommended Action
                                                </h4>
                                                <p className="text-sm text-gray-700">{insight.recommended_action}</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Actions row */}
                                    <div className="mt-5 flex items-center gap-4">
                                        {insight.seen === 0 && (
                                            <button
                                                onClick={() => markSeen(insight.id)}
                                                className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                            >
                                                <CheckCircle className="size-4" />
                                                Mark as read
                                            </button>
                                        )}
                                        <button
                                            onClick={() => deleteInsight(insight.id)}
                                            disabled={deletingId === insight.id}
                                            className="text-sm font-medium text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors disabled:opacity-50 ml-auto"
                                            title="Dismiss insight"
                                        >
                                            <Trash2 className="size-4" />
                                            Dismiss
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
