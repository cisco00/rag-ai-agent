/**
 * SharedDashboard — Public, unauthenticated viewer for a published dashboard.
 *
 * Route: /dashboards/shared/:token  (no login required)
 * Backend: GET /dashboards/shared/{token} → { dashboard, cards }
 */

import { useEffect, useState } from 'react';
import {
  LayoutDashboard, AlertCircle, Loader2, Globe, Calendar,
  BarChart2, FileText, TrendingUp,
} from 'lucide-react';
import { ChartDisplay } from './ChartDisplay';

// ── Types ────────────────────────────────────────────────────────────────────

interface Dashboard {
  id: number;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

interface Card {
  id: number;
  title?: string;
  query_text?: string;
  response_text?: string;
  visualization?: any;
  card_type: string;
  layout_w: number;
  layout_x: number;
  layout_y: number;
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

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch { return iso; }
}

// ── Card renderer ────────────────────────────────────────────────────────────

function PublicCard({ card }: { card: Card }) {
  const viz = parseViz(card.visualization);
  const validViz = viz && isValidViz(viz);
  const kpi = !validViz ? detectKPI(card.response_text) : null;

  const isWide = card.layout_w > 6;

  return (
    <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col ${isWide ? 'col-span-2' : 'col-span-1'}`}>
      {/* Card header */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        {validViz ? (
          <BarChart2 className="size-4 text-blue-500 shrink-0" />
        ) : kpi ? (
          <TrendingUp className="size-4 text-emerald-500 shrink-0" />
        ) : (
          <FileText className="size-4 text-slate-400 shrink-0" />
        )}
        {card.title && (
          <h3 className="font-bold text-sm text-slate-800 truncate">{card.title}</h3>
        )}
        {card.query_text && !card.title && (
          <p className="text-xs text-slate-400 truncate italic">{card.query_text}</p>
        )}
      </div>

      {/* Card content */}
      <div className="flex-1 p-4">
        {kpi ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[80px] py-4">
            <div className="text-4xl font-black text-slate-900 tracking-tight">{kpi.value}</div>
            {kpi.label && <div className="text-sm text-slate-500 mt-1.5">{kpi.label}</div>}
          </div>
        ) : validViz ? (
          <div className="h-64">
            <ChartDisplay visualization={viz} />
          </div>
        ) : card.response_text ? (
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
            {card.response_text}
          </p>
        ) : (
          <div className="flex items-center justify-center h-20 text-slate-400 text-sm">
            No content
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface SharedDashboardProps {
  token: string;
}

export function SharedDashboard({ token }: SharedDashboardProps) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [cards, setCards]         = useState<Card[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  useEffect(() => {
    const base = apiBase();
    fetch(`${base}/dashboards/shared/${encodeURIComponent(token)}`)
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Error ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        setDashboard(data.dashboard);
        const sorted = (data.cards || []).slice().sort((a: Card, b: Card) =>
          a.layout_y !== b.layout_y ? a.layout_y - b.layout_y : a.layout_x - b.layout_x
        );
        setCards(sorted);
      })
      .catch(err => setError(err.message || 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-blue-500" />
          <p className="text-sm text-slate-500">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
        <div className="bg-white border border-red-200 rounded-2xl shadow-sm p-8 max-w-md w-full text-center space-y-3">
          <AlertCircle className="size-10 text-red-400 mx-auto" />
          <h2 className="font-bold text-slate-800 text-lg">Dashboard unavailable</h2>
          <p className="text-sm text-slate-500">{error}</p>
          <p className="text-xs text-slate-400">This link may have expired or been unpublished.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-xl">
            <LayoutDashboard className="size-5 text-blue-600" />
          </div>
          <div>
            <h1 className="font-black text-slate-900 text-lg leading-tight">
              {dashboard?.name}
            </h1>
            {dashboard?.description && (
              <p className="text-xs text-slate-500 mt-0.5">{dashboard.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full font-medium border border-emerald-200">
            <Globe className="size-3" />
            Public dashboard
          </span>
          {dashboard?.updated_at && (
            <span className="hidden sm:flex items-center gap-1.5">
              <Calendar className="size-3" />
              Updated {formatDate(dashboard.updated_at)}
            </span>
          )}
        </div>
      </header>

      {/* Cards grid */}
      <main className="max-w-7xl mx-auto p-6">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
            <LayoutDashboard className="size-12 opacity-30" />
            <p className="text-sm">This dashboard has no cards yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cards.map(card => (
              <PublicCard key={card.id} card={card} />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-xs text-slate-400">
        Powered by Vantage AI · Read-only view
      </footer>
    </div>
  );
}
