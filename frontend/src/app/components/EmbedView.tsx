/**
 * EmbedView — minimal, unauthenticated page for embedding dashboard cards/dashboards.
 *
 * Rendered when the URL matches:
 *   /embed/card/:token        → single card widget
 *   /embed/dashboard/:token   → full published dashboard
 *
 * Designed to live inside an <iframe>. No navigation, no sidebar, transparent/white bg.
 * Respects ?theme=dark query param.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, TrendingUp, FileText } from 'lucide-react';
import { ChartDisplay } from './ChartDisplay';

// ── Types ────────────────────────────────────────────────────────────────────

interface Card {
  id: number;
  title?: string;
  query_text?: string;
  response_text?: string;
  visualization?: any;
  card_type: string;
  layout_w: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseViz(raw: any): any | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function isValidViz(viz: any): boolean {
  if (!viz || !viz.type || !viz.data) return false;
  const d = viz.data;
  if (viz.type === 'scatter' || viz.type === 'scatter_plot') return !!(d.x?.length && d.y?.length);
  if (d.datasets?.length) return true;
  return !!(Array.isArray(d.labels) && Array.isArray(d.values) && d.labels.length > 0);
}

function detectKPI(text: string | undefined | null): { value: string; label: string } | null {
  if (!text || text.length > 120) return null;
  const numRe = /[\$£€¥]?[\d,]+(?:\.\d+)?[KMBTx%]?/i;
  const match = text.match(numRe);
  if (!match) return null;
  const value = match[0];
  if (value.length < 1) return null;
  const label = text.replace(value, '').replace(/^[\s:–—\-]+|[\s:–—\-]+$/g, '').trim();
  return { value, label };
}

function apiBase(): string {
  return (window as any).__VANTAGE_API_URL__ ||
    (import.meta as any).env?.VITE_API_URL ||
    'http://localhost:8000';
}

// ── Single card widget ────────────────────────────────────────────────────────

function CardWidget({ card, dark }: { card: Card; dark: boolean }) {
  const viz      = parseViz(card.visualization);
  const hasChart = isValidViz(viz);
  const kpi      = !hasChart ? detectKPI(card.response_text) : null;

  const bg      = dark ? 'bg-gray-900' : 'bg-white';
  const border  = dark ? 'border-gray-700' : 'border-gray-200';
  const headBg  = dark ? 'bg-gray-800' : 'bg-gray-50';
  const titleCl = dark ? 'text-gray-100' : 'text-gray-800';
  const textCl  = dark ? 'text-gray-300' : 'text-gray-700';
  const subCl   = dark ? 'text-gray-500' : 'text-gray-400';

  return (
    <div className={`rounded-2xl border ${border} ${bg} overflow-hidden flex flex-col h-full`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${border} ${headBg}`}>
        {hasChart
          ? <div className="size-2 rounded-full bg-blue-500 shrink-0" />
          : kpi
            ? <TrendingUp className="size-3.5 text-emerald-500 shrink-0" />
            : <FileText className={`size-3.5 ${subCl} shrink-0`} />}
        <h3 className={`font-semibold text-sm truncate ${titleCl}`}>
          {card.title || card.query_text || 'Untitled'}
        </h3>
      </div>

      {/* KPI */}
      {kpi && (
        <div className={`flex flex-col items-center justify-center py-8 px-6 flex-1 ${bg}`}>
          <span className={`text-5xl font-black tracking-tight leading-none ${dark ? 'text-white' : 'text-gray-900'}`}>
            {kpi.value}
          </span>
          {kpi.label && (
            <span className={`text-sm mt-2 text-center ${subCl}`}>{kpi.label}</span>
          )}
        </div>
      )}

      {/* Chart */}
      {hasChart && (
        <div className="px-4 pt-4 flex-1">
          <ChartDisplay visualization={viz} />
        </div>
      )}

      {/* Analysis */}
      {card.response_text && !kpi && (
        <div className={`px-5 py-4 flex-1 ${hasChart ? `border-t ${border} mt-3` : ''}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${subCl}`}>Analysis</p>
          <p className={`text-sm leading-relaxed whitespace-pre-wrap ${textCl}`}>
            {card.response_text}
          </p>
        </div>
      )}

      {/* Empty */}
      {!card.response_text && !hasChart && !kpi && (
        <div className={`px-5 py-8 text-center ${subCl}`}>
          <p className="text-xs italic">No content yet.</p>
        </div>
      )}

      {/* Footer query */}
      {card.query_text && (
        <div className={`px-4 py-2 border-t ${border} ${headBg}`}>
          <p className={`text-xs truncate ${subCl}`}>
            <span className="font-medium">Q:</span> {card.query_text}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main embed page ───────────────────────────────────────────────────────────

interface EmbedViewProps {
  mode: 'card' | 'dashboard';
  token: string;
}

export function EmbedView({ mode, token }: EmbedViewProps) {
  const params = new URLSearchParams(window.location.search);
  const dark   = params.get('theme') === 'dark';

  const [card, setCard]           = useState<Card | null>(null);
  const [dashboard, setDashboard] = useState<{ name: string } | null>(null);
  const [cards, setCards]         = useState<Card[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  useEffect(() => {
    const base = apiBase();
    const url  = mode === 'card'
      ? `${base}/embed/card/${encodeURIComponent(token)}`
      : `${base}/embed/dashboard/${encodeURIComponent(token)}`;

    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Error ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (mode === 'card') {
          setCard(data.card);
        } else {
          setDashboard(data.dashboard);
          setCards(data.cards || []);
        }
      })
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [mode, token]);

  const rootCl = dark
    ? 'min-h-screen bg-gray-950 text-gray-100'
    : 'min-h-screen bg-white text-gray-900';

  if (loading) {
    return (
      <div className={`${rootCl} flex items-center justify-center h-screen`}>
        <Loader2 className="size-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${rootCl} flex flex-col items-center justify-center h-screen gap-3 px-6`}>
        <AlertCircle className="size-10 text-red-400" />
        <p className="text-sm font-medium text-center">{error}</p>
      </div>
    );
  }

  /* ── Single-card embed ── */
  if (mode === 'card' && card) {
    return (
      <div className={`${rootCl} p-3 h-screen`}>
        <CardWidget card={card} dark={dark} />
      </div>
    );
  }

  /* ── Full dashboard embed ── */
  if (mode === 'dashboard') {
    const borderCl = dark ? 'border-gray-800' : 'border-gray-200';
    const subCl    = dark ? 'text-gray-400' : 'text-gray-500';

    return (
      <div className={`${rootCl} min-h-screen`}>
        {/* Minimal header */}
        {dashboard && (
          <div className={`px-5 py-3 border-b ${borderCl} flex items-center gap-2`}>
            <RefreshCw className="size-4 text-blue-500 shrink-0" />
            <span className="font-semibold text-sm">{dashboard.name}</span>
            <span className={`text-xs ${subCl} ml-auto`}>Live Dashboard</span>
          </div>
        )}

        {/* Card grid */}
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((c) => (
            <div
              key={c.id}
              className={c.layout_w > 6 ? 'md:col-span-2' : ''}
            >
              <CardWidget card={c} dark={dark} />
            </div>
          ))}
          {cards.length === 0 && (
            <div className={`col-span-2 text-center py-16 ${subCl} text-sm`}>
              No cards on this dashboard yet.
            </div>
          )}
        </div>

        {/* Powered-by footer */}
        <div className={`px-5 py-2 border-t ${borderCl} text-center`}>
          <span className={`text-[10px] ${subCl}`}>Powered by Vantage AI</span>
        </div>
      </div>
    );
  }

  return null;
}
