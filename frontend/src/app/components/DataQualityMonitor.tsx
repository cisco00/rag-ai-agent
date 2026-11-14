import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, Clock, Database, Loader2, Info,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ColumnProfile {
  name: string;
  dtype: string;
  null_pct: number | null;
  mean: number | null;
  stddev: number | null;
  min: number | null;
  max: number | null;
  distinct: number | null;
}

interface DriftAlert {
  type: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  column?: string;
}

interface SnapshotResult {
  snapshot_id: number;
  table_name: string;
  created_at: string;
  profile: { row_count: number; columns: any[] };
  drift_alerts: DriftAlert[];
  has_baseline: boolean;
}

interface HistoryEntry {
  snapshot_id: number;
  created_at: string;
  row_count: number | null;
  columns: ColumnProfile[];
}

interface MonitoredTable {
  table_name: string;
  last_snapshot: string;
  snapshot_count: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function NullBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-400 text-xs">—</span>;
  const color = pct > 0.3 ? 'bg-red-400' : pct > 0.1 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`${color} h-full rounded-full`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right">{(pct * 100).toFixed(1)}%</span>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === 'high'
    ? 'bg-red-100 text-red-700 border-red-200'
    : severity === 'medium'
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-blue-100 text-blue-700 border-blue-200';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cls} uppercase tracking-wide`}>
      {severity}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function DataQualityMonitor({ apiKey: _apiKey }: { apiKey: string }) {
  const [tables, setTables] = useState<string[]>([]);
  const [monitored, setMonitored] = useState<MonitoredTable[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedCol, setExpandedCol] = useState<string | null>(null);

  // Load available tables + monitored tables
  const loadTables = useCallback(async () => {
    try {
      const [tablesResp, monitoredResp] = await Promise.all([
        api.get<{ tables: string[] }>('/tables'),
        api.get<{ tables: MonitoredTable[] }>('/data-quality/tables').catch(() => ({ tables: [] })),
      ]);
      setTables(tablesResp.tables ?? []);
      setMonitored(monitoredResp.tables ?? []);
      if (!selectedTable && tablesResp.tables?.length) {
        setSelectedTable(tablesResp.tables[0]);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load tables');
    }
  }, [selectedTable]);

  useEffect(() => { loadTables(); }, []);

  // Load history when table changes
  const loadHistory = useCallback(async (table: string) => {
    if (!table) return;
    setHistoryLoading(true);
    try {
      const r = await api.get<{ history: HistoryEntry[] }>(`/data-quality/history/${table}?limit=10`);
      setHistory((r.history ?? []).reverse()); // oldest first for chart
    } catch { setHistory([]); }
    finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => {
    if (selectedTable) {
      setSnapshot(null);
      loadHistory(selectedTable);
    }
  }, [selectedTable]);

  const takeSnapshot = async () => {
    if (!selectedTable) return;
    setSnapshotting(true);
    setError('');
    try {
      const r = await api.post<SnapshotResult>(`/data-quality/snapshot/${selectedTable}`, {});
      setSnapshot(r);
      await loadHistory(selectedTable);
      await loadTables(); // refresh monitored list
    } catch (e: any) {
      setError(e?.message ?? 'Snapshot failed');
    } finally {
      setSnapshotting(false);
    }
  };

  const monitoredInfo = monitored.find(m => m.table_name === selectedTable);
  const columns: ColumnProfile[] = (snapshot?.profile?.columns ?? []).map((c: any) => ({
    name: c.name,
    dtype: c.dtype ?? c.type ?? '?',
    null_pct: c.null_pct ?? null,
    mean: c.mean ?? null,
    stddev: c.std ?? c.stddev ?? null,
    min: c.min ?? null,
    max: c.max ?? null,
    distinct: c.distinct_count ?? null,
  }));

  // Build row-count trend for the history chart
  const rowTrend = history.map(h => ({
    ts: formatTs(h.created_at),
    rows: h.row_count,
  }));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
            <ShieldCheck className="size-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Data Quality Monitor</h1>
            <p className="text-sm text-gray-500">Profile tables, detect drift, track health over time</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Table</label>
            <select
              value={selectedTable}
              onChange={e => setSelectedTable(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
            >
              {tables.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <button
            onClick={takeSnapshot}
            disabled={snapshotting || !selectedTable}
            className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white rounded-xl font-semibold text-sm hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {snapshotting
              ? <><Loader2 className="size-4 animate-spin" /> Profiling…</>
              : <><RefreshCw className="size-4" /> Take Snapshot</>
            }
          </button>

          {monitoredInfo && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock className="size-3.5" />
              Last: {formatTs(monitoredInfo.last_snapshot)}
              <span className="text-gray-300">·</span>
              {monitoredInfo.snapshot_count} snapshot{monitoredInfo.snapshot_count !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <XCircle className="size-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* Drift Alerts */}
      {snapshot && (
        <div className="space-y-4">
          {snapshot.drift_alerts.length > 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="size-5 text-amber-500" />
                <h2 className="font-semibold text-gray-800">
                  {snapshot.drift_alerts.length} Drift Alert{snapshot.drift_alerts.length !== 1 ? 's' : ''}
                </h2>
                <span className="ml-auto text-xs text-gray-400">vs. previous snapshot</span>
              </div>
              <div className="space-y-2">
                {snapshot.drift_alerts.map((a, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                    <SeverityBadge severity={a.severity} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700">{a.message}</p>
                      {a.column && (
                        <p className="text-xs text-gray-400 mt-0.5">Column: <code className="font-mono bg-gray-100 px-1 rounded">{a.column}</code></p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : snapshot.has_baseline ? (
            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
              <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
              <p className="text-sm text-emerald-700 font-medium">No significant drift detected vs. previous snapshot</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl">
              <Info className="size-5 text-blue-500 shrink-0" />
              <p className="text-sm text-blue-700">First snapshot taken — drift detection starts with the next one</p>
            </div>
          )}

          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Row Count', value: snapshot.profile.row_count?.toLocaleString() ?? '—' },
              { label: 'Columns', value: columns.length },
              { label: 'Null Issues', value: columns.filter(c => (c.null_pct ?? 0) > 0.1).length },
              { label: 'Drift Alerts', value: snapshot.drift_alerts.length },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Column health cards */}
          {columns.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Database className="size-4 text-teal-500" />
                Column Health
              </h2>
              <div className="space-y-1">
                {columns.map(col => {
                  const isExpanded = expandedCol === col.name;
                  const hasIssue = (col.null_pct ?? 0) > 0.1;
                  return (
                    <div key={col.name} className="border border-gray-100 rounded-xl overflow-hidden">
                      <button
                        onClick={() => setExpandedCol(isExpanded ? null : col.name)}
                        className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className={`size-2 rounded-full shrink-0 ${hasIssue ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                        <span className="font-mono text-sm text-gray-800 font-medium flex-1">{col.name}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{col.dtype}</span>
                        <div className="w-32 hidden sm:block">
                          <NullBar pct={col.null_pct} />
                        </div>
                        {isExpanded ? <ChevronUp className="size-4 text-gray-400 shrink-0" /> : <ChevronDown className="size-4 text-gray-400 shrink-0" />}
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 bg-gray-50 grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: 'Null %', value: col.null_pct !== null ? `${(col.null_pct * 100).toFixed(1)}%` : '—' },
                            { label: 'Distinct', value: col.distinct?.toLocaleString() ?? '—' },
                            { label: 'Mean', value: col.mean !== null ? col.mean.toFixed(3) : '—' },
                            { label: 'Std Dev', value: col.stddev !== null ? col.stddev.toFixed(3) : '—' },
                            { label: 'Min', value: col.min !== null ? String(col.min) : '—' },
                            { label: 'Max', value: col.max !== null ? String(col.max) : '—' },
                          ].map(s => (
                            <div key={s.label} className="bg-white rounded-lg p-2.5 border border-gray-100">
                              <p className="text-xs text-gray-400 uppercase tracking-wide">{s.label}</p>
                              <p className="text-sm font-semibold text-gray-800 mt-0.5">{s.value}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* History trend chart */}
      {history.length > 1 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Clock className="size-4 text-teal-500" />
            Row Count History
            {historyLoading && <Loader2 className="size-4 animate-spin text-gray-400 ml-1" />}
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={rowTrend} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="ts" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="rows" stroke="#0d9488" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} name="Row count" />
            </LineChart>
          </ResponsiveContainer>

          {/* Null-rate trend for first numeric column */}
          {history.length > 1 && history[0].columns?.length > 0 && (() => {
            const numericCols = history[0].columns.filter(c => c.null_pct !== null);
            if (!numericCols.length) return null;
            const colName = numericCols[0].name;
            const nullData = history.map(h => ({
              ts: formatTs(h.created_at),
              [colName]: h.columns.find((c: any) => c.name === colName)?.null_pct ?? null,
            }));
            return (
              <div className="mt-5">
                <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Null Rate — {colName}</p>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={nullData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="ts" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={v => `${(v * 100).toFixed(0)}%`} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: any) => `${(v * 100).toFixed(2)}%`} contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey={colName} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })()}
        </div>
      )}

      {/* Monitored tables overview */}
      {monitored.length > 0 && !snapshot && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Monitored Tables</h2>
          <div className="divide-y divide-gray-50">
            {monitored.map(m => (
              <div key={m.table_name} className="flex items-center gap-3 py-3">
                <Database className="size-4 text-teal-500 shrink-0" />
                <button
                  onClick={() => setSelectedTable(m.table_name)}
                  className="font-mono text-sm text-teal-700 hover:underline font-medium"
                >
                  {m.table_name}
                </button>
                <span className="ml-auto text-xs text-gray-400">
                  {m.snapshot_count} snapshot{m.snapshot_count !== 1 ? 's' : ''} · last {formatTs(m.last_snapshot)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!snapshot && monitored.length === 0 && (
        <div className="text-center py-16">
          <ShieldCheck className="size-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-gray-500 font-medium">No snapshots yet</h3>
          <p className="text-sm text-gray-400 mt-1">Select a table above and take your first snapshot to start monitoring.</p>
        </div>
      )}
    </div>
  );
}
