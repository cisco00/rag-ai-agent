import { useState, useEffect, useRef, useCallback } from 'react';
import { useSessionStorage } from '../../hooks/useSessionStorage';
import {
  Radio, Play, Pause, RotateCcw, Activity, Wifi, WifiOff,
  AlertTriangle, Download, Snowflake, Zap, Bell, BellOff,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '../../lib/api';

interface RealTimeStreamingProps { apiKey: string }

interface DataPoint {
  timestamp: string;
  isAnomaly?: boolean;
  [key: string]: any;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
const MAX_WS_RETRIES = 5;
const FLUSH_MS = 80; // batch-flush interval — one React render per 80 ms max

function zScoreAnomaly(val: number, history: number[], threshold: number): boolean {
  if (history.length < 5) return false;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const std  = Math.sqrt(history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length);
  return std > 0 && Math.abs((val - mean) / std) > threshold;
}

export function RealTimeStreaming({ apiKey }: RealTimeStreamingProps) {
  // ── Persisted config (small scalars — sessionStorage fine) ──────────────
  const [selectedTable,  setSelectedTable]  = useSessionStorage('rt_table', '');
  const [selectedCols,   setSelectedCols]   = useSessionStorage<string[]>('rt_cols', []);
  const [maxPoints,      setMaxPoints]      = useSessionStorage('rt_maxPts', 60);
  const [anomalyEnabled, setAnomalyEnabled] = useSessionStorage('rt_anomaly', false);
  const [anomalyThresh,  setAnomalyThresh]  = useSessionStorage('rt_thresh', 3.0);
  const [alertEnabled,   setAlertEnabled]   = useSessionStorage('rt_alertEnabled', false);
  const [alertCol,       setAlertCol]       = useSessionStorage('rt_alertCol', '');
  const [alertVal,       setAlertVal]       = useSessionStorage('rt_alertVal', 0);

  // ── Volatile UI state ────────────────────────────────────────────────────
  const [dataPoints,   setDataPoints]   = useState<DataPoint[]>([]);
  const [isStreaming,  setIsStreaming]  = useState(false);
  const [isFrozen,     setIsFrozen]     = useState(false);
  const [connStatus,   setConnStatus]   = useState<'idle'|'connecting'|'live'|'error'>('idle');
  const [tables,       setTables]       = useState<string[]>([]);
  const [availCols,    setAvailCols]    = useState<string[]>([]);
  const [anomalyCount, setAnomalyCount] = useState(0);
  const [retryCount,   setRetryCount]   = useState(0);
  const [rowsPerSec,   setRowsPerSec]   = useState(0);
  const [frozenCount,  setFrozenCount]  = useState(0);
  const [alertFired,   setAlertFired]   = useState(false);
  const [alertMsg,     setAlertMsg]     = useState('');

  // ── Refs (read inside callbacks, never trigger re-renders) ──────────────
  const wsRef         = useRef<WebSocket | null>(null);
  const retryTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef    = useRef<DataPoint[]>([]); // rows waiting for the next flush
  const frozenBufRef  = useRef<DataPoint[]>([]); // rows buffered while frozen
  const isFrozenRef   = useRef(false);
  const rowsThisSec   = useRef(0);

  // Single ref for all config values — avoids stale closures in callbacks
  const configRef = useRef({
    selectedCols, maxPoints, anomalyEnabled, anomalyThresh,
    alertEnabled, alertCol, alertVal,
  });
  useEffect(() => {
    configRef.current = {
      selectedCols, maxPoints, anomalyEnabled, anomalyThresh,
      alertEnabled, alertCol, alertVal,
    };
  }, [selectedCols, maxPoints, anomalyEnabled, anomalyThresh, alertEnabled, alertCol, alertVal]);

  useEffect(() => { isFrozenRef.current = isFrozen; }, [isFrozen]);

  // ── Timers: rows/sec ticker + batch flush ────────────────────────────────
  useEffect(() => {
    // Rows/sec: count how many rows arrived in the last second
    const secTick = setInterval(() => {
      setRowsPerSec(rowsThisSec.current);
      rowsThisSec.current = 0;
    }, 1000);

    // Batch flush: drain pendingRef into React state at most every FLUSH_MS
    const flushTick = setInterval(() => {
      if (!pendingRef.current.length) return;
      const batch = pendingRef.current.splice(0);
      const { maxPoints, anomalyEnabled, anomalyThresh, selectedCols } = configRef.current;

      setDataPoints(prev => {
        let next = [...prev];
        for (const pt of batch) {
          const primary = selectedCols[0];
          if (anomalyEnabled && primary && typeof pt[primary] === 'number') {
            const history = next.map(p => p[primary]).filter((v): v is number => typeof v === 'number');
            if (zScoreAnomaly(pt[primary] as number, history, anomalyThresh)) {
              pt.isAnomaly = true;
              setAnomalyCount(c => c + 1);
            }
          }
          next.push(pt);
        }
        return next.slice(-maxPoints);
      });
    }, FLUSH_MS);

    return () => { clearInterval(secTick); clearInterval(flushTick); };
  }, []);

  // ── Fetch tables ─────────────────────────────────────────────────────────
  useEffect(() => {
    api.get<{ tables: string[] }>('/tables')
      .then(r => {
        setTables(r?.tables ?? []);
        if (!selectedTable && r?.tables?.length) setSelectedTable(r.tables[0]);
      })
      .catch(() => {});
  }, []);

  // ── Fetch columns on table change ────────────────────────────────────────
  useEffect(() => {
    if (!selectedTable) return;
    api.get<any>(`/tables/${selectedTable}/preview?limit=1`)
      .then(d => {
        const cols: string[] = d?.columns?.map((c: any) => c.name) ?? [];
        setAvailCols(cols);
        if (selectedCols.length === 0) setSelectedCols(cols.slice(0, 3));
        if (!alertCol && cols.length) setAlertCol(cols[0]);
      })
      .catch(() => {});
  }, [selectedTable]);

  // ── Ingest a raw row (called on every WS message) ────────────────────────
  const ingestRow = useCallback((raw: Record<string, any>) => {
    if (raw._ping) return; // server heartbeat — ignore

    const { selectedCols, alertEnabled, alertCol, alertVal } = configRef.current;
    if (!selectedCols.length) return;

    const point: DataPoint = { timestamp: new Date().toLocaleTimeString('en-GB') };
    for (const col of selectedCols) {
      if (raw[col] !== undefined) {
        const v = raw[col];
        point[col] = typeof v === 'string' ? (isNaN(Number(v)) ? v : Number(v)) : v;
      }
    }
    if (Object.keys(point).length <= 1) return;

    rowsThisSec.current++;

    // Alert threshold check (runs on every row, cheap)
    if (alertEnabled && alertCol && typeof point[alertCol] === 'number') {
      if ((point[alertCol] as number) >= alertVal) {
        setAlertFired(true);
        setAlertMsg(`${alertCol} = ${(point[alertCol] as number).toLocaleString()} ≥ ${alertVal}`);
      }
    }

    // Freeze mode: buffer rows without touching dataPoints state
    if (isFrozenRef.current) {
      frozenBufRef.current.push(point);
      setFrozenCount(c => c + 1);
      return;
    }

    // Normal path: push to pending batch (flushed by setInterval above)
    pendingRef.current.push(point);
  }, []);

  // ── WebSocket connect / reconnect ─────────────────────────────────────────
  const connect = useCallback((table: string, retries = 0) => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }

    setConnStatus('connecting');
    const ws = new WebSocket(api.wsUrl(`/ws/stream/${table}`));
    wsRef.current = ws;

    const openTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) ws.close();
    }, 3000);

    ws.onopen  = () => { clearTimeout(openTimer); setConnStatus('live'); setRetryCount(0); };
    ws.onerror = () => clearTimeout(openTimer);
    ws.onmessage = ev => { try { ingestRow(JSON.parse(ev.data)); } catch { /* bad frame */ } };

    ws.onclose = () => {
      clearTimeout(openTimer);
      wsRef.current = null;
      setIsStreaming(streaming => {
        if (!streaming) return false;
        if (retries < MAX_WS_RETRIES) {
          const delay = Math.min(1000 * 2 ** retries, 15000);
          setConnStatus('connecting');
          setRetryCount(retries + 1);
          retryTimer.current = setTimeout(() => connect(table, retries + 1), delay);
        } else {
          setConnStatus('error');
        }
        return streaming;
      });
    };
  }, [ingestRow]);

  // ── Start / stop effect ───────────────────────────────────────────────────
  useEffect(() => {
    if (isStreaming && selectedTable) {
      connect(selectedTable, 0);
    } else {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
      if (!isStreaming) setConnStatus('idle');
    }
    return () => {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    };
  }, [isStreaming, selectedTable]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleCol = (col: string) =>
    setSelectedCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);

  const reset = () => {
    setIsStreaming(false);
    setIsFrozen(false);
    isFrozenRef.current = false;
    setDataPoints([]);
    pendingRef.current = [];
    frozenBufRef.current = [];
    setAnomalyCount(0);
    setRetryCount(0);
    setFrozenCount(0);
    setRowsPerSec(0);
    setAlertFired(false);
    setConnStatus('idle');
  };

  const freeze = () => {
    setIsFrozen(true);
    isFrozenRef.current = true;
    setFrozenCount(0);
    frozenBufRef.current = [];
  };

  const catchUp = () => {
    // Flush frozen buffer into pending batch so the next flush tick picks it up
    pendingRef.current.push(...frozenBufRef.current.splice(0));
    setFrozenCount(0);
    setIsFrozen(false);
    isFrozenRef.current = false;
  };

  const exportCSV = () => {
    if (!dataPoints.length) return;
    const cols = ['timestamp', ...selectedCols];
    const header = cols.join(',');
    const rows = dataPoints.map(pt =>
      cols.map(c => {
        const v = pt[c];
        return v === undefined || v === null ? '' : typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : String(v);
      }).join(',')
    );
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTable}_stream_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Derived display values ────────────────────────────────────────────────
  const stats = (() => {
    if (!dataPoints.length || !selectedCols.length) return null;
    const col = selectedCols[0];
    const vals = dataPoints.map(d => d[col]).filter((v): v is number => typeof v === 'number');
    if (!vals.length) return null;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { current: vals.at(-1)!, avg, min: Math.min(...vals), max: Math.max(...vals) };
  })();

  const latestAnomaly = anomalyEnabled
    ? [...dataPoints].reverse().find(p => p.isAnomaly)
    : undefined;

  const statusColors = {
    idle: 'bg-gray-300',
    connecting: 'bg-yellow-400 animate-pulse',
    live: isFrozen ? 'bg-blue-500' : 'bg-green-500 animate-pulse',
    error: 'bg-red-500',
  };
  const statusLabel =
    connStatus === 'idle'       ? 'Idle' :
    connStatus === 'error'      ? 'Failed — restart to retry' :
    connStatus === 'connecting' ? (retryCount > 0 ? `Reconnecting (${retryCount}/${MAX_WS_RETRIES})…` : 'Connecting…') :
    isFrozen                    ? `Frozen · ${frozenCount} buffered` :
    'Live';

  return (
    <div className="p-8">
      {/* ── Header ── */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Radio className="size-8 text-red-600" />
          <h1 className="text-3xl font-bold text-gray-900">Real-Time Data Streaming</h1>
          <div className="ml-auto flex items-center gap-3">
            {connStatus === 'live' && rowsPerSec > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                <Zap className="size-3" />{rowsPerSec} rows/s
              </span>
            )}
            <span className={`w-3 h-3 rounded-full ${statusColors[connStatus]}`} />
            <span className="text-sm font-medium text-gray-600">{statusLabel}</span>
          </div>
        </div>
        <p className="text-gray-500 text-sm">
          Adaptive poll rate · batch flush every {FLUSH_MS} ms · freeze &amp; catch-up · CSV export · threshold alerts
        </p>
      </div>

      {/* ── Alert banner ── */}
      {alertFired && (
        <div className="mb-5 flex items-center justify-between gap-3 p-4 bg-amber-50 border border-amber-300 rounded-xl">
          <div className="flex items-center gap-3">
            <Bell className="size-5 text-amber-600 shrink-0 animate-bounce" />
            <div>
              <p className="font-semibold text-amber-900 text-sm">Alert threshold crossed</p>
              <p className="text-xs text-amber-700 font-mono">{alertMsg}</p>
            </div>
          </div>
          <button onClick={() => setAlertFired(false)}
            className="text-xs text-amber-600 hover:text-amber-800 font-medium shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {/* ── Frozen catch-up banner ── */}
      {isFrozen && frozenCount > 0 && (
        <div className="mb-5 flex items-center justify-between gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-center gap-3">
            <Snowflake className="size-5 text-blue-500 shrink-0" />
            <p className="text-sm text-blue-800">
              Display frozen — <strong>{frozenCount.toLocaleString()} rows buffered</strong> and waiting
            </p>
          </div>
          <button onClick={catchUp}
            className="text-sm font-semibold text-blue-700 hover:text-blue-900 bg-blue-100 hover:bg-blue-200 px-3 py-1.5 rounded-lg transition-colors shrink-0">
            Catch up →
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* ── Config panel ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h3 className="font-bold text-gray-900">Configuration</h3>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Data Source</label>
            <select value={selectedTable}
              onChange={e => { setSelectedTable(e.target.value); setDataPoints([]); }}
              disabled={isStreaming}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 text-sm">
              {!tables.length && <option value="">Loading…</option>}
              {tables.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Columns to stream</label>
            {!availCols.length
              ? <p className="text-xs text-gray-400 italic">Select a table first</p>
              : (
                <div className="border border-gray-200 rounded-lg p-2 space-y-1 max-h-44 overflow-y-auto">
                  {availCols.map(col => (
                    <label key={col} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                      <input type="checkbox" checked={selectedCols.includes(col)}
                        onChange={() => toggleCol(col)} disabled={isStreaming}
                        className="accent-blue-600" />
                      <span className="font-mono text-gray-700 truncate">{col}</span>
                    </label>
                  ))}
                </div>
              )}
            <p className="text-xs text-gray-400 mt-1">{selectedCols.length} selected</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Window <span className="text-blue-600 font-semibold">({maxPoints} pts)</span>
            </label>
            <input type="range" min="20" max="300" step="10" value={maxPoints}
              onChange={e => setMaxPoints(+e.target.value)} disabled={isStreaming}
              className="w-full accent-blue-600" />
          </div>

          {/* ── Anomaly detection ── */}
          <div className="pt-4 border-t border-gray-100 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={anomalyEnabled}
                onChange={e => setAnomalyEnabled(e.target.checked)}
                className="accent-red-600 size-4" />
              <span className="text-sm font-bold text-gray-900">Z-score Anomaly</span>
            </label>
            {anomalyEnabled && (
              <div className="pl-6 space-y-2">
                <label className="block text-xs font-medium text-gray-700">
                  Threshold: <strong className="text-red-600">{anomalyThresh.toFixed(1)}σ</strong>
                </label>
                <input type="range" min="1" max="5" step="0.1" value={anomalyThresh}
                  onChange={e => setAnomalyThresh(+e.target.value)}
                  className="w-full accent-red-600" />
                {anomalyCount > 0 && (
                  <p className="text-xs font-semibold text-red-600">⚠ {anomalyCount} detected</p>
                )}
              </div>
            )}
          </div>

          {/* ── Threshold alert ── */}
          <div className="pt-3 border-t border-gray-100 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={alertEnabled}
                onChange={e => setAlertEnabled(e.target.checked)}
                className="accent-amber-500 size-4" />
              <span className="text-sm font-bold text-gray-900">Threshold Alert</span>
            </label>
            {alertEnabled && (
              <div className="pl-6 space-y-2">
                <select value={alertCol} onChange={e => setAlertCol(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-mono">
                  {availCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">≥</span>
                  <input type="number" value={alertVal}
                    onChange={e => setAlertVal(+e.target.value)}
                    className="flex-1 px-2 py-1 border border-gray-300 rounded-lg text-xs font-mono" />
                </div>
                <p className="text-xs text-gray-400">Alert when <span className="font-mono">{alertCol}</span> ≥ {alertVal}</p>
              </div>
            )}
          </div>

          {/* ── Controls ── */}
          <div className="flex gap-2 pt-1">
            {!isStreaming ? (
              <button onClick={() => setIsStreaming(true)}
                disabled={!selectedTable || !selectedCols.length}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium text-sm">
                <Play className="size-4" /> Start
              </button>
            ) : (
              <button onClick={() => setIsStreaming(false)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium text-sm">
                <Pause className="size-4" /> Stop
              </button>
            )}
            <button onClick={reset} title="Clear and reset"
              className="px-3 py-2.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
              <RotateCcw className="size-4" />
            </button>
          </div>

          {/* Freeze / Export buttons — only when streaming */}
          {isStreaming && (
            <div className="flex gap-2">
              <button onClick={isFrozen ? catchUp : freeze}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  isFrozen
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                }`}>
                <Snowflake className="size-3.5" />
                {isFrozen ? `Catch up (${frozenCount})` : 'Freeze'}
              </button>
              <button onClick={exportCSV} disabled={!dataPoints.length}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100 disabled:opacity-40">
                <Download className="size-3.5" /> CSV
              </button>
            </div>
          )}

          {!isStreaming && dataPoints.length > 0 && (
            <button onClick={exportCSV}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100">
              <Download className="size-3.5" /> Export {dataPoints.length} rows as CSV
            </button>
          )}

          {/* Status indicators */}
          {connStatus === 'live' && !isFrozen && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <Activity className="size-4 text-green-600 animate-pulse" />
              <span className="text-xs font-medium text-green-700">Live · adaptive poll</span>
              <Wifi className="size-3 text-green-500 ml-auto" />
            </div>
          )}
          {connStatus === 'error' && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <WifiOff className="size-4 text-red-500" />
              <span className="text-xs font-medium text-red-700">Failed after {MAX_WS_RETRIES} retries</span>
            </div>
          )}
          {connStatus === 'connecting' && retryCount > 0 && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <Activity className="size-4 text-yellow-600 animate-spin" />
              <span className="text-xs font-medium text-yellow-700">Retry {retryCount}/{MAX_WS_RETRIES}</span>
            </div>
          )}

          <div className="p-3 bg-gray-50 border border-gray-100 rounded-lg text-xs text-gray-500 space-y-0.5">
            <p><strong>Table:</strong> {selectedTable || '—'}</p>
            <p><strong>Displayed:</strong> {dataPoints.length} / {maxPoints}</p>
            {connStatus === 'live' && (
              <p><strong>Throughput:</strong> {rowsPerSec} rows/s</p>
            )}
          </div>
        </div>

        {/* ── Visualisation panel ── */}
        <div className="lg:col-span-3 space-y-5">
          {/* Stats tiles */}
          {stats && (
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Current', value: stats.current, color: 'text-blue-600' },
                { label: 'Average', value: stats.avg,     color: 'text-purple-600' },
                { label: 'Min',     value: stats.min,     color: 'text-green-600' },
                { label: 'Max',     value: stats.max,     color: 'text-red-600' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-400 mb-1">
                    {s.label} · <span className="font-mono">{selectedCols[0]}</span>
                  </p>
                  <p className={`text-2xl font-bold ${s.color}`}>
                    {s.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Anomaly banner */}
          {latestAnomaly && (
            <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
              <AlertTriangle className="size-5 text-red-500 shrink-0" />
              <span>
                <strong>Anomaly</strong> at {latestAnomaly.timestamp} — {selectedCols[0]}: <strong>{latestAnomaly[selectedCols[0]]}</strong>
              </span>
            </div>
          )}

          {/* Chart */}
          <div className={`bg-white rounded-xl border p-6 transition-colors ${isFrozen ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">
                {isFrozen && <Snowflake className="inline size-4 text-blue-500 mr-1.5 mb-0.5" />}
                Live Stream — <span className="text-blue-600 font-mono text-sm">{selectedTable}</span>
              </h3>
              <div className="flex items-center gap-3">
                {connStatus === 'live' && rowsPerSec > 0 && (
                  <span className="text-xs text-emerald-600 font-mono font-semibold">
                    {rowsPerSec} r/s
                  </span>
                )}
                <span className="text-xs text-gray-400">{dataPoints.length} pts</span>
              </div>
            </div>

            {dataPoints.length > 0 ? (
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={dataPoints} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="timestamp" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v: any, name: string) => [
                      typeof v === 'number'
                        ? v.toLocaleString(undefined, { maximumFractionDigits: 3 })
                        : String(v),
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {selectedCols.map((col, i) => (
                    <Line key={col} type="monotone" dataKey={col}
                      stroke={COLORS[i % COLORS.length]} strokeWidth={2}
                      dot={anomalyEnabled && i === 0
                        ? (props: any) => {
                            const { cx, cy, payload } = props;
                            if (!payload?.isAnomaly) return <g key={`${cx}-${cy}`} />;
                            return (
                              <g key={`a-${cx}-${cy}`}>
                                <circle cx={cx} cy={cy} r={8} fill="#ef4444" fillOpacity={0.15} />
                                <circle cx={cx} cy={cy} r={4} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />
                              </g>
                            );
                          }
                        : false}
                      name={col + (anomalyEnabled && i === 0 ? ' ⚠' : '')}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-80 text-gray-400">
                <div className="text-center">
                  <Radio className="size-14 mx-auto mb-3 text-gray-300" />
                  {isStreaming
                    ? <p>Waiting for data<span className="animate-pulse">…</span></p>
                    : <p>Select a table and columns, then click <strong>Start</strong></p>}
                </div>
              </div>
            )}
          </div>

          {/* Recent rows table */}
          {dataPoints.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900">Last 10 rows</h3>
                <button onClick={exportCSV}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium">
                  <Download className="size-3.5" /> Export CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                      {anomalyEnabled && <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">⚠</th>}
                      {selectedCols.map(col => (
                        <th key={col} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase font-mono">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...dataPoints].slice(-10).reverse().map((pt, i) => (
                      <tr key={i} className={pt.isAnomaly ? 'bg-red-50' : 'hover:bg-gray-50'}>
                        <td className="px-3 py-2 font-mono text-gray-500 text-xs">{pt.timestamp}</td>
                        {anomalyEnabled && (
                          <td className="px-3 py-2">
                            {pt.isAnomaly && <AlertTriangle className="size-4 text-red-500" />}
                          </td>
                        )}
                        {selectedCols.map(col => (
                          <td key={col} className="px-3 py-2 font-semibold text-blue-700">
                            {typeof pt[col] === 'number'
                              ? pt[col].toLocaleString(undefined, { maximumFractionDigits: 3 })
                              : (pt[col] ?? '—')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
