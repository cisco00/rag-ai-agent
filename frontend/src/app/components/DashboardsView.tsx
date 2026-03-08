import { useState, useEffect } from 'react';
import { LayoutDashboard, Plus, Trash2, Share2, ExternalLink, RefreshCw, X, Pin, Globe, EyeOff, FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { ChartDisplay } from './ChartDisplay';

interface Dashboard { id: number; name: string; description?: string; is_public: number; share_token?: string; created_at: string; updated_at: string; }
interface Card { id: number; dashboard_id: number; org_id: number; title?: string; query_text?: string; response_text?: string; visualization?: any; card_type: string; layout_x: number; layout_y: number; layout_w: number; layout_h: number; }

/** Safely parse visualization — the backend may store it as a JSON string */
function parseViz(raw: any): any | null {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return null; }
}

/** Check if a visualization object has everything ChartDisplay needs */
function isValidViz(viz: any): boolean {
    return !!(viz && viz.type && viz.data && Array.isArray(viz.data.labels) && Array.isArray(viz.data.values) && viz.data.labels.length > 0);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function DashboardsView({ apiKey: _apiKey }: { apiKey: string }) {
    const [dashboards, setDashboards] = useState<Dashboard[]>([]);
    const [selected, setSelected] = useState<Dashboard | null>(null);
    const [cards, setCards] = useState<Card[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({ name: '', description: '' });
    const [shareUrl, setShareUrl] = useState<string | null>(null);

    const fetchDashboards = async () => {
        try { const d = await api.get<{ dashboards: Dashboard[] }>('/dashboards'); setDashboards(d.dashboards || []); }
        catch (e) { console.error(e); }
    };

    const fetchCards = async (id: number) => {
        try {
            const d = await api.get<{ dashboard: Dashboard; cards: Card[] }>(`/dashboards/${id}`);
            setSelected(d.dashboard); setCards(d.cards || []);
        } catch (e) { console.error(e); }
    };

    useEffect(() => { fetchDashboards(); }, []);

    const handleCreate = async () => {
        if (!form.name.trim()) return;
        setLoading(true);
        try {
            await api.post('/dashboards', form);
            setShowCreate(false); setForm({ name: '', description: '' });
            fetchDashboards();
        } catch (e: any) { alert(e.message || 'Failed to create dashboard'); }
        setLoading(false);
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Delete this dashboard and all its cards?')) return;
        try { await api.delete(`/dashboards/${id}`); fetchDashboards(); if (selected?.id === id) { setSelected(null); setCards([]); } }
        catch (e) { console.error(e); }
    };

    const handlePublish = async (id: number, isPublic: number) => {
        try {
            if (isPublic) { await api.post(`/dashboards/${id}/unpublish`); setShareUrl(null); }
            else { const r = await api.post<{ share_url: string }>(`/dashboards/${id}/publish`); setShareUrl(r.share_url); }
            fetchDashboards(); if (selected?.id === id) fetchCards(id);
        } catch (e) { console.error(e); }
    };

    const handleRefreshCard = async (cardId: number) => {
        if (!selected) return;
        try { await api.post(`/dashboards/${selected.id}/cards/${cardId}/refresh`); fetchCards(selected.id); }
        catch (e) { console.error(e); }
    };

    const handleRemoveCard = async (cardId: number) => {
        if (!selected || !confirm('Remove this card?')) return;
        try { await api.delete(`/dashboards/${selected.id}/cards/${cardId}`); fetchCards(selected.id); }
        catch (e) { console.error(e); }
    };

    return (
        <div className="flex h-full">
            {/* Sidebar */}
            <aside className="w-72 border-r border-gray-200 bg-white flex flex-col">
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <LayoutDashboard className="size-5 text-blue-600" />
                        <h2 className="font-semibold text-gray-900">Dashboards</h2>
                    </div>
                    <button onClick={() => setShowCreate(true)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg">
                        <Plus className="size-4" />
                    </button>
                </div>

                {showCreate && (
                    <div className="p-4 border-b border-gray-200 bg-blue-50">
                        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="Dashboard name" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm mb-2 focus:ring-2 focus:ring-blue-500" />
                        <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                            placeholder="Description (optional)" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm mb-2" />
                        <div className="flex gap-2">
                            <button onClick={handleCreate} disabled={loading || !form.name}
                                className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                                {loading ? '...' : 'Create'}
                            </button>
                            <button onClick={() => setShowCreate(false)} className="flex-1 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50">Cancel</button>
                        </div>
                    </div>
                )}

                <nav className="flex-1 overflow-y-auto p-2 space-y-1">
                    {dashboards.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No dashboards yet</p>}
                    {dashboards.map(d => (
                        <button key={d.id} onClick={() => fetchCards(d.id)}
                            className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors group ${selected?.id === d.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium truncate">{d.name}</span>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                                    {d.is_public ? <Globe className="size-3 text-green-600" /> : null}
                                    <button onClick={e => { e.stopPropagation(); handleDelete(d.id); }}
                                        className="p-0.5 text-red-500 hover:bg-red-50 rounded"><Trash2 className="size-3" /></button>
                                </div>
                            </div>
                            {d.description && <p className="text-xs text-gray-400 truncate mt-0.5">{d.description}</p>}
                            <p className="text-xs text-gray-300 mt-0.5">{new Date(d.updated_at).toLocaleDateString()}</p>
                        </button>
                    ))}
                </nav>
            </aside>

            {/* Main content */}
            <main className="flex-1 overflow-auto p-6 bg-gray-50">
                {!selected ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <LayoutDashboard className="size-16 opacity-20 mb-4" />
                        <p className="text-lg font-medium">Select a dashboard</p>
                        <p className="text-sm mt-1">Pin AI responses from the Query page using the 📌 button</p>
                    </div>
                ) : (
                    <div className="max-w-6xl mx-auto space-y-4">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900">{selected.name}</h1>
                                {selected.description && <p className="text-sm text-gray-500 mt-0.5">{selected.description}</p>}
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => fetchCards(selected.id)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-white text-gray-600">
                                    <RefreshCw className="size-3.5" />Refresh
                                </button>
                                <button onClick={() => handlePublish(selected.id, selected.is_public)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selected.is_public ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                                    {selected.is_public ? <><EyeOff className="size-4" />Unpublish</> : <><Globe className="size-4" />Publish</>}
                                </button>
                            </div>
                        </div>

                        {shareUrl && (
                            <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Share2 className="size-4 text-green-600" />
                                    <span className="text-sm text-green-800 font-medium">Dashboard published!</span>
                                    <a href={shareUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline flex items-center gap-1">
                                        {shareUrl}<ExternalLink className="size-3" />
                                    </a>
                                </div>
                                <button onClick={() => setShareUrl(null)}><X className="size-4 text-gray-400" /></button>
                            </div>
                        )}

                        {/* Cards */}
                        {cards.length === 0 ? (
                            <div className="text-center py-16 bg-white rounded-xl border-2 border-dashed border-gray-200 text-gray-400">
                                <Pin className="size-10 mx-auto mb-3 opacity-30" />
                                <p className="font-medium">No cards pinned yet</p>
                                <p className="text-sm mt-1">
                                    Use the <span className="font-semibold text-purple-600">📌 Pin to Dashboard</span> button on any AI response in the Query page.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                                {cards.map(card => {
                                    const viz = parseViz(card.visualization);
                                    const hasChart = isValidViz(viz);

                                    return (
                                        <div key={card.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                                            {/* Card header */}
                                            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    {hasChart
                                                        ? <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                                                        : <FileText className="size-3.5 text-gray-400 flex-shrink-0" />}
                                                    <h3 className="font-semibold text-gray-800 text-sm truncate">
                                                        {card.title || card.query_text || 'Untitled Card'}
                                                    </h3>
                                                </div>
                                                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                                                    <button onClick={() => handleRefreshCard(card.id)} title="Refresh"
                                                        className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors">
                                                        <RefreshCw className="size-3.5" />
                                                    </button>
                                                    <button onClick={() => handleRemoveCard(card.id)} title="Remove"
                                                        className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                                                        <X className="size-3.5" />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Chart visualization */}
                                            {hasChart && (
                                                <div className="px-4 pt-4">
                                                    <ChartDisplay visualization={viz} />
                                                </div>
                                            )}

                                            {/* Analysis / summary text */}
                                            {card.response_text && (
                                                <div className={`px-5 py-4 flex-1 ${hasChart ? 'border-t border-gray-100 mt-3' : ''}`}>
                                                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Analysis</p>
                                                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{card.response_text}</p>
                                                </div>
                                            )}

                                            {/* Empty state */}
                                            {!card.response_text && !hasChart && (
                                                <div className="px-5 py-8 text-center text-gray-400">
                                                    <p className="text-xs italic">No content — click Refresh to re-run the query.</p>
                                                </div>
                                            )}

                                            {/* Footer: original query */}
                                            {card.query_text && (
                                                <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100">
                                                    <p className="text-xs text-gray-400 truncate">
                                                        <span className="font-medium">Q:</span> {card.query_text}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
