import { useState, useEffect } from 'react';
import { Lightbulb, CheckCircle, Clock, AlertTriangle, AlertCircle, TrendingUp, TrendingDown, ChevronRight, RefreshCcw } from 'lucide-react';
import { api } from '../../lib/api';

interface Insight {
    id: string;
    metric_table: string;
    metric_column: string;
    change_pct: number;
    period: string;
    headline: string;
    explanation: string;
    likely_causes: string[];
    severity: 'high' | 'medium' | 'low';
    seen: number;
    created_at: string;
}

export function Insights() {
    const [insights, setInsights] = useState<Insight[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'unseen'>('all');

    const fetchInsights = async () => {
        setIsLoading(true);
        try {
            const data = await api.get<{ insights: Insight[] }>('/insights?limit=50');
            setInsights(data.insights || []);
        } catch (error) {
            console.error('Error fetching insights:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchInsights();
    }, []);

    const markSeen = async (id: string) => {
        try {
            await api.post(`/insights/${id}/seen`, {});
            setInsights(prev => prev.map(i => i.id === id ? { ...i, seen: 1 } : i));
        } catch (error) {
            console.error('Error marking insight as seen:', error);
        }
    };

    const markAllSeen = async () => {
        try {
            await api.post('/insights/mark-all-seen', {});
            setInsights(prev => prev.map(i => ({ ...i, seen: 1 })));
        } catch (error) {
            console.error('Error marking all insights as seen:', error);
        }
    };

    const filteredInsights = filter === 'unseen'
        ? insights.filter(i => i.seen === 0)
        : insights;

    const getSeverityStyles = (severity: string) => {
        switch (severity) {
            case 'high': return 'bg-red-50 border-red-200 text-red-700 icon-red';
            case 'medium': return 'bg-orange-50 border-orange-200 text-orange-700 icon-orange';
            case 'low': return 'bg-blue-50 border-blue-200 text-blue-700 icon-blue';
            default: return 'bg-gray-50 border-gray-200 text-gray-700 icon-gray';
        }
    };

    const SeverityIcon = ({ severity }: { severity: string }) => {
        if (severity === 'high') return <AlertCircle className="size-5 text-red-600" />;
        if (severity === 'medium') return <AlertTriangle className="size-5 text-orange-600" />;
        return <Lightbulb className="size-5 text-blue-600" />;
    };

    return (
        <div className="p-8 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                        <TrendingUp className="size-8 text-blue-600" />
                        Proactive Insights
                    </h1>
                    <p className="text-gray-600 mt-2">AI-detected anomalies and metric shifts from your databases.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchInsights}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Refresh"
                    >
                        <RefreshCcw className={`size-5 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={markAllSeen}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        <CheckCircle className="size-4" />
                        Mark all as read
                    </button>
                </div>
            </div>

            <div className="flex gap-2 mb-6">
                <button
                    onClick={() => setFilter('all')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                    All Insights
                </button>
                <button
                    onClick={() => setFilter('unseen')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'unseen' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                    Unseen ({insights.filter(i => i.seen === 0).length})
                </button>
            </div>

            {isLoading && insights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                    <RefreshCcw className="size-10 text-gray-300 animate-spin mb-4" />
                    <p className="text-gray-500">Discovering insights...</p>
                </div>
            ) : filteredInsights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                    <CheckCircle className="size-16 text-green-100 mb-4" />
                    <h3 className="text-xl font-bold text-gray-900">No insights found</h3>
                    <p className="text-gray-500 mt-2">We'll notify you when we detect significant changes in your data.</p>
                </div>
            ) : (
                <div className="grid gap-6">
                    {filteredInsights.map((insight) => (
                        <div
                            key={insight.id}
                            className={`relative bg-white rounded-xl border-2 transition-all p-6 ${insight.seen === 0 ? 'border-blue-100 shadow-md ring-1 ring-blue-50' : 'border-gray-100 opacity-80'}`}
                        >
                            {insight.seen === 0 && (
                                <div className="absolute top-4 right-4 h-3 w-3 bg-blue-600 rounded-full animate-pulse" />
                            )}

                            <div className="flex items-start gap-4">
                                <div className={`p-3 rounded-lg ${getSeverityStyles(insight.severity).split(' ')[0]}`}>
                                    <SeverityIcon severity={insight.severity} />
                                </div>

                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                            {insight.metric_table} • {insight.metric_column}
                                        </span>
                                        <span className="text-xs text-gray-400 flex items-center gap-1">
                                            <Clock className="size-3" />
                                            {new Date(insight.created_at).toLocaleString()}
                                        </span>
                                    </div>

                                    <h2 className="text-xl font-bold text-gray-900 mb-2">{insight.headline}</h2>

                                    <div className="flex items-center gap-3 mb-4">
                                        <span className={`flex items-center gap-1 px-2 py-1 rounded text-sm font-bold ${insight.change_pct > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {insight.change_pct > 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                                            {Math.abs(insight.change_pct)}%
                                        </span>
                                        <span className="text-sm text-gray-500">{insight.period}</span>
                                    </div>

                                    <p className="text-gray-700 leading-relaxed mb-6">
                                        {insight.explanation}
                                    </p>

                                    <div className="grid md:grid-cols-2 gap-4">
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
                                    </div>

                                    {insight.seen === 0 && (
                                        <button
                                            onClick={() => markSeen(insight.id)}
                                            className="mt-6 text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                        >
                                            <CheckCircle className="size-4" />
                                            Mark as read
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
