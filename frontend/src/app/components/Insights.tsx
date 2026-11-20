import React, { useState, useEffect } from 'react';
import {
    Lightbulb, CheckCircle, Clock, AlertTriangle, AlertCircle,
    TrendingUp, TrendingDown, ChevronRight, RefreshCcw, Sparkles,
    Trash2, Zap, Filter, ArrowUpDown, EyeOff, Eye, Settings2,
    Bell, BellOff, X,
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

interface Suppression {
    metric_table: string;
    metric_column: string;
    created_at: string;
}

type SeverityFilter = 'all' | 'unseen' | 'high' | 'medium' | 'low';
type SortKey = 'date' | 'severity' | 'change';

export function Insights() {
    const [insights, setInsights] = useState<Insight[]>([]);
    const [suppressions, setSuppressions] = useState<Suppression[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [filter, setFilter] = useState<SeverityFilter>('all');
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [suppressingId, setSuppressingId] = useState<string | null>(null);

    // Settings panel
    const [showSettings, setShowSettings] = useState(false);
    const [thresholdPct, setThresholdPct] = useState(10);
    const [thresholdInput, setThresholdInput] = useState('10');
    const [savingSettings, setSavingSettings] = useState(false);
    const [settingsSaved, setSettingsSaved] = useState(false);

    // Suppression panel
    const [showSuppressions, setShowSuppressions] = useState(false);
    const [removingSupp, setRemovingSupp] = useState<string | null>(null);

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

    const fetchSettings = async () => {
        try {
            const data = await api.get<{ threshold_pct: number }>('/insights/settings');
            const t = data.threshold_pct ?? 10;
            setThresholdPct(t);
            setThresholdInput(String(t));
        } catch {
            // defaults stay
        }
    };

    const fetchSuppressions = async () => {
        try {
            const data = await api.get<{ suppressions: Suppression[] }>('/insights/suppressions');
            setSuppressions(data.suppressions || []);
        } catch {
            // silent
        }
    };

    useEffect(() => {
        fetchInsights();
        fetchSettings();
        fetchSuppressions();
    }, []);

    const generateInsights = async () => {
        setIsGenerating(true);
        setError(null);
        try {
            await api.post('/insights/generate', {});
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
            setInsights((prev: Insight[]) => prev.map((i: Insight) => i.id === id ? { ...i, seen: 1 } : i));
        } catch {
            // silent
        }
    };

    const markAllSeen = async () => {
        try {
            await api.post('/insights/mark-all-seen', {});
            setInsights((prev: Insight[]) => prev.map((i: Insight) => ({ ...i, seen: 1 })));
        } catch {
            setError('Failed to mark all as read.');
        }
    };

    const deleteInsight = async (id: string) => {
        setDeletingId(id);
        try {
            await api.delete(`/insights/${id}`);
            setInsights((prev: Insight[]) => prev.filter((i: Insight) => i.id !== id));
        } catch {
            setError('Failed to dismiss insight.');
        } finally {
            setDeletingId(null);
        }
    };

    const suppressInsight = async (insight: Insight) => {
        setSuppressingId(insight.id);
        try {
            await api.post(`/insights/${insight.id}/suppress`, {});
            // Add to local suppressions list
            setSuppressions((prev: Suppression[]) => [
                ...prev.filter((s: Suppression) => !(s.metric_table === insight.metric_table && s.metric_column === insight.metric_column)),
                { metric_table: insight.metric_table, metric_column: insight.metric_column, created_at: new Date().toISOString() },
            ]);
            // Remove all insights for this metric from view
            setInsights((prev: Insight[]) => prev.filter((i: Insight) => !(i.metric_table === insight.metric_table && i.metric_column === insight.metric_column)));
        } catch {
            setError('Failed to suppress metric.');
        } finally {
            setSuppressingId(null);
        }
    };

    const unsuppressMetric = async (s: Suppression) => {
        const key = `${s.metric_table}.${s.metric_column}`;
        setRemovingSupp(key);
        try {
            await api.delete(`/insights/suppressions/${encodeURIComponent(s.metric_table)}/${encodeURIComponent(s.metric_column)}`);
            setSuppressions((prev: Suppression[]) => prev.filter((x: Suppression) => !(x.metric_table === s.metric_table && x.metric_column === s.metric_column)));
        } catch {
            setError('Failed to remove suppression.');
        } finally {
            setRemovingSupp(null);
        }
    };

    const saveSettings = async () => {
        const val = parseFloat(thresholdInput);
        if (isNaN(val) || val < 1 || val > 100) {
            setError('Threshold must be between 1 and 100.');
            return;
        }
        setSavingSettings(true);
        try {
            await api.post('/insights/settings', { threshold_pct: val });
            setThresholdPct(val);
            setSettingsSaved(true);
            setTimeout(() => setSettingsSaved(false), 2500);
        } catch {
            setError('Failed to save settings.');
        } finally {
            setSavingSettings(false);
        }
    };

    const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

    // Build suppressed set for quick lookup
    const suppressedSet = new Set(suppressions.map((s: Suppression) => `${s.metric_table}.${s.metric_column}`));

    const filteredInsights = insights
        .filter((i: Insight) => {
            if (filter === 'unseen') return i.seen === 0;
            if (filter === 'high' || filter === 'medium' || filter === 'low') return i.severity === filter;
            return true;
        })
        .sort((a: Insight, b: Insight) => {
            if (sortKey === 'severity') {
                return (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3);
            }
            if (sortKey === 'change') {
                return Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0);
            }
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

    const unseenCount = insights.filter((i: Insight) => i.seen === 0).length;
    const highCount   = insights.filter((i: Insight) => i.severity === 'high').length;
    const mediumCount = insights.filter((i: Insight) => i.severity === 'medium').length;
    const lowCount    = insights.filter((i: Insight) => i.severity === 'low').length;

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
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                        <TrendingUp className="size-8 text-blue-600" />
                        Proactive Insights
                    </h1>
                    <p className="text-gray-600 mt-2">AI-detected anomalies and metric shifts from your databases.</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={fetchInsights}
                        disabled={isLoading}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Refresh"
                    >
                        <RefreshCcw className={`size-5 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    {suppressions.length > 0 && (
                        <button
                            onClick={() => setShowSuppressions(!showSuppressions)}
                            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                                showSuppressions
                                    ? 'bg-orange-50 border-orange-200 text-orange-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                            title="Manage suppressed metrics"
                        >
                            <EyeOff className="size-4" />
                            {suppressions.length} suppressed
                        </button>
                    )}
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                            showSettings
                                ? 'bg-blue-50 border-blue-200 text-blue-700'
                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                        title="Insight settings"
                    >
                        <Settings2 className="size-4" />
                        Settings
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

            {/* Settings panel */}
            {showSettings && (
                <div className="mb-6 p-5 bg-white border border-blue-100 rounded-xl shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                            <Bell className="size-4 text-blue-600" />
                            Insight Settings
                        </h3>
                        <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600">
                            <X className="size-4" />
                        </button>
                    </div>
                    <div className="flex items-end gap-4 flex-wrap">
                        <div className="flex-1 min-w-48">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Alert threshold (% change to trigger an insight)
                            </label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="range"
                                    min={1}
                                    max={50}
                                    step={1}
                                    value={Math.min(50, Math.max(1, parseFloat(thresholdInput) || thresholdPct))}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setThresholdInput(e.target.value)}
                                    className="flex-1 accent-blue-600"
                                />
                                <div className="flex items-center gap-1">
                                    <input
                                        type="number"
                                        min={1}
                                        max={100}
                                        value={thresholdInput}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setThresholdInput(e.target.value)}
                                        className="w-16 px-2 py-1 text-sm border border-gray-300 rounded-lg text-center"
                                    />
                                    <span className="text-sm text-gray-500">%</span>
                                </div>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                                Current: <strong>{thresholdPct}%</strong>. Metrics must change by at least this much vs. the {7}-day baseline to trigger an insight.
                            </p>
                        </div>
                        <button
                            onClick={saveSettings}
                            disabled={savingSettings}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
                        >
                            {settingsSaved ? <CheckCircle className="size-4" /> : <Settings2 className="size-4" />}
                            {settingsSaved ? 'Saved!' : savingSettings ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                    <p className="mt-3 text-xs text-gray-500 flex items-center gap-1">
                        <Bell className="size-3" />
                        High-severity insights will trigger an email alert to your org admin automatically (requires SMTP to be configured).
                    </p>
                </div>
            )}

            {/* Suppressions panel */}
            {showSuppressions && suppressions.length > 0 && (
                <div className="mb-6 p-5 bg-orange-50 border border-orange-200 rounded-xl">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                            <BellOff className="size-4 text-orange-600" />
                            Suppressed metrics — these will not generate new insights
                        </h3>
                        <button onClick={() => setShowSuppressions(false)} className="text-gray-400 hover:text-gray-600">
                            <X className="size-4" />
                        </button>
                    </div>
                    <div className="space-y-2">
                        {suppressions.map((s: Suppression) => (
                            <div
                                key={`${s.metric_table}.${s.metric_column}`}
                                className="flex items-center justify-between bg-white rounded-lg px-4 py-3 border border-orange-100"
                            >
                                <div>
                                    <span className="font-mono text-sm text-gray-800">
                                        {s.metric_table}<span className="text-gray-400"> · </span>{s.metric_column}
                                    </span>
                                    {s.created_at && (
                                        <span className="ml-3 text-xs text-gray-400">
                                            suppressed {new Date(s.created_at).toLocaleDateString()}
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => unsuppressMetric(s)}
                                    disabled={removingSupp === `${s.metric_table}.${s.metric_column}`}
                                    className="flex items-center gap-1 text-xs font-medium text-orange-700 hover:text-blue-700 transition-colors disabled:opacity-50"
                                    title="Re-enable insights for this metric"
                                >
                                    <Eye className="size-3.5" />
                                    Re-enable
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSortKey(e.target.value as SortKey)}
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
                    {filteredInsights.map((insight: Insight) => {
                        const isSuppressed = suppressedSet.has(`${insight.metric_table}.${insight.metric_column}`);
                        return (
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
                                                        {insight.likely_causes.map((cause: string, i: number) => (
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
                                        <div className="mt-5 flex items-center gap-4 flex-wrap">
                                            {insight.seen === 0 && (
                                                <button
                                                    onClick={() => markSeen(insight.id)}
                                                    className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                                >
                                                    <CheckCircle className="size-4" />
                                                    Mark as read
                                                </button>
                                            )}
                                            {/* Suppress button */}
                                            {!isSuppressed ? (
                                                <button
                                                    onClick={() => suppressInsight(insight)}
                                                    disabled={suppressingId === insight.id}
                                                    className="text-sm font-medium text-gray-500 hover:text-orange-600 flex items-center gap-1 transition-colors disabled:opacity-50"
                                                    title={`Stop watching ${insight.metric_table}.${insight.metric_column}`}
                                                >
                                                    <EyeOff className="size-4" />
                                                    {suppressingId === insight.id ? 'Suppressing…' : "Don't watch"}
                                                </button>
                                            ) : (
                                                <span className="text-xs text-orange-500 flex items-center gap-1">
                                                    <EyeOff className="size-3.5" />
                                                    Metric suppressed
                                                </span>
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
                        );
                    })}
                </div>
            )}
        </div>
    );
}
