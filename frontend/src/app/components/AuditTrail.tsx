/**
 * AuditTrail.tsx — Feature #11: Data Lineage & Audit Trail
 *
 * Two-tab admin panel:
 *   • Audit Log   — paginated table of every AI query: who, when, SQL, tables, status
 *   • Data Lineage — table-centric view showing which tables were accessed, how often,
 *                    and by whom (with a simple heat-bar visualisation)
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import {
  ClipboardList,
  GitBranch,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Database,
  User,
  Calendar,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

/* ─────────────────────────── types ───────────────────────────────────────── */

interface AuditEntry {
  id: number;
  user_id: number;
  user_email: string;
  user_role: string;
  question: string;
  sql_query: string;
  tables_used: string[];
  status: 'success' | 'error';
  error_message: string | null;
  row_count: number | null;
  duration_ms: number | null;
  created_at: string;
}

interface AuditPage {
  total: number;
  entries: AuditEntry[];
}

interface LineageRecord {
  table_name: string;
  last_accessed: string | null;
  access_count: number;
  accessing_users: string[];
}

interface AuditStats {
  total_queries: number;
  success_count: number;
  error_count: number;
  unique_users: number;
  avg_duration_ms: number;
  queries_today: number;
  tables_accessed: number;
  most_queried_table: string | null;
}

/* ─────────────────────────── helpers ─────────────────────────────────────── */

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function fmtDuration(ms: number | null) {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ─────────────────────────── Stats row ──────────────────────────────────── */

function StatsRow({ stats }: { stats: AuditStats }) {
  const cards = [
    { label: 'Total Queries', value: stats.total_queries.toLocaleString(), icon: ClipboardList, color: 'blue' },
    { label: 'Today',         value: stats.queries_today.toLocaleString(),  icon: Calendar,     color: 'violet' },
    { label: 'Errors',        value: stats.error_count.toLocaleString(),    icon: XCircle,      color: stats.error_count > 0 ? 'red' : 'slate' },
    { label: 'Active Users',  value: stats.unique_users.toLocaleString(),   icon: User,         color: 'emerald' },
    { label: 'Tables Used',   value: stats.tables_accessed.toLocaleString(),icon: Database,     color: 'amber' },
    { label: 'Avg Duration',  value: fmtDuration(stats.avg_duration_ms),    icon: Clock,        color: 'slate' },
  ];
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    violet: 'bg-violet-50 text-violet-700',
    red: 'bg-red-50 text-red-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-50 text-slate-600',
  };
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
      {cards.map(c => (
        <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-3 text-center">
          <div className={`inline-flex p-1.5 rounded-lg mb-1 ${colorMap[c.color]}`}>
            <c.icon className="size-3.5" />
          </div>
          <p className="text-lg font-black text-slate-900">{c.value}</p>
          <p className="text-[11px] text-slate-400 font-medium">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── Audit log tab ──────────────────────────────── */

const PAGE_SIZE = 25;

function AuditLogTab() {
  const [page, setPage]         = useState<AuditPage | null>(null);
  const [loading, setLoading]   = useState(true);
  const [offset, setOffset]     = useState(0);
  const [search, setSearch]     = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTable, setFilterTable]   = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (filterStatus) params.set('status', filterStatus);
      if (filterTable)  params.set('table_name', filterTable);
      const data = await api.get<AuditPage>(`/audit/logs?${params}`);
      setPage(data);
    } catch { /* silently fail */ }
    setLoading(false);
  }, [offset, filterStatus, filterTable]);

  useEffect(() => { load(); }, [load]);

  const total   = page?.total ?? 0;
  const entries = page?.entries ?? [];
  const filtered = search
    ? entries.filter(e =>
        e.question?.toLowerCase().includes(search.toLowerCase()) ||
        e.user_email?.toLowerCase().includes(search.toLowerCase()) ||
        e.tables_used.some(t => t.includes(search.toLowerCase()))
      )
    : entries;

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search question, user, table…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-blue-400"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value); setOffset(0); }}
          className="px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-blue-400"
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
        </select>
        <input
          type="text"
          placeholder="Filter by table…"
          value={filterTable}
          onChange={e => { setFilterTable(e.target.value); setOffset(0); }}
          className="px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-blue-400 w-36"
        />
        <button onClick={load} className="p-2 text-slate-400 hover:text-blue-600 rounded-xl transition-colors border border-slate-200">
          <RefreshCw className="size-4" />
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-7 animate-spin text-slate-300" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 text-slate-400">
          No queries logged yet — run an AI query to see it here.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filtered.map((e, i) => (
            <div key={e.id} className={i > 0 ? 'border-t border-slate-100' : ''}>
              <div
                className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
              >
                {/* Status icon */}
                <div className="mt-0.5 shrink-0">
                  {e.status === 'success'
                    ? <CheckCircle2 className="size-4 text-emerald-500" />
                    : <XCircle className="size-4 text-red-500" />
                  }
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{e.question || '(no question)'}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-slate-400">{fmtDate(e.created_at)}</span>
                    <span className="text-xs text-slate-500 font-medium">{e.user_email || `user #${e.user_id}`}</span>
                    {e.tables_used.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {e.tables_used.map(t => (
                          <span key={t} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[11px] font-mono">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {e.row_count !== null && (
                      <span className="text-xs text-slate-400">{e.row_count} rows</span>
                    )}
                    <span className="text-xs text-slate-400">{fmtDuration(e.duration_ms)}</span>
                  </div>
                </div>

                {expandedId === e.id ? <ChevronUp className="size-4 text-slate-300 shrink-0" /> : <ChevronDown className="size-4 text-slate-300 shrink-0" />}
              </div>

              {expandedId === e.id && (
                <div className="px-4 pb-4 bg-slate-50 space-y-2 border-t border-slate-100">
                  {e.sql_query && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 mb-1">SQL</p>
                      <pre className="text-xs font-mono bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {e.sql_query}
                      </pre>
                    </div>
                  )}
                  {e.error_message && (
                    <div className="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                      <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                      {e.error_message}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400">
                    Entry #{e.id} · role: {e.user_role || 'unknown'}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="p-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="p-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Lineage tab ─────────────────────────────────── */

function LineageTab() {
  const [records, setRecords] = useState<LineageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.get<LineageRecord[]>('/audit/lineage')
      .then(data => { setRecords(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const maxCount = Math.max(...records.map(r => r.access_count), 1);

  if (loading) return (
    <div className="flex justify-center py-12">
      <Loader2 className="size-7 animate-spin text-slate-300" />
    </div>
  );

  if (records.length === 0) return (
    <div className="text-center py-12 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 text-slate-400">
      No lineage data yet — tables are tracked automatically once queries run.
    </div>
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400 mb-3">
        Sorted by query frequency. Expand a row to see which users accessed it.
      </p>
      {records.map(r => (
        <div key={r.table_name} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div
            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
            onClick={() => setExpanded(expanded === r.table_name ? null : r.table_name)}
          >
            <Database className="size-4 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <span className="font-mono font-bold text-sm text-slate-800">{r.table_name}</span>
                <span className="text-xs text-slate-400">
                  {r.access_count} {r.access_count === 1 ? 'query' : 'queries'}
                </span>
                {r.last_accessed && (
                  <span className="text-xs text-slate-400">last: {fmtDate(r.last_accessed)}</span>
                )}
              </div>
              {/* Heat bar */}
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-400 rounded-full transition-all"
                  style={{ width: `${Math.round((r.access_count / maxCount) * 100)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                {r.accessing_users.length} user{r.accessing_users.length !== 1 ? 's' : ''}
              </span>
              {expanded === r.table_name ? <ChevronUp className="size-4 text-slate-300" /> : <ChevronDown className="size-4 text-slate-300" />}
            </div>
          </div>

          {expanded === r.table_name && (
            <div className="px-4 pb-3 border-t border-slate-100 bg-slate-50">
              <p className="text-xs font-semibold text-slate-500 mt-2 mb-1">Users who queried this table</p>
              {r.accessing_users.length === 0 ? (
                <p className="text-xs text-slate-400">No user emails recorded.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {r.accessing_users.map(u => (
                    <span key={u} className="flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700">
                      <User className="size-2.5" /> {u}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── main component ──────────────────────────────── */

type Tab = 'log' | 'lineage';

export function AuditTrail() {
  const [tab, setTab]       = useState<Tab>('log');
  const [stats, setStats]   = useState<AuditStats | null>(null);

  useEffect(() => {
    api.get<AuditStats>('/audit/stats')
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-3 bg-slate-100 rounded-2xl">
          <ClipboardList className="size-7 text-slate-600" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-slate-900">Audit Trail & Data Lineage</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Every AI query logged with its SQL, tables, duration and user.
          </p>
        </div>
      </div>

      {/* Stats */}
      {stats && <StatsRow stats={stats} />}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {([
          { id: 'log',     label: 'Audit Log',    icon: ClipboardList },
          { id: 'lineage', label: 'Data Lineage',  icon: GitBranch },
        ] as { id: Tab; label: string; icon: any }[]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'log'     && <AuditLogTab />}
      {tab === 'lineage' && <LineageTab />}
    </div>
  );
}
