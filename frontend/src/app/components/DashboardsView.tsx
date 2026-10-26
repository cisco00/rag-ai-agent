import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard, Plus, Trash2, Share2, ExternalLink, RefreshCw,
  X, Pin, Globe, EyeOff, FileText, Users, Maximize2, Minimize2,
  GripVertical, TrendingUp, CheckCircle2, Menu, PanelLeftClose,
} from 'lucide-react';
import { api } from '../../lib/api';
import { ChartDisplay } from './ChartDisplay';
import { CardComments, CommentBubble } from './CardComments';

interface Dashboard {
  id: number; name: string; description?: string; is_public: number;
  share_token?: string; created_at: string; updated_at: string;
  created_by: number; is_shared: number; role_id: string;
}
interface Card {
  id: number; dashboard_id: number; org_id: number;
  title?: string; query_text?: string; response_text?: string;
  visualization?: any; card_type: string;
  layout_x: number; layout_y: number; layout_w: number; layout_h: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseViz(raw: any): any | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function isValidViz(viz: any): boolean {
  if (!viz || !viz.type || !viz.data) return false;
  const d = viz.data;
  // scatter: needs x + y arrays
  if (viz.type === 'scatter' || viz.type === 'scatter_plot') return !!(d.x?.length && d.y?.length);
  // multi-series: datasets array
  if (d.datasets?.length) return true;
  // standard: labels + values
  return !!(Array.isArray(d.labels) && Array.isArray(d.values) && d.labels.length > 0);
}

/**
 * Detect a KPI value in a short text response.
 * Returns { value, label } when the text looks like a single metric,
 * otherwise null (text should be rendered as prose).
 */
function detectKPI(text: string | undefined | null): { value: string; label: string } | null {
  if (!text || text.length > 120) return null;
  // Common patterns: "$1.2M", "1,234,567", "42.5%", "3.5x", "€480K"
  const numRe = /[\$£€¥]?[\d,]+(?:\.\d+)?[KMBTx%]?/i;
  const match = text.match(numRe);
  if (!match) return null;
  const value = match[0];
  if (value.length < 1) return null;
  const label = text.replace(value, '').replace(/^[\s:–—\-]+|[\s:–—\-]+$/g, '').trim();
  return { value, label };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DashboardsView({
  apiKey: _apiKey,
  user,
}: {
  apiKey: string;
  user?: { permissions?: string[]; id?: number; role?: string };
}) {
  const hasManageDashboards =
    Array.isArray(user?.permissions) && user.permissions.includes('MANAGE_DASHBOARDS');

  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [selected, setSelected] = useState<Dashboard | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', is_shared: false, role_id: user?.role || 'analyst',
  });
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Per-card refresh state
  const [refreshingCards, setRefreshingCards] = useState<Set<number>>(new Set());
  const [refreshAllProgress, setRefreshAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [refreshedCards, setRefreshedCards] = useState<Set<number>>(new Set());

  // Comments state
  const [commentCardId, setCommentCardId] = useState<number | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<number, number>>({});

  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Drag-to-reorder state
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const dragCounter = useRef(0);

  const ROLES = [
    'owner', 'admin', 'business_owner', 'product_manager',
    'operation_manager', 'analyst', 'sales_team', 'marketing_team', 'viewer',
  ];

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchDashboards = async () => {
    try {
      const d = await api.get<{ dashboards: Dashboard[] }>('/dashboards');
      setDashboards(d.dashboards || []);
    } catch (e) { console.error(e); }
  };

  const fetchCards = async (id: number) => {
    try {
      const d = await api.get<{ dashboard: Dashboard; cards: Card[] }>(`/dashboards/${id}`);
      setSelected(d.dashboard);
      // Sort by layout position: row-major order (y first, then x)
      const sorted = (d.cards || []).slice().sort((a, b) =>
        a.layout_y !== b.layout_y ? a.layout_y - b.layout_y : a.layout_x - b.layout_x
      );
      setCards(sorted);
      // Fetch comment counts for all cards
      if (sorted.length > 0) {
        const cardIds = sorted.map(c => c.id).join(',');
        api.get<{ counts: Record<number, number> }>(`/dashboards/${id}/comment-counts?card_ids=${cardIds}`)
          .then(res => setCommentCounts(res.counts || {}))
          .catch(() => {});
      }
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchDashboards(); }, []);

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setLoading(true);
    try {
      await api.post('/dashboards', { ...form, is_shared: form.is_shared ? 1 : 0 });
      setShowCreate(false);
      setForm({ name: '', description: '', is_shared: false, role_id: user?.role || 'analyst' });
      fetchDashboards();
    } catch (e: any) { alert(e.message || 'Failed to create dashboard'); }
    setLoading(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this dashboard and all its cards?')) return;
    try {
      await api.delete(`/dashboards/${id}`);
      fetchDashboards();
      if (selected?.id === id) { setSelected(null); setCards([]); }
    } catch (e) { console.error(e); }
  };

  const handlePublish = async (id: number, isPublic: number) => {
    try {
      if (isPublic) {
        await api.post(`/dashboards/${id}/unpublish`);
        setShareUrl(null);
      } else {
        const r = await api.post<{ share_url: string }>(`/dashboards/${id}/publish`);
        setShareUrl(r.share_url);
      }
      fetchDashboards();
      if (selected?.id === id) fetchCards(id);
    } catch (e) { console.error(e); }
  };

  // ── Per-card refresh ─────────────────────────────────────────────────────────

  const refreshOneCard = async (cardId: number): Promise<void> => {
    if (!selected) return;
    setRefreshingCards(prev => new Set(prev).add(cardId));
    try {
      await api.post(`/dashboards/${selected.id}/cards/${cardId}/refresh`);
      // Optimistically mark as refreshed; full reload happens after refresh-all finishes
      setRefreshedCards(prev => new Set(prev).add(cardId));
      setTimeout(() => setRefreshedCards(prev => { const n = new Set(prev); n.delete(cardId); return n; }), 2000);
    } catch (e) { console.error(e); }
    finally {
      setRefreshingCards(prev => { const n = new Set(prev); n.delete(cardId); return n; });
    }
  };

  const handleRefreshCard = async (cardId: number) => {
    await refreshOneCard(cardId);
    if (selected) fetchCards(selected.id);
  };

  const handleRefreshAll = async () => {
    if (!selected || cards.length === 0) return;
    setRefreshAllProgress({ done: 0, total: cards.length });
    // Run in parallel batches of 3 to avoid hammering the backend
    const batches: Card[][] = [];
    for (let i = 0; i < cards.length; i += 3) batches.push(cards.slice(i, i + 3));
    let done = 0;
    for (const batch of batches) {
      await Promise.all(batch.map(c => refreshOneCard(c.id)));
      done += batch.length;
      setRefreshAllProgress({ done, total: cards.length });
    }
    setRefreshAllProgress(null);
    fetchCards(selected.id);
  };

  // ── Card width toggle ─────────────────────────────────────────────────────────

  const handleToggleWidth = async (card: Card) => {
    if (!selected) return;
    const newW = card.layout_w > 6 ? 6 : 12;
    try {
      await api.patch(`/dashboards/${selected.id}/cards/${card.id}`, { layout_w: newW });
      setCards(prev => prev.map(c => c.id === card.id ? { ...c, layout_w: newW } : c));
    } catch (e) { console.error(e); }
  };

  const handleRemoveCard = async (cardId: number) => {
    if (!selected || !confirm('Remove this card?')) return;
    try {
      await api.delete(`/dashboards/${selected.id}/cards/${cardId}`);
      setCards(prev => prev.filter(c => c.id !== cardId));
    } catch (e) { console.error(e); }
  };

  // ── Drag-to-reorder ──────────────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Transparent ghost
    const ghost = document.createElement('div');
    ghost.style.position = 'absolute';
    ghost.style.top = '-9999px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const handleDragEnter = (e: React.DragEvent, id: number) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragOverId(id);
  };

  const handleDragLeave = () => {
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setDragOverId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOverId(null);
    if (!dragId || dragId === targetId || !selected) { setDragId(null); return; }

    const reordered = [...cards];
    const fromIdx = reordered.findIndex(c => c.id === dragId);
    const toIdx   = reordered.findIndex(c => c.id === targetId);
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    // Reassign y positions to match new order
    const withPositions = reordered.map((c, i) => ({
      ...c,
      layout_y: i,
      layout_x: 0,
    }));
    setCards(withPositions);
    setDragId(null);

    try {
      await api.post(`/dashboards/${selected.id}/layout`, withPositions.map(c => ({
        id: c.id, layout_x: c.layout_x, layout_y: c.layout_y,
        layout_w: c.layout_w, layout_h: c.layout_h,
      })));
    } catch (e) {
      console.error(e);
      fetchCards(selected.id); // revert on error
    }
  };

  const handleDragEnd = () => { setDragId(null); setDragOverId(null); dragCounter.current = 0; };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Mobile sidebar backdrop ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 sm:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className={[
        'flex flex-col bg-white border-r border-gray-200 shrink-0 z-30 transition-transform duration-200',
        'fixed inset-y-0 left-0 w-80 shadow-xl',
        'sm:relative sm:w-72 sm:translate-x-0 sm:shadow-none',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}>
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="size-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">Dashboards</h2>
          </div>
          <div className="flex items-center gap-1">
            {hasManageDashboards && (
              <button
                onClick={() => setShowCreate(true)}
                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
                title="New dashboard"
              >
                <Plus className="size-4" />
              </button>
            )}
            {/* Close button — mobile only */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="sm:hidden p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"
              title="Close sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </div>
        </div>

        {showCreate && (
          <div className="p-4 border-b border-gray-200 bg-blue-50 space-y-2">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Dashboard name"
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
            />
            <input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description (optional)"
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox" id="is_shared" checked={form.is_shared}
                onChange={e => setForm(f => ({ ...f, is_shared: e.target.checked }))}
                className="rounded text-blue-600 focus:ring-blue-500 size-4"
              />
              <label htmlFor="is_shared" className="text-sm text-gray-700 font-medium">Share with role</label>
            </div>
            {(user?.role === 'admin' || user?.role === 'owner') && (
              <div>
                <label className="text-[10px] text-gray-400 uppercase font-bold mb-1 block">Target Role</label>
                <select
                  value={form.role_id}
                  onChange={e => setForm(f => ({ ...f, role_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500"
                >
                  {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCreate}
                disabled={loading || !form.name}
                className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? '…' : 'Create'}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {dashboards.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">No dashboards yet</p>
          )}
          {dashboards.map(d => (
            <button
              key={d.id}
              onClick={() => { fetchCards(d.id); setSidebarOpen(false); }}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors group ${
                selected?.id === d.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">{d.name}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {d.is_shared ? <Users className="size-3 text-blue-600" title="Shared with role" /> : null}
                  {d.is_public ? <Globe className="size-3 text-green-600" title="Publicly shared" /> : null}
                  {hasManageDashboards && d.created_by === user?.id && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(d.id); }}
                      className="p-0.5 text-red-500 hover:bg-red-50 rounded"
                      title="Delete dashboard"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {d.description && (
                <p className="text-xs text-gray-400 truncate mt-0.5">{d.description}</p>
              )}
              <p className="text-xs text-gray-300 mt-0.5">
                {new Date(d.updated_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-auto bg-gray-50 min-w-0">
        {/* Mobile top bar */}
        <div className="sm:hidden flex items-center gap-3 px-3 py-2.5 bg-white border-b border-gray-200 sticky top-0 z-10">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Show dashboards"
          >
            <Menu className="size-5" />
          </button>
          <span className="font-semibold text-gray-900 text-sm truncate">
            {selected ? selected.name : 'Dashboards'}
          </span>
        </div>

        <div className="p-3 sm:p-6">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-gray-400">
            <LayoutDashboard className="size-16 opacity-20 mb-4" />
            <p className="text-lg font-medium">Select a dashboard</p>
            <p className="text-sm mt-1 text-center px-4">Pin AI responses from the Query page using the 📌 button</p>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto space-y-4">
            {/* ── Dashboard header ── */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{selected.name}</h1>
                {selected.description && (
                  <p className="text-sm text-gray-500 mt-0.5">{selected.description}</p>
                )}
                {cards.length > 0 && (
                  <p className="text-xs text-gray-400 mt-1">
                    {cards.length} card{cards.length !== 1 ? 's' : ''}
                    {hasManageDashboards && <span className="hidden sm:inline"> · drag to reorder · click ⤢ to resize</span>}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Refresh All */}
                <button
                  onClick={handleRefreshAll}
                  disabled={!!refreshAllProgress || cards.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-white text-gray-600 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`size-3.5 ${refreshAllProgress ? 'animate-spin' : ''}`} />
                  {refreshAllProgress
                    ? `${refreshAllProgress.done} / ${refreshAllProgress.total}`
                    : 'Refresh All'}
                </button>
                {/* Publish / Unpublish */}
                {hasManageDashboards && selected.created_by === user?.id && (
                  <button
                    onClick={() => handlePublish(selected.id, selected.is_public)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      selected.is_public
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {selected.is_public
                      ? <><EyeOff className="size-4" />Unpublish</>
                      : <><Globe className="size-4" />Publish</>}
                  </button>
                )}
              </div>
            </div>

            {/* Share URL banner */}
            {shareUrl && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Share2 className="size-4 text-green-600" />
                  <span className="text-sm text-green-800 font-medium">Dashboard published!</span>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-blue-600 underline flex items-center gap-1"
                  >
                    {shareUrl}<ExternalLink className="size-3" />
                  </a>
                </div>
                <button onClick={() => setShareUrl(null)}>
                  <X className="size-4 text-gray-400" />
                </button>
              </div>
            )}

            {/* ── Card grid ── */}
            {cards.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border-2 border-dashed border-gray-200 text-gray-400">
                <Pin className="size-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No cards pinned yet</p>
                <p className="text-sm mt-1">
                  Use the{' '}
                  <span className="font-semibold text-purple-600">📌 Pin to Dashboard</span>{' '}
                  button on any AI response in the Query page.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 items-start">
                {cards.map(card => {
                  const viz      = parseViz(card.visualization);
                  const hasChart = isValidViz(viz);
                  const kpi      = !hasChart ? detectKPI(card.response_text) : null;
                  const isWide   = card.layout_w > 6;
                  const isRefreshing = refreshingCards.has(card.id);
                  const isRefreshed  = refreshedCards.has(card.id);
                  const isDragOver   = dragOverId === card.id && dragId !== card.id;

                  return (
                    <div
                      key={card.id}
                      draggable={hasManageDashboards}
                      onDragStart={e => handleDragStart(e, card.id)}
                      onDragEnter={e => handleDragEnter(e, card.id)}
                      onDragLeave={handleDragLeave}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleDrop(e, card.id)}
                      onDragEnd={handleDragEnd}
                      className={[
                        'bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col transition-all duration-200',
                        isWide ? 'md:col-span-2' : '',
                        isDragOver ? 'border-blue-400 shadow-md ring-2 ring-blue-200 scale-[1.01]' : 'border-gray-200',
                        dragId === card.id ? 'opacity-40' : 'opacity-100',
                      ].join(' ')}
                    >
                      {/* Card header */}
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {/* Drag handle — desktop only */}
                          {hasManageDashboards && (
                            <GripVertical className="hidden sm:block size-4 text-gray-300 shrink-0 cursor-grab active:cursor-grabbing" />
                          )}
                          {hasChart
                            ? <div className="size-2 rounded-full bg-blue-500 shrink-0" />
                            : kpi
                              ? <TrendingUp className="size-3.5 text-emerald-500 shrink-0" />
                              : <FileText className="size-3.5 text-gray-400 shrink-0" />}
                          <h3 className="font-semibold text-gray-800 text-sm truncate">
                            {card.title || card.query_text || 'Untitled Card'}
                          </h3>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {/* Comments bubble */}
                          <CommentBubble
                            count={commentCounts[card.id] ?? 0}
                            onClick={() => setCommentCardId(commentCardId === card.id ? null : card.id)}
                          />
                          {/* Refresh */}
                          <button
                            onClick={() => handleRefreshCard(card.id)}
                            disabled={isRefreshing}
                            title="Refresh card"
                            className="p-2 sm:p-1.5 rounded-lg transition-colors text-blue-500 hover:bg-blue-50 disabled:opacity-50 min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                          >
                            {isRefreshing
                              ? <RefreshCw className="size-4 sm:size-3.5 animate-spin" />
                              : isRefreshed
                                ? <CheckCircle2 className="size-4 sm:size-3.5 text-emerald-500" />
                                : <RefreshCw className="size-4 sm:size-3.5" />}
                          </button>
                          {/* Expand / Collapse — desktop only */}
                          {hasManageDashboards && (
                            <button
                              onClick={() => handleToggleWidth(card)}
                              title={isWide ? 'Collapse to half width' : 'Expand to full width'}
                              className="hidden sm:flex p-1.5 rounded-lg transition-colors text-gray-400 hover:bg-gray-100 hover:text-gray-600 items-center justify-center"
                            >
                              {isWide
                                ? <Minimize2 className="size-3.5" />
                                : <Maximize2 className="size-3.5" />}
                            </button>
                          )}
                          {/* Remove */}
                          {hasManageDashboards && selected.created_by === user?.id && (
                            <button
                              onClick={() => handleRemoveCard(card.id)}
                              title="Remove card"
                              className="p-2 sm:p-1.5 rounded-lg transition-colors text-red-400 hover:bg-red-50 min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                            >
                              <X className="size-4 sm:size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* KPI tile */}
                      {kpi && (
                        <div className="flex flex-col items-center justify-center py-8 px-6 flex-1 bg-gradient-to-b from-white to-gray-50">
                          <span className="text-5xl font-black text-gray-900 tracking-tight leading-none">
                            {kpi.value}
                          </span>
                          {kpi.label && (
                            <span className="text-sm text-gray-500 mt-2 text-center">{kpi.label}</span>
                          )}
                        </div>
                      )}

                      {/* Chart */}
                      {hasChart && (
                        <div className="px-4 pt-4">
                          <ChartDisplay visualization={viz} />
                        </div>
                      )}

                      {/* Analysis text (only when it's not a KPI) */}
                      {card.response_text && !kpi && (
                        <div className={`px-5 py-4 flex-1 ${hasChart ? 'border-t border-gray-100 mt-3' : ''}`}>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Analysis</p>
                          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                            {card.response_text}
                          </p>
                        </div>
                      )}

                      {/* Empty state */}
                      {!card.response_text && !hasChart && !kpi && (
                        <div className="px-5 py-8 text-center text-gray-400">
                          <p className="text-xs italic">No content — click Refresh to re-run the query.</p>
                        </div>
                      )}

                      {/* Footer: original query */}
                      {card.query_text && (
                        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
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
        </div>{/* /p-3 sm:p-6 */}
      </main>

      {/* Slide-out comments panel */}
      {commentCardId !== null && selected && (
        <div className="fixed inset-y-0 right-0 z-40 flex">
          <div className="fixed inset-0 bg-black/20" onClick={() => setCommentCardId(null)} />
          <div className="relative ml-auto w-full sm:w-80 bg-white shadow-2xl border-l border-gray-200 flex flex-col">
            <CardComments
              dashboardId={selected.id}
              cardId={commentCardId}
              cardTitle={cards.find(c => c.id === commentCardId)?.title || cards.find(c => c.id === commentCardId)?.query_text}
              currentUser={user as any}
              onClose={() => setCommentCardId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
