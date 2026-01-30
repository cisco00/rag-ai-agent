import React, { useState, useEffect } from 'react';
import { Clock, MessageSquare, ChevronRight, Calendar } from 'lucide-react';
import { api } from '../services/api';

interface HistoryItem {
    id: number;
    query: string;
    response: string;
    created_at: string;
    sql_query?: string;
}

export const HistoryView: React.FC = () => {
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadHistory();
    }, []);

    const loadHistory = async () => {
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) return;

            const data = await api.getHistory(apiKey);
            setHistory(data.history);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString();
    };

    if (loading) return <div className="p-4">Loading history...</div>;
    if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

    return (
        <div className="history-view p-4">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Clock className="w-6 h-6" />
                Query History
            </h2>

            <div className="space-y-4">
                {history.length === 0 ? (
                    <p className="text-gray-500">No history found.</p>
                ) : (
                    history.map((item) => (
                        <div key={item.id} className="border rounded-lg p-4 hover:bg-slate-50 transition-colors">
                            <div className="flex justify-between items-start mb-2">
                                <span className="font-semibold text-lg">{item.query}</span>
                                <span className="text-sm text-gray-400 flex items-center gap-1">
                                    <Calendar size={14} />
                                    {formatDate(item.created_at)}
                                </span>
                            </div>
                            <div className="text-gray-600 line-clamp-3 mb-2">
                                {item.response}
                            </div>
                            {item.sql_query && (
                                <div className="bg-gray-100 p-2 rounded text-xs font-mono text-gray-700 truncate">
                                    {item.sql_query}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
