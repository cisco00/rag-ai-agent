import { useState, useEffect, useRef, useCallback } from 'react';
import { useSessionStorage } from '../../hooks/useSessionStorage';
import {
  Radio, Play, Pause, RotateCcw, Activity, Wifi, WifiOff,
  AlertTriangle, Download, Snowflake, Zap, Bell, BellOff,
  Plus, Trash2, TestTube2, X, ChevronDown, Database, Rss,
  CheckCircle2, Settings,
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
  _cdc_op?: string;
  [key: string]: any;
}

interface StreamSource {
  id: number;
  name: string;
  source_type: 'kafka' | 'cdc_kafka';
  connection_details: Record<string, string>;
  created_at: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const COLORS       = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
const MAX_WS_RETRIES = 5;
const FLUSH_MS     = 80;

// ── Utility ───────────────────────────────────────────────────────────────────

function zScoreAnomaly(val: number, history: number[], threshold: number): boolean {
  if (history.length < 5) return false;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const std  = Math.sqrt(history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length);
  return std > 0 && Math.abs((val - mean) / std) > threshold;
}

// CDC op → human label
const CDC_OP: Record<string, string> = { c: 'INSERT', u: 'UPDATE', d: 'DELETE', r: 'READ' };

// ── Add / Edit stream source modal ────────────────────────────────────────────

function StreamSourceModal({
  existing,
  onClose,
  onSaved,
}: {
  existing?: StreamSource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName]   = useState(existing?.name ?? '');
  const [type, setType]   = useState<'kafka' | 'cdc_kafka'>(existing?.source_type ?? 'kafka');
  const [bootstrap, setBootstrap] = useState(existing?.connection_details.bootstrap_servers ?? '');
  const [topic, setTopic] = useState(existing?.connection_details.topic ?? '');
  const [groupId, setGroupId] = useState(existing?.connection_details.group_id ?? '');
  const [protocol, setProtocol] = useState(existing?.connection_details.security_protocol ?? 'PLAINTEXT');
  const [mechanism, setMechanism] = useState(existing?.connection_details.sasl_mechanism ?? '');
  const [saslUser, setSaslUser] = useState(existing?.connection_details.sasl_username ?? '');
  const [saslPass, setSaslPass] = useState('');   // never pre-filled
  const [cdcFormat, setCdcFormat] = useState(existing?.connection_details.cdc_format ?? 'debezium');
  const [autoOffset, setAutoOffset] = useState(existing?.connection_details.auto_offset_reset ?? 'latest');

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [err, setErr] = useState('');

  const payload = () => ({
    name, source_type: type,
    connection_details: {
      bootstrap_servers: bootstrap.trim(),
      topic: topic.trim(),
      group_id: groupId.trim() || undefined,
      security_protocol: protocol,
      ...(mechanism ? { sasl_mechanism: mechanism, sasl_username: saslUser, sasl_password: saslPass } : {}),
      ...(type === 'cdc_kafka' ? { cdc_format: cdcFormat } : {}),
      auto_offset_reset: autoOffset,
    },
  });

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (existing) {
        await api.put(`/stream-sources/${existing.id}`, payload());
      } else {
        await api.post('/stream-sources', payload());
      }
      onSaved(); onClose();
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  const test = async () => {
    if (!existing) { setErr('Save the source first, then test it.'); return; }
    setTesting(true); setTestResult(null);
    try {
      const res = await api.post(`/stream-sources/${existing.id}/test`, {});
      setTestResult({ ok: true, msg: res.topic_exists
        ? `Connected ✓  Topic "${topic}" found.`
        : `Connected ✓  Topic "${topic}" NOT found — check the name.` });
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message || 'Connection failed' });
    } finally { setTesting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 text-lg">{existing ? 'Edit' : 'Add'} Event Stream</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4">
          {err && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{err}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="My Kafka Stream" />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">Type</label>
              <select value={type} onChange={e => setType(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                <option value="kafka">Kafka (raw messages)</option>
                <option value="cdc_kafka">CDC via Kafka (Debezium / Maxwell)</option>
              </select>
            </div>

            {type === 'cdc_kafka' && (
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">CDC Format</label>
                <select value={cdcFormat} onChange={e => setCdcFormat(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                  <option value="debezium">Debezium</option>
                  <option value="maxwell">Maxwell</option>
                  <option value="raw">Raw (passthrough)</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">Bootstrap Servers</label>
            <input value={bootstrap} onChange={e => setBootstrap(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              placeholder="broker1:9092,broker2:9092" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">Topic</label>
              <input value={topic} onChange={e => setTopic(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="orders.events" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">Group ID <span className="font-normal text-gray-400">(optional)</span></label>
              <input value={groupId} onChange={e => setGroupId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="vantage-ai" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">Start From</label>
              <select value={autoOffset} onChange={e => setAutoOffset(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                <option value="latest">Latest (new events only)</option>
                <option value="earliest">Earliest (replay from start)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">Security Protocol</label>
              <select value={protocol} onChange={e => setProtocol(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                <option value="PLAINTEXT">PLAINTEXT</option>
                <option value="SSL">SSL</option>
                <option value="SASL_PLAINTEXT">SASL_PLAINTEXT</option>
                <option value="SASL_SSL">SASL_SSL</option>
              </select>
            </div>
          </div>

          {(protocol === 'SASL_PLAINTEXT' || protocol === 'SASL_SSL') && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">SASL Mechanism</label>
                <select value={mechanism} onChange={e => setMechanism(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                  <option value="PLAIN">PLAIN</option>
                  <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                  <option value="SCRAM-SHA-512">SCRAM-SHA-512</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">Username</label>
                <input value={saslUser} onChange={e => setSaslUser(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">Password</label>
                <input type="password" value={saslPass} onChange={e => setSaslPass(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
            </div>
          )}

          {testResult && (
            <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${testResult.ok ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              {testResult.ok ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertTriangle className="size-4 shrink-0 mt-0.5" />}
              {testResult.msg}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-6 pb-6">
          {existing && (
            <button onClick={test} disabled={testing}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">
              <TestTube2 size={15} />
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-100 transition-colors">Cancel</button>
          <button onClick={save} disabled={saving || !name || !bootstrap || !topic}
            className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : existing ? 'Update' : 'Add Source'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RealTimeStreaming({ apiKey }: RealTimeStreamingProps) {
  // ── Mode: 'table' = SQL poll, 'stream' = Kafka/CDC push ──────────────────
  const [mode, setMode] = useSessionStorage<'table' | 'stream'>('rt_mode', 'table');

  // SQL poll config
  const [selectedTable,  setSelectedTable]  = useSessionStorage('rt_table', '');
  const [selectedCols,   setSelectedCols]   = useSessionStorage<string[]>('rt_cols', []);

  // Event stream config
  const [streamSources,  setStreamSources]  = useState<StreamSource[]>([]);
  const [selectedSource, setSelectedSource] = useSessionStorage<number | null>('rt_source_id', null);
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [editSource,     setEditSource]     = useState<StreamSource | undefined>(undefined);

  // Shared config
  const [maxPoints,      setMaxPoints]      = useSessionStorage('rt_maxPts', 60);
  const [anomalyEnabled, setAnomalyEnabled] = useSessionStorage('rt_anomaly', false);
  const [anomalyThresh,  setAnomalyThresh]  = useSessionStorage('rt_thresh', 3.0);
  const [alertEnabled,   setAlertEnabled]   = useSessionStorage('rt_alertEnabled', false);
  const [alertCol,       setAlertCol]       = useSessionStorage('rt_alertCol', '');
  const [alertVal,       setAlertVal]       = useSessionStorage('rt_alertVal', 0);

  // Volatile UI state
  const [dataPoints,   setDataPoints]   = useState<DataPoint[]>([]);
  const [isStreaming,  setIsStreaming]   = useState(false);
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
  const [pushInfo,     setPushInfo]     = useState<{ source: string; type: string; topic: string } | null>(null);

  // Refs
  const wsRef         = useRef<WebSocket | null>(null);
  const retryTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef    = useRef<DataPoint[]>([]);
  const frozenBufRef  = useRef<DataPoint[]>([]);
  const isFrozenRef   = useRef(false);
  const rowsThisSec   = useRef(0);

  const configRef = useRef({ selectedCols, maxPoints, anomalyEnabled, anomalyThresh, alertEnabled, alertCol, alertVal });
  useEffect(() => {
    configRef.current = { selectedCols, maxPoints, anomalyEnabled, anomalyThresh, alertEnabled, alertCol, alertVal };
  }, [selectedCols, maxPoints, anomalyEnabled, anomalyThresh, alertEnabled, alertCol, alertVal]);
  useEffect(() => { isFrozenRef.current = isFrozen; }, [isFrozen]);

  // ── Timers ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const secTick = setInterval(() => {
      setRowsPerSec(rowsThisSec.current);
      rowsThisSec.current = 0;
    }, 1000);

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

  // ── Load SQL tables ───────────────────────────────────────────────────────
  useEffect(() => {
    api.get<{ tables: string[] }>('/tables')
      .then(r => {
        setTables(r?.tables ?? []);
        if (!selectedTable && r?.tables?.length) setSelectedTable(r.tables[0]);
      })
      .catch(() => {});
  }, []);

  // ── Load event stream sources ─────────────────────────────────────────────
  const loadStreamSources = useCallback(() => {
    api.get<StreamSource[]>('/stream-sources')
      .then(r => setStreamSources(r ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => { loadStreamSources(); }, []);

  // ── Columns for SQL poll mode ─────────────────────────────────────────────
  useEffect(() => {
    if (!selectedTable || mode !== 'table') return;
    api.get<any>(`/tables/${selectedTable}/preview?limit=1`)
      .then(d => {
        const cols: string[] = d?.columns?.map((c: any) => c.name) ?? [];
        setAvailCols(cols);
        if (selectedCols.length === 0) setSelectedCols(cols.slice(0, 3));
        if (!alertCol && cols.length) setAlertCol(cols[0]);
      })
      .catch(() => {});
  }, [selectedTable, mode]);

  // ── Ingest a row from either WS endpoint ─────────────────────────────────
  const ingestRow = useCallback((raw: Record<string, any>) => {
    if (raw._ping) return;
    if (raw._connected) {
      // Push notification from /ws/stream-events
      setPushInfo({ source: raw.source, type: raw.type, topic: raw.topic });
      setConnStatus('live');
      return;
    }
    if (raw._error) {
      setConnStatus('error');
      return;
    }

    const { selectedCols, alertEnabled, alertCol, alertVal } = configRef.current;

    // For event streams we don't filter columns — forward the whole row
    const isSqlMode = mode === 'table';
    let point: DataPoint;

    if (isSqlMode) {
      if (!selectedCols.length) return;
      point = { timestamp: new Date().toLocaleTimeString('en-GB') };
      for (const col of selectedCols) {
        if (raw[col] !== undefined) {
          const v = raw[col];
          point[col] = typeof v === 'string' ? (isNaN(Number(v)) ? v : Number(v)) : v;
        }
      }
      if (Object.keys(point).length <= 1) return;
    } else {
      // Push mode: use whatever the event contains
      point = { timestamp: raw.timestamp || new Date().toLocaleTimeString('en-GB'), ...raw };
      if (raw._cdc_op) point._cdc_op = CDC_OP[raw._cdc_op] || raw._cdc_op;
    }

    rowsThisSec.current++;

    if (alertEnabled && alertCol && typeof point[alertCol] === 'number') {
      if ((point[alertCol] as number) >= alertVal) {
        setAlertFired(true);
        setAlertMsg(`${alertCol} = ${(point[alertCol] as number).toLocaleString()} ≥ ${alertVal}`);
      }
    }

    if (isFrozenRef.current) {
      frozenBufRef.current.push(point);
      setFrozenCount(c => c + 1);
      return;
    }
    pendingRef.current.push(point);
  }, [mode]);

  // ── WebSocket connect ─────────────────────────────────────────────────────
  const connect = useCallback((target: string | number, retries = 0) => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }

    setConnStatus('connecting');
    setPushInfo(null);

    const wsPath = typeof target === 'number'
      ? `/ws/stream-events/${target}`    // push: Kafka/CDC
      : `/ws/stream/${target}`;          // poll: SQL table

    const ws = new WebSocket(api.wsUrl(wsPath));
    wsRef.current = ws;

    const openTimer = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, 5000);

    ws.onopen  = () => {
      clearTimeout(openTimer);
      // For SQL poll mode, mark live immediately.
      // For push mode, the server sends _connected when the Kafka consumer is ready.
      if (typeof target === 'string') setConnStatus('live');
      setRetryCount(0);
    };
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
          retryTimer.current = setTimeout(() => connect(target, retries + 1), delay);
        } else {
          setConnStatus('error');
        }
        return streaming;
      });
    };
  }, [ingestRow]);

  // ── SQL poll loop (only used in table mode) ───────────────────────────────
  // The actual incremental polling lives in the backend WebSocket handler.
  // The frontend just opens the connection; it doesn't send anything.

  // ── Start / stop ──────────────────────────────────────────────────────────
  useEffect(() => {
    const target = mode === 'stream' ? selectedSource : selectedTable;
    if (isStreaming && target) {
      connect(target, 0);
    } else {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
      if (!isStreaming) setConnStatus('idle');
    }
    return () => {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    };
  }, [isStreaming, selectedTable, selectedSource, mode]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleCol = (col: string) =>
    setSelectedCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);

  const reset = () => {
    setIsStreaming(false); setIsFrozen(false); isFrozenRef.current = false;
    setDataPoints([]); pendingRef.current = []; frozenBufRef.current = [];
    setAnomalyCount(0); setRetryCount(0); setFrozenCount(0); setRowsPerSec(0);
    setAlertFired(false); setConnStatus('idle'); setPushInfo(null);
  };

  const freeze  = () => { setIsFrozen(true); isFrozenRef.current = true; setFrozenCount(0); frozenBufRef.current = []; };
  const catchUp = () => { pendingRef.current.push(...frozenBufRef.current.splice(0)); setFrozenCount(0); setIsFrozen(false); isFrozenRef.current = false; };

  const exportCSV = () => {
    if (!dataPoints.length) return;
    const allKeys = Array.from(new Set(dataPoints.flatMap(pt => Object.keys(pt).filter(k => !k.startsWith('_') || k === '_cdc_op'))));
    const cols = ['timestamp', ...allKeys.filter(k => k !== 'timestamp')];
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
    a.download = `stream_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteSource = async (id: number) => {
    if (!confirm('Remove this event stream source?')) return;
    await api.delete(`/stream-sources/${id}`).catch(() => {});
    loadStreamSources();
    if (selectedSource === id) { setSelectedSource(null); setIsStreaming(false); }
  };

  // ── Derived display ───────────────────────────────────────────────────────
  const displayCols = mode === 'table'
    ? selectedCols
    : dataPoints.length
      ? Object.keys(dataPoints[0]).filter(k => typeof dataPoints[0][k] === 'number').slice(0, 7)
      : [];

  const stats = (() => {
    const col = displayCols[0];
    if (!dataPoints.length || !col) return null;
    const vals = dataPoints.map(d => d[col]).filter((v): v is number => typeof v === 'number');
    if (!vals.length) return null;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { current: vals.at(-1)!, avg, min: Math.min(...vals), max: Math.max(...vals), col };
  })();

  const latestAnomaly = anomalyEnabled ? [...dataPoints].reverse().find(p => p.isAnomaly) : undefined;

  const statusColors = {
    idle: 'bg-gray-300', connecting: 'bg-yellow-400 animate-pulse',
    live: isFrozen ? 'bg-blue-500' : 'bg-green-500 animate-pulse', error: 'bg-red-500',
  };
  const statusLabel =
    connStatus === 'idle'       ? 'Idle' :
    connStatus === 'error'      ? 'Failed — restart to retry' :
    connStatus === 'connecting' ? (retryCount > 0 ? `Reconnecting (${retryCount}/${MAX_WS_RETRIES})…` : 'Connecting…') :
    isFrozen                    ? `Frozen · ${frozenCount} buffered` :
    'Live';

  const canStart = mode === 'table'
    ? !!(selectedTable && selectedCols.length)
    : !!(selectedSource);

  const selectedSourceObj = streamSources.find(s => s.id === selectedSource);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Radio className="size-7 text-red-600 shrink-0" />
          <h1 className="text-2xl font-bold text-gray-900">Real-Time Data Streaming</h1>
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
        <p className="text-gray-500 text-sm ml-10">
          {mode === 'table'
            ? 'SQL table · adaptive DB poll · freeze & catch-up · CSV export'
            : 'Kafka / CDC · server-push · zero polling · broker delivers events directly'}
        </p>
      </div>

      {/* Mode toggle */}
      <div className="mb-6 inline-flex bg-gray-100 rounded-xl p-1 gap-1">
        <button
          onClick={() => { setMode('table'); reset(); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            mode === 'table' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Database size={15} /> SQL Table (Poll)
        </button>
        <button
          onClick={() => { setMode('stream'); reset(); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            mode === 'stream' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Rss size={15} /> Event Stream (Push)
          {streamSources.length > 0 && (
            <span className="bg-blue-100 text-blue-700 text-[10px] font-black px-1.5 py-0.5 rounded-full">{streamSources.length}</span>
          )}
        </button>
      </div>

      {/* Banners */}
      {alertFired && (
        <div className="mb-5 flex items-center justify-between gap-3 p-4 bg-amber-50 border border-amber-300 rounded-xl">
          <div className="flex items-center gap-3">
            <Bell className="size-5 text-amber-600 shrink-0 animate-bounce" />
            <div>
              <p className="font-semibold text-amber-900 text-sm">Alert threshold crossed</p>
              <p className="text-xs text-amber-700 font-mono">{alertMsg}</p>
            </div>
          </div>
          <button onClick={() => setAlertFired(false)} className="text-xs text-amber-600 hover:text-amber-800 font-medium shrink-0">Dismiss</button>
        </div>
      )}

      {isFrozen && frozenCount > 0 && (
        <div className="mb-5 flex items-center justify-between gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-center gap-3">
            <Snowflake className="size-5 text-blue-500 shrink-0" />
            <p className="text-sm text-blue-800">Display frozen — <strong>{frozenCount.toLocaleString()} rows buffered</strong></p>
          </div>
          <button onClick={catchUp}
            className="text-sm font-semibold text-blue-700 hover:text-blue-900 bg-blue-100 hover:bg-blue-200 px-3 py-1.5 rounded-lg transition-colors shrink-0">
            Catch up →
          </button>
        </div>
      )}

      {pushInfo && connStatus === 'live' && (
        <div className="mb-5 flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <Rss className="size-4 text-emerald-600 animate-pulse shrink-0" />
          <div className="text-sm text-emerald-800">
            <strong>{pushInfo.source}</strong>
            <span className="ml-2 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-mono">{pushInfo.type}</span>
            <span className="ml-2 text-xs text-emerald-600">topic: <code className="font-mono">{pushInfo.topic}</code></span>
            <span className="ml-2 text-xs font-semibold text-emerald-700">⚡ Broker push — no polling</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Config panel */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
          <h3 className="font-bold text-gray-900">Configuration</h3>

          {/* ── SQL Table mode ── */}
          {mode === 'table' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Data Source</label>
                <select value={selectedTable}
                  onChange={e => { setSelectedTable(e.target.value); setDataPoints([]); }}
                  disabled={isStreaming}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 text-sm">
                  {!tables.length && <option value="">Loading…</option>}
                  {tables.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">📊 Adaptive DB poll — 200ms when active, up to 2s when idle</p>
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
            </>
          )}

          {/* ── Event stream mode ── */}
          {mode === 'stream' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Event Stream</label>
                <button
                  onClick={() => { setEditSource(undefined); setShowAddModal(true); }}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-semibold"
                >
                  <Plus size={13} /> Add
                </button>
              </div>

              {streamSources.length === 0 ? (
                <div className="text-center py-6 text-gray-400 border border-dashed border-gray-200 rounded-xl">
                  <Rss className="size-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No event streams configured</p>
                  <button onClick={() => { setEditSource(undefined); setShowAddModal(true); }}
                    className="mt-2 text-xs text-blue-600 hover:underline font-semibold">
                    Add Kafka or CDC source
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {streamSources.map(src => (
                    <div key={src.id}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${
                        selectedSource === src.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => !isStreaming && setSelectedSource(src.id)}
                    >
                      <Rss size={14} className={selectedSource === src.id ? 'text-blue-600' : 'text-gray-400'} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{src.name}</p>
                        <p className="text-xs text-gray-400 font-mono truncate">
                          {src.source_type === 'cdc_kafka' ? 'CDC · ' : ''}{src.connection_details.topic || '—'}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={e => { e.stopPropagation(); setEditSource(src); setShowAddModal(true); }}
                          className="p-1 text-gray-400 hover:text-gray-700 rounded">
                          <Settings size={12} />
                        </button>
                        <button onClick={e => { e.stopPropagation(); deleteSource(src.id); }}
                          className="p-1 text-gray-400 hover:text-red-600 rounded">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedSourceObj && (
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700 space-y-1">
                  <p><strong>Bootstrap:</strong> <code className="font-mono text-[11px]">{selectedSourceObj.connection_details.bootstrap_servers}</code></p>
                  <p><strong>Topic:</strong> <code className="font-mono text-[11px]">{selectedSourceObj.connection_details.topic}</code></p>
                  <p><strong>Offset:</strong> {selectedSourceObj.connection_details.auto_offset_reset ?? 'latest'}</p>
                </div>
              )}

              <p className="text-xs text-gray-400">⚡ Push mode — broker sends events directly, no DB polling</p>
            </div>
          )}

          {/* Window size */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Window <span className="text-blue-600 font-semibold">({maxPoints} pts)</span>
            </label>
            <input type="range" min="20" max="300" step="10" value={maxPoints}
              onChange={e => setMaxPoints(+e.target.value)} disabled={isStreaming}
              className="w-full accent-blue-600" />
          </div>

          {/* Anomaly detection (SQL poll only — needs column history) */}
          {mode === 'table' && (
            <div className="pt-3 border-t border-gray-100 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={anomalyEnabled}
                  onChange={e => setAnomalyEnabled(e.target.checked)} className="accent-red-600 size-4" />
                <span className="text-sm font-bold text-gray-900">Z-score Anomaly</span>
              </label>
              {anomalyEnabled && (
                <div className="pl-6 space-y-2">
                  <label className="block text-xs font-medium text-gray-700">
                    Threshold: <strong className="text-red-600">{anomalyThresh.toFixed(1)}σ</strong>
                  </label>
                  <input type="range" min="1" max="5" step="0.1" value={anomalyThresh}
                    onChange={e => setAnomalyThresh(+e.target.value)} className="w-full accent-red-600" />
                  {anomalyCount > 0 && <p className="text-xs font-semibold text-red-600">⚠ {anomalyCount} detected</p>}
                </div>
              )}
            </div>
          )}

          {/* Threshold alert */}
          <div className="pt-3 border-t border-gray-100 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={alertEnabled}
                onChange={e => setAlertEnabled(e.target.checked)} className="accent-amber-500 size-4" />
              <span className="text-sm font-bold text-gray-900">Threshold Alert</span>
            </label>
            {alertEnabled && (
              <div className="pl-6 space-y-2">
                {mode === 'table' ? (
                  <select value={alertCol} onChange={e => setAlertCol(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-mono">
                    {availCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input value={alertCol} onChange={e => setAlertCol(e.target.value)}
                    placeholder="field name"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-mono" />
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">≥</span>
                  <input type="number" value={alertVal} onChange={e => setAlertVal(+e.target.value)}
                    className="flex-1 px-2 py-1 border border-gray-300 rounded-lg text-xs font-mono" />
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex gap-2 pt-1">
            {!isStreaming ? (
              <button onClick={() => setIsStreaming(true)} disabled={!canStart}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium text-sm">
                <Play className="size-4" /> Start
              </button>
            ) : (
              <button onClick={() => setIsStreaming(false)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium text-sm">
                <Pause className="size-4" /> Stop
              </button>
            )}
            <button onClick={reset} title="Clear and reset" className="px-3 py-2.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
              <RotateCcw className="size-4" />
            </button>
          </div>

          {isStreaming && (
            <div className="flex gap-2">
              <button onClick={isFrozen ? catchUp : freeze}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  isFrozen ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'}`}>
                <Snowflake className="size-3.5" />
                {isFrozen ? `Catch up (${frozenCount})` : 'Freeze'}
              </button>
              <button onClick={exportCSV} disabled={!dataPoints.length}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100 disabled:opacity-40">
                <Download className="size-3.5" /> CSV
              </button>
            </div>
          )}

          {/* Status */}
          {connStatus === 'live' && !isFrozen && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <Activity className="size-4 text-green-600 animate-pulse" />
              <span className="text-xs font-medium text-green-700">
                {mode === 'stream' ? '⚡ Push' : '🔄 Poll'}
              </span>
              <Wifi className="size-3 text-green-500 ml-auto" />
            </div>
          )}
          {connStatus === 'error' && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <WifiOff className="size-4 text-red-500" />
              <span className="text-xs font-medium text-red-700">Failed after {MAX_WS_RETRIES} retries</span>
            </div>
          )}

          <div className="p-3 bg-gray-50 border border-gray-100 rounded-lg text-xs text-gray-500 space-y-0.5">
            {mode === 'table' && <p><strong>Table:</strong> {selectedTable || '—'}</p>}
            {mode === 'stream' && <p><strong>Source:</strong> {selectedSourceObj?.name || '—'}</p>}
            <p><strong>Displayed:</strong> {dataPoints.length} / {maxPoints}</p>
            {connStatus === 'live' && <p><strong>Throughput:</strong> {rowsPerSec} rows/s</p>}
          </div>
        </div>

        {/* Visualisation panel */}
        <div className="lg:col-span-3 space-y-5">
          {stats && (
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Current', value: stats.current, color: 'text-blue-600' },
                { label: 'Average', value: stats.avg,     color: 'text-purple-600' },
                { label: 'Min',     value: stats.min,     color: 'text-green-600' },
                { label: 'Max',     value: stats.max,     color: 'text-red-600' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-400 mb-1">{s.label} · <span className="font-mono">{stats.col}</span></p>
                  <p className={`text-2xl font-bold ${s.color}`}>
                    {s.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                </div>
              ))}
            </div>
          )}

          {latestAnomaly && (
            <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
              <AlertTriangle className="size-5 text-red-500 shrink-0" />
              <span>
                <strong>Anomaly</strong> at {latestAnomaly.timestamp} — {displayCols[0]}: <strong>{latestAnomaly[displayCols[0]]}</strong>
              </span>
            </div>
          )}

          <div className={`bg-white rounded-xl border p-6 transition-colors ${isFrozen ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                {isFrozen && <Snowflake className="size-4 text-blue-500" />}
                {mode === 'stream' ? (
                  <><Rss className="size-4 text-green-500" /> Push Stream — <span className="text-blue-600 font-mono text-sm">{selectedSourceObj?.name}</span></>
                ) : (
                  <>Live Stream — <span className="text-blue-600 font-mono text-sm">{selectedTable}</span></>
                )}
              </h3>
              <div className="flex items-center gap-3">
                {mode === 'stream' && connStatus === 'live' && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                    <Zap className="size-3" /> Push
                  </span>
                )}
                {mode === 'table' && connStatus === 'live' && (
                  <span className="text-xs text-gray-400">🔄 poll</span>
                )}
                {connStatus === 'live' && rowsPerSec > 0 && (
                  <span className="text-xs text-emerald-600 font-mono font-semibold">{rowsPerSec} r/s</span>
                )}
                <span className="text-xs text-gray-400">{dataPoints.length} pts</span>
              </div>
            </div>

            {dataPoints.length > 0 && displayCols.length > 0 ? (
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={dataPoints} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="timestamp" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v: any, name: string) => [
                      typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 3 }) : String(v),
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {displayCols.map((col, i) => (
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
                      name={col}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-80 text-gray-400">
                <div className="text-center">
                  {mode === 'stream' ? <Rss className="size-14 mx-auto mb-3 text-gray-300" /> : <Radio className="size-14 mx-auto mb-3 text-gray-300" />}
                  {isStreaming
                    ? <p>Waiting for events<span className="animate-pulse">…</span></p>
                    : mode === 'stream'
                      ? <p>{streamSources.length ? 'Select a source and click Start' : 'Add an event stream source first'}</p>
                      : <p>Select a table and columns, then click <strong>Start</strong></p>
                  }
                </div>
              </div>
            )}
          </div>

          {/* Recent rows table */}
          {dataPoints.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900">Last 10 events</h3>
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
                      {mode === 'stream' && <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">Op</th>}
                      {anomalyEnabled && mode === 'table' && <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">⚠</th>}
                      {displayCols.map(col => (
                        <th key={col} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase font-mono">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...dataPoints].slice(-10).reverse().map((pt, i) => (
                      <tr key={i} className={pt.isAnomaly ? 'bg-red-50' : 'hover:bg-gray-50'}>
                        <td className="px-3 py-2 font-mono text-gray-500 text-xs">{pt.timestamp}</td>
                        {mode === 'stream' && (
                          <td className="px-3 py-2">
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full uppercase ${
                              pt._cdc_op === 'INSERT' ? 'bg-green-100 text-green-700' :
                              pt._cdc_op === 'UPDATE' ? 'bg-blue-100 text-blue-700' :
                              pt._cdc_op === 'DELETE' ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>{pt._cdc_op || '—'}</span>
                          </td>
                        )}
                        {anomalyEnabled && mode === 'table' && (
                          <td className="px-3 py-2">{pt.isAnomaly && <AlertTriangle className="size-4 text-red-500" />}</td>
                        )}
                        {displayCols.map(col => (
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

      {/* Add/Edit stream source modal */}
      {showAddModal && (
        <StreamSourceModal
          existing={editSource}
          onClose={() => { setShowAddModal(false); setEditSource(undefined); }}
          onSaved={loadStreamSources}
        />
      )}
    </div>
  );
}
