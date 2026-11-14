/**
 * ImpactAnalysisPanel.tsx
 *
 * Shows every dashboard card, notebook cell, scheduled report, query history
 * entry, and query template that references a given table.column.
 *
 * Usage — as a modal:
 *   <ImpactAnalysisPanel table="orders" column="user_id" onClose={...} onNavigate={...} />
 *
 * Usage — as an inline widget:
 *   <ImpactAnalysisPanel table="orders" column="user_id" inline onNavigate={...} />
 */

import { useState, useEffect, useCallback } from 'react';
import {
  X, Loader2, AlertCircle, LayoutGrid, BookOpen, History,
  Calendar, BookMarked, Zap, ChevronRight, ExternalLink,
  Search, Info,
} from 'lucide-react';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type ResultType =
  | 'dashboard_card'
  | 'notebook_cell'
  | 'query_history'
  | 'scheduled_report'
  | 'query_template';

interface ImpactResult {
  type: ResultType;
  id: number;
  title: string;
  parent_id: number | null;
  parent_name: string | null;
  snippet: string;
  created_at?: string | null;
  navigate_to: string;
}

interface ImpactResponse {
  table: string;
  column: string;
  total_hits: number;
  results: ImpactResult[];
}

interface Props {
  table: string;
  column: string;
  inline?: boolean;
  onClose?: () => void;
  onNavigate?: (view: string) => void;
}

// ── Config per result type ────────────────────────────────────────────────────

const TYPE_META: Record<ResultType, { label: string; icon: React.FC<any>; color: string; bg: string }> = {
  dashboard_card:   { label: 'Dashboard card',    icon: LayoutGrid,  color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-100' },
  notebook_cell:    { label: 'Notebook',           icon: BookOpen,    color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-100' },
  query_history:    { label: 'Query history',      icon: History,     color: 'text-gray-600',   bg: 'bg-gray-50 border-gray-100' },
  scheduled_report: { label: 'Scheduled report',   icon: Calendar,    color: 'text-orange-600', bg: 'bg-orange-50 border-orange-100' },
  query_template:   { label: 'Query template',     icon: BookMarked,  color: 'text-teal-600',   bg: 'bg-teal-50 border-teal-100' },
};

const TYPE_ORDER: ResultType[] = [
  'dashboard_card', 'notebook_cell', 'scheduled_report', 'query_template', 'query_history',
];

// ── Snippet with highlight ────────────────────────────────────────────────────

function Snippet({ text, column }: { text: string; column: string }) {
  const regex = new RegExp(`(${column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <code className="block mt-1.5 text-xs font-mono text-gray-600 bg-gray-900/5 rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap break-all">
      {parts.map((p, i) =>
        regex.test(p)
          ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5 font-semibold not-italic">{p}</mark>
          : p
      )}
    </code>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({ result, column, onNavigate }: {
  result: ImpactResult;
  column: string;
  onNavigate?: (view: string) => void;
}) {
  const meta = TYPE_META[result.type] ?? TYPE_META.query_history;
  const Icon = meta.icon;

  return (
    <div className={`border rounded-xl p-3 ${meta.bg}`}>
      <div className="flex items-start gap-2.5">
        <div className={`size-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-white border ${meta.bg}`}>
          <Icon className={`size-4 ${meta.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-widest ${meta.color}`}>{meta.label}</span>
            {result.parent_name && (
              <span className="text-xs text-gray-400">in {result.parent_name}</span>
            )}
          </div>
          <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">{result.title}</p>
          {result.snippet && <Snippet text={result.snippet} column={column} />}
        </div>
        {onNavigate && (
          <button
            onClick={() => onNavigate(result.navigate_to)}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 transition-all"
            title={`Go to ${meta.label}`}
          >
            Go <ExternalLink className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImpactAnalysisPanel({ table, column, inline = false, onClose, onNavigate }: Props) {
  const [data, setData]       = useState<ImpactResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const run = useCallback(async () => {
    if (!table || !column) return;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const r = await api.get<ImpactResponse>(
        `/impact/analyze?table=${encodeURIComponent(table)}&column=${encodeURIComponent(column)}`
      );
      setData(r);
    } catch (e: any) {
      setError(e?.message ?? 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }, [table, column]);

  useEffect(() => { run(); }, [run]);

  // Group results by type in display order
  const grouped: Partial<Record<ResultType, ImpactResult[]>> = {};
  for (const t of TYPE_ORDER) {
    const hits = data?.results.filter(r => r.type === t) ?? [];
    if (hits.length) grouped[t] = hits;
  }

  const inner = (
    <div className={inline ? '' : 'flex flex-col h-full'}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
        <div className="size-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
          <Zap className="size-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-gray-900">Impact Analysis</h2>
          <p className="text-xs text-gray-400 truncate">
            <code className="font-mono text-amber-600">{table}</code>
            <span className="mx-1 text-gray-300">.</span>
            <code className="font-mono text-orange-600 font-semibold">{column}</code>
          </p>
        </div>
        {!inline && onClose && (
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <X className="size-5" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className={`${inline ? '' : 'flex-1 overflow-y-auto'} px-5 py-4 space-y-4`}>
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-3">
              <Loader2 className="size-7 animate-spin text-amber-400 mx-auto" />
              <p className="text-sm text-gray-400">Scanning dashboards, notebooks, reports…</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertCircle className="size-4 shrink-0" /> {error}
          </div>
        )}

        {data && !loading && (
          <>
            {/* Summary banner */}
            <div className={`flex items-center gap-3 p-3 rounded-xl border ${
              data.total_hits === 0
                ? 'bg-emerald-50 border-emerald-100'
                : 'bg-amber-50 border-amber-100'
            }`}>
              {data.total_hits === 0 ? (
                <>
                  <div className="size-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Search className="size-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-700">No references found</p>
                    <p className="text-xs text-emerald-600 mt-0.5">
                      Safe to rename or drop — nothing currently references this column.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="size-7 rounded-lg bg-amber-100 flex items-center justify-center">
                    <AlertCircle className="size-4 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-700">
                      {data.total_hits} reference{data.total_hits !== 1 ? 's' : ''} found
                    </p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      These will break if you rename or drop this column.
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {TYPE_ORDER.filter(t => grouped[t]).map(t => {
                      const meta = TYPE_META[t];
                      const Icon = meta.icon;
                      return (
                        <span key={t} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${meta.bg} ${meta.color}`}>
                          <Icon className="size-3" />
                          {grouped[t]!.length}
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Results grouped by type */}
            {TYPE_ORDER.filter(t => grouped[t]).map(t => (
              <div key={t}>
                <div className="flex items-center gap-2 mb-2">
                  {(() => { const Icon = TYPE_META[t].icon; return <Icon className={`size-3.5 ${TYPE_META[t].color}`} />; })()}
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {TYPE_META[t].label}s ({grouped[t]!.length})
                  </span>
                </div>
                <div className="space-y-2">
                  {grouped[t]!.map((r, i) => (
                    <ResultCard key={i} result={r} column={column} onNavigate={onNavigate} />
                  ))}
                </div>
              </div>
            ))}

            {/* Tip */}
            {data.total_hits > 0 && (
              <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                <Info className="size-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 leading-relaxed">
                  <strong>Before renaming:</strong> update the SQL in every item above, or create a database view that
                  aliases the old column name to the new one to maintain backwards compatibility.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  if (inline) return <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">{inner}</div>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
        {inner}
      </div>
    </div>
  );
}

// ── Compact trigger button (for DataCatalog / SchemaDiagram) ──────────────────

export function ImpactButton({
  table, column, onNavigate,
}: {
  table: string;
  column: string;
  onNavigate?: (view: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-100 transition-colors"
        title="Column impact analysis"
      >
        <Zap className="size-3" /> Impact
      </button>
      {open && (
        <ImpactAnalysisPanel
          table={table}
          column={column}
          onClose={() => setOpen(false)}
          onNavigate={(v) => { setOpen(false); onNavigate?.(v); }}
        />
      )}
    </>
  );
}
