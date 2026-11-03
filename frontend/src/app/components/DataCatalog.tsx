/**
 * DataCatalog.tsx — Feature: Data Catalog / Column Glossary
 *
 * Admin panel to browse tables and their AI-generated (or manually edited)
 * column descriptions.  The AI query engine already injects these as context,
 * so better descriptions = better query results.
 *
 * Backend endpoints (all in /org_context router):
 *   GET  /column-descriptions?table_name=X   — list descriptions for a table
 *   PUT  /column-descriptions/{table}/{col}  — save a manual edit
 *   POST /column-descriptions/{table}/regenerate — re-run AI generation
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import {
  BookOpen,
  RefreshCw,
  Sparkles,
  Pencil,
  Save,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Search,
  Database,
  Clock,
  Tag,
} from 'lucide-react';

/* ──────────────────────────── types ──────────────────────────────────────── */

interface ColumnDescription {
  table_name: string;
  column_name: string;
  description: string;
  generated_by: 'ai' | 'manual' | string;
  generated_at?: string;
  sample_values?: string;
}

interface FreshnessEntry {
  table_name: string;
  last_updated: string;
}

/* ──────────────────────────── helpers ────────────────────────────────────── */

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 2)   return 'just now';
  if (hours < 1)  return `${mins}m ago`;
  if (days < 1)   return `${hours}h ago`;
  if (days < 30)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* ──────────────────────────── ColumnRow ──────────────────────────────────── */

interface ColumnRowProps {
  entry: ColumnDescription;
  onSave: (col: string, desc: string) => Promise<void>;
}

function ColumnRow({ entry, onSave }: ColumnRowProps) {
  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState(entry.description || '');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(entry.column_name, draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const isAI = entry.generated_by === 'ai';

  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0 group">
      {/* Column name + badge */}
      <div className="w-44 shrink-0 pt-0.5">
        <span className="font-mono text-sm font-semibold text-slate-700">{entry.column_name}</span>
        <span className={`ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
          isAI
            ? 'bg-violet-100 text-violet-600'
            : 'bg-blue-100 text-blue-600'
        }`}>
          {isAI ? '✦ AI' : '✎ manual'}
        </span>
      </div>

      {/* Description / editor */}
      <div className="flex-1">
        {editing ? (
          <div className="flex items-start gap-2">
            <textarea
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={2}
              className="flex-1 px-3 py-1.5 text-sm border-2 border-blue-300 rounded-xl focus:outline-none focus:border-blue-500 resize-none"
              placeholder="Describe this column for the AI query engine…"
            />
            <div className="flex flex-col gap-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-60"
                title="Save"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              </button>
              <button
                onClick={() => { setEditing(false); setDraft(entry.description || ''); }}
                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors"
                title="Cancel"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <p className={`flex-1 text-sm leading-relaxed ${
              entry.description
                ? 'text-slate-700'
                : 'text-slate-400 italic'
            }`}>
              {entry.description || 'No description yet'}
            </p>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              {saved && <CheckCircle2 className="size-3.5 text-emerald-500" />}
              <button
                onClick={() => setEditing(true)}
                className="p-1 text-slate-400 hover:text-blue-600 rounded-lg transition-colors"
                title="Edit description"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Sample values */}
        {entry.sample_values && !editing && (
          <div className="mt-1 flex items-center gap-1">
            <Tag className="size-3 text-slate-300" />
            <span className="text-[11px] text-slate-400 font-mono truncate max-w-xs">
              {entry.sample_values}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────── TableSection ──────────────────────────────── */

interface TableSectionProps {
  tableName: string;
  freshness?: FreshnessEntry;
  onSelect: () => void;
  selected: boolean;
  descCount: number;
  onRegenerate: (table: string) => Promise<void>;
  regenerating: boolean;
  children: React.ReactNode;
}

function TableSection({
  tableName, freshness, onSelect, selected, descCount,
  onRegenerate, regenerating, children,
}: TableSectionProps) {
  return (
    <div className={`bg-white border rounded-2xl overflow-hidden transition-all ${
      selected ? 'border-blue-300 shadow-md' : 'border-slate-200'
    }`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={onSelect}
      >
        <div className="p-2 bg-slate-100 rounded-xl shrink-0">
          <Database className="size-4 text-slate-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-800 font-mono text-sm">{tableName}</span>
            <span className="text-xs text-slate-400">
              {descCount} {descCount === 1 ? 'column' : 'columns'} documented
            </span>
            {freshness && (
              <span className="flex items-center gap-1 text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                <Clock className="size-2.5" />
                Updated {timeAgo(freshness.last_updated)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onRegenerate(tableName); }}
            disabled={regenerating}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors disabled:opacity-50"
            title="Re-run AI description generation"
          >
            {regenerating
              ? <Loader2 className="size-3 animate-spin" />
              : <Sparkles className="size-3" />
            }
            {regenerating ? 'Generating…' : 'AI Refresh'}
          </button>
          {selected ? <ChevronUp className="size-4 text-slate-400" /> : <ChevronDown className="size-4 text-slate-400" />}
        </div>
      </div>

      {/* Columns list */}
      {selected && (
        <div className="px-4 pb-4 border-t border-slate-100">
          {children}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────── main component ──────────────────────────────── */

export function DataCatalog() {
  const [tables,     setTables]     = useState<string[]>([]);
  const [selected,   setSelected]   = useState<string | null>(null);
  const [columns,    setColumns]    = useState<Record<string, ColumnDescription[]>>({});
  const [freshness,  setFreshness]  = useState<Record<string, FreshnessEntry>>({});
  const [loading,    setLoading]    = useState(true);
  const [colLoading, setColLoading] = useState<string | null>(null);
  const [regenFor,   setRegenFor]   = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [flash,      setFlash]      = useState<string | null>(null);
  const [search,     setSearch]     = useState('');

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  };

  /* ── load table list ─────────────────────────────────────────────────── */
  const loadTables = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Reuse the column-descriptions endpoint to discover tables
      const data = await api.get<ColumnDescription[]>('/column-descriptions');
      const uniqueTables = [...new Set(data.map(d => d.table_name))];
      setTables(uniqueTables);
      // Pre-populate column cache
      const cache: Record<string, ColumnDescription[]> = {};
      uniqueTables.forEach(t => {
        cache[t] = data.filter(d => d.table_name === t);
      });
      setColumns(cache);
    } catch (e: any) {
      setError(e.message || 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── load freshness ──────────────────────────────────────────────────── */
  const loadFreshness = useCallback(async () => {
    try {
      const data = await api.get<{ freshness: FreshnessEntry[] }>('/data/freshness');
      const map: Record<string, FreshnessEntry> = {};
      data.freshness.forEach(f => { map[f.table_name] = f; });
      setFreshness(map);
    } catch {
      // non-fatal — freshness badges just won't show
    }
  }, []);

  useEffect(() => {
    loadTables();
    loadFreshness();
  }, [loadTables, loadFreshness]);

  /* ── expand a table ──────────────────────────────────────────────────── */
  async function handleSelect(tableName: string) {
    if (selected === tableName) {
      setSelected(null);
      return;
    }
    setSelected(tableName);
    if (!columns[tableName]) {
      setColLoading(tableName);
      try {
        const data = await api.get<ColumnDescription[]>(`/column-descriptions?table_name=${encodeURIComponent(tableName)}`);
        setColumns(prev => ({ ...prev, [tableName]: data }));
      } catch {
        // ignore; the cache might already have it
      } finally {
        setColLoading(null);
      }
    }
  }

  /* ── save an edited description ──────────────────────────────────────── */
  async function handleSave(tableName: string, colName: string, desc: string) {
    await api.put(`/column-descriptions/${encodeURIComponent(tableName)}/${encodeURIComponent(colName)}`, { description: desc });
    setColumns(prev => ({
      ...prev,
      [tableName]: (prev[tableName] ?? []).map(c =>
        c.column_name === colName
          ? { ...c, description: desc, generated_by: 'manual' }
          : c
      ),
    }));
  }

  /* ── re-run AI generation ────────────────────────────────────────────── */
  async function handleRegenerate(tableName: string) {
    setRegenFor(tableName);
    try {
      await api.post(`/column-descriptions/${encodeURIComponent(tableName)}/regenerate`, {});
      showFlash(`AI descriptions queued for "${tableName}" — refresh in a few seconds.`);
      // Reload after a brief delay so background task has a chance to run
      setTimeout(() => {
        api.get<ColumnDescription[]>(`/column-descriptions?table_name=${encodeURIComponent(tableName)}`)
          .then(data => setColumns(prev => ({ ...prev, [tableName]: data })))
          .catch(() => {});
      }, 4000);
    } catch (e: any) {
      setError(e.message || 'Regeneration failed');
    } finally {
      setRegenFor(null);
    }
  }

  /* ── filtered table list ─────────────────────────────────────────────── */
  const filteredTables = tables.filter(t =>
    t.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-50 rounded-2xl">
            <BookOpen className="size-7 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900">Data Catalog</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Document every table and column. The AI query engine uses these descriptions as context — better docs = better queries.
            </p>
          </div>
        </div>
        <button
          onClick={() => { loadTables(); loadFreshness(); }}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors text-sm font-medium"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin text-blue-500' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Flash */}
      {flash && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm font-medium">
          <CheckCircle2 className="size-4 shrink-0" />
          {flash}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search tables…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 bg-white"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-8 animate-spin text-slate-300" />
        </div>
      ) : filteredTables.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
          <BookOpen className="size-10 text-slate-300 mx-auto mb-3" />
          <p className="font-bold text-slate-500">
            {tables.length === 0 ? 'No tables documented yet' : 'No tables match your search'}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            {tables.length === 0
              ? 'Import data first — AI descriptions are generated automatically on upload.'
              : 'Try a different search term.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTables.map(tableName => {
            const cols = columns[tableName] ?? [];
            return (
              <TableSection
                key={tableName}
                tableName={tableName}
                freshness={freshness[tableName]}
                onSelect={() => handleSelect(tableName)}
                selected={selected === tableName}
                descCount={cols.filter(c => c.description).length}
                onRegenerate={handleRegenerate}
                regenerating={regenFor === tableName}
              >
                {colLoading === tableName ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="size-5 animate-spin text-slate-300" />
                  </div>
                ) : cols.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center italic">
                    No column descriptions yet — click AI Refresh to generate them.
                  </p>
                ) : (
                  <div className="pt-2">
                    {cols.map(col => (
                      <ColumnRow
                        key={col.column_name}
                        entry={col}
                        onSave={(colName, desc) => handleSave(tableName, colName, desc)}
                      />
                    ))}
                  </div>
                )}
              </TableSection>
            );
          })}
        </div>
      )}

      {/* How it helps */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 space-y-2">
        <h3 className="font-bold text-blue-800 text-sm flex items-center gap-2">
          <Sparkles className="size-4" /> How the catalog improves AI queries
        </h3>
        <ul className="text-sm text-blue-700/80 space-y-1 list-disc list-inside">
          <li>Column descriptions are injected into the AI system prompt when a query references the table.</li>
          <li>The AI uses descriptions to map natural-language terms to the correct columns.</li>
          <li>Manual edits take precedence over AI-generated descriptions.</li>
          <li>Click <strong>AI Refresh</strong> to re-generate descriptions after schema changes.</li>
        </ul>
      </div>
    </div>
  );
}
