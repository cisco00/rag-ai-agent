import { useState, useEffect, useRef, useCallback } from 'react';
import { useSessionStorage } from '../../hooks/useSessionStorage';
import { Radio, Play, Pause, RotateCcw, Activity, Wifi, WifiOff } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../../lib/api';

interface RealTimeStreamingProps {
  apiKey: string;
}

interface DataPoint {
  timestamp: string;
  [key: string]: any;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

export function RealTimeStreaming({ apiKey }: RealTimeStreamingProps) {
  const [isStreaming, setIsStreaming] = useSessionStorage('realtime_isStreaming', false);
  const [dataPoints, setDataPoints] = useSessionStorage<DataPoint[]>('realtime_dataPoints', []);
  const [maxDataPoints, setMaxDataPoints] = useSessionStorage('realtime_maxDataPoints', 50);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connected' | 'error'>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayIndexRef = useRef(0);
  const replayDataRef = useRef<any[]>([]);

  // Anomaly detection states
  const [enableAnomalyDetection, setEnableAnomalyDetection] = useSessionStorage('realtime_enableAnomalyDetection', false);
  const [anomalyThreshold, setAnomalyThreshold] = useSessionStorage('realtime_anomalyThreshold', 3.0);

  // Dynamic source + column selection
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useSessionStorage('realtime_selectedTable', '');
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useSessionStorage<string[]>('realtime_selectedColumns', []);

  // Use a ref for current threshold state so it's fresh in websocket callbacks without needing recreating the socket
  const configRef = useRef({ enableAnomalyDetection, anomalyThreshold });

  useEffect(() => {
    configRef.current = { enableAnomalyDetection, anomalyThreshold };
  }, [enableAnomalyDetection, anomalyThreshold]);

  // Helper function to detect anomaly based on recent history
  const detectAnomaly = (val: number, history: number[], threshold: number): boolean => {
    if (history.length < 5) return false; // Need minimum points for stats
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const sqDiffs = history.map(v => Math.pow(v - mean, 2));
    const variance = sqDiffs.reduce((a, b) => a + b, 0) / history.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return false;
    const zScore = Math.abs((val - mean) / stdDev);
    return zScore > threshold;
  };

  // Fetch tables on mount
  useEffect(() => {
    const fetchTables = async () => {
      try {
        const resp = await api.get<{ tables: string[] }>('/tables');
        if (resp.tables && resp.tables.length > 0) {
          setTables(resp.tables);
          if (!selectedTable) {
            setSelectedTable(resp.tables[0]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch tables:', err);
      }
    };
    fetchTables();
  }, []);

  // Fetch columns when table changes
  useEffect(() => {
    if (!selectedTable) return;
    const fetchColumns = async () => {
      try {
        const data = await api.get<any>(`/tables/${selectedTable}/preview?limit=1`);
        if (data && data.columns) {
          const cols: string[] = data.columns.map((c: any) => c.name);
          setAvailableColumns(cols);
          // Only auto-select first few numeric-looking columns if none were previously stored
          if (selectedColumns.length === 0) {
            setSelectedColumns(cols.slice(0, 3));
          }
        }
      } catch (err) {
        console.error('Failed to fetch columns:', err);
      }
    };
    fetchColumns();
    // Only clear data points if we don't have existing stream data for this table
    if (dataPoints.length === 0) {
      setDataPoints([]);
      replayIndexRef.current = 0;
      replayDataRef.current = [];
    }
  }, [selectedTable]);

  // Load replay data when streaming starts
  const loadReplayData = useCallback(async () => {
    if (!selectedTable) return false;
    try {
      const data = await api.get<any>(`/tables/${selectedTable}/preview?limit=50`);
      if (data && data.rows && data.rows.length > 0) {
        replayDataRef.current = data.rows;
        replayIndexRef.current = 0;
        return true;
      }
    } catch (err) {
      console.error('Failed to load replay data:', err);
    }
    return false;
  }, [selectedTable]);

  // Emit the next data point from the replay buffer
  const emitNextPoint = useCallback(() => {
    const rows = replayDataRef.current;
    if (!rows || rows.length === 0) return;

    const row = rows[replayIndexRef.current % rows.length];
    replayIndexRef.current += 1;

    const point: DataPoint = {
      timestamp: new Date().toLocaleTimeString(),
    };
    selectedColumns.forEach(col => {
      const val = row[col];
      if (val !== undefined && val !== null) {
        point[col] = typeof val === 'string' ? parseFloat(val) || val : val;
      }
    });

    setDataPoints(prev => {
      // Evaluate anomalies if enabled
      let isAnomaly = false;
      const { enableAnomalyDetection, anomalyThreshold } = configRef.current;

      if (enableAnomalyDetection && selectedColumns.length > 0) {
        // Evaluate based on the primary (first) selected column
        const primaryCol = selectedColumns[0];
        const val = point[primaryCol];
        if (typeof val === 'number') {
          const history = prev.map(p => p[primaryCol]).filter(v => typeof v === 'number') as number[];
          isAnomaly = detectAnomaly(val, history, anomalyThreshold);
        }
      }

      return [...prev, { ...point, isAnomaly }].slice(-maxDataPoints);
    });
  }, [selectedColumns, maxDataPoints]);

  // Main streaming effect
  useEffect(() => {
    if (!isStreaming || !selectedTable) {
      // Stop everything
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setConnectionStatus('idle');
      return;
    }

    let wsConnected = false;
    let started = false;

    const startPolling = async () => {
      if (started) return;
      started = true;

      const loaded = await loadReplayData();
      if (!loaded) {
        setConnectionStatus('error');
        setIsStreaming(false);
        return;
      }

      setConnectionStatus('connected');
      // Emit first point immediately, then every 1.5 seconds
      emitNextPoint();
      pollRef.current = setInterval(emitNextPoint, 1500);
    };

    // Try WebSocket first
    try {
      const wsUrl = api.wsUrl(`/ws/stream/${selectedTable}`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const wsTimeout = setTimeout(() => {
        if (!wsConnected) {
          // WS failed to connect - fall back to HTTP polling
          console.log('WS timeout, falling back to HTTP polling');
          ws.close();
          startPolling();
        }
      }, 5000);

      ws.onopen = () => {
        wsConnected = true;
        clearTimeout(wsTimeout);
        setConnectionStatus('connected');
        console.log('WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          if (raw.error) {
            // Server reported error, switch to polling
            startPolling();
            return;
          }
          const point: DataPoint = {
            timestamp: new Date().toLocaleTimeString(),
          };
          selectedColumns.forEach(col => {
            if (raw[col] !== undefined) point[col] = raw[col];
          });
          if (Object.keys(point).length > 1) {
            setDataPoints(prev => {
              let isAnomaly = false;
              const { enableAnomalyDetection, anomalyThreshold } = configRef.current;

              if (enableAnomalyDetection && selectedColumns.length > 0) {
                const primaryCol = selectedColumns[0];
                const val = point[primaryCol];
                if (typeof val === 'number') {
                  const history = prev.map(p => p[primaryCol]).filter(v => typeof v === 'number') as number[];
                  isAnomaly = detectAnomaly(val, history, anomalyThreshold);
                }
              }

              return [...prev, { ...point, isAnomaly }].slice(-maxDataPoints);
            });
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message', e);
        }
      };

      ws.onerror = () => {
        if (!wsConnected) {
          clearTimeout(wsTimeout);
          startPolling();
        } else {
          setConnectionStatus('error');
          setIsStreaming(false);
        }
      };

      ws.onclose = (_event) => {
        if (!wsConnected && !started) {
          clearTimeout(wsTimeout);
          startPolling();
        } else if (wsConnected) {
          // WS closed after connection - switch to polling to keep chart alive
          startPolling();
        }
      };
    } catch (err) {
      console.error('WebSocket creation failed, using polling', err);
      startPolling();
    }

    return () => {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [isStreaming, selectedTable, apiKey]);

  const toggleColumn = (col: string) => {
    setSelectedColumns(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const getStats = () => {
    if (dataPoints.length === 0 || selectedColumns.length === 0)
      return { current: 0, avg: 0, min: 0, max: 0 };
    const col = selectedColumns[0];
    const values = dataPoints.map(d => Number(d[col] ?? 0)).filter(v => !isNaN(v));
    if (values.length === 0) return { current: 0, avg: 0, min: 0, max: 0 };
    return {
      current: values[values.length - 1],
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  };

  const stats = getStats();

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Radio className="size-8 text-red-600" />
          <h1 className="text-3xl font-bold text-gray-900">Real-Time Data Streaming</h1>
        </div>
        <p className="text-gray-600">
          Monitor live data from your database tables with low-latency connections.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Controls */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h3 className="font-bold text-gray-900">Stream Configuration</h3>

          {/* Table / Data Source */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Data Source (Table)
            </label>
            <select
              value={selectedTable}
              onChange={(e) => {
                setSelectedTable(e.target.value);
                setDataPoints([]);
              }}
              disabled={isStreaming}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 text-sm"
            >
              {tables.length === 0 && <option value="">Loading tables...</option>}
              {tables.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Column Multi-Select */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Columns to Stream
            </label>
            {availableColumns.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Select a table first</p>
            ) : (
              <div className="border border-gray-200 rounded-lg p-2 space-y-1 max-h-44 overflow-y-auto">
                {availableColumns.map(col => (
                  <label key={col} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                    <input
                      type="checkbox"
                      checked={selectedColumns.includes(col)}
                      onChange={() => toggleColumn(col)}
                      disabled={isStreaming}
                      className="accent-blue-600"
                    />
                    <span className="font-mono text-gray-700">{col}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1">{selectedColumns.length} column(s) selected</p>
          </div>

          {/* Max Data Points */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Data Points
            </label>
            <input
              type="number"
              value={maxDataPoints}
              onChange={(e) => setMaxDataPoints(parseInt(e.target.value))}
              disabled={isStreaming}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 text-sm"
              min="10" max="200" step="10"
            />
          </div>

          {/* Anomaly Detection Toggle */}
          <div className="pt-4 border-t border-gray-100 space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enableAnomalyDetection}
                onChange={(e) => setEnableAnomalyDetection(e.target.checked)}
                className="accent-red-600 size-4"
              />
              <span className="text-sm font-bold text-gray-900">Enable Live Anomaly Detection</span>
            </label>

            {enableAnomalyDetection && (
              <div className="pl-6 space-y-2">
                <label className="block text-xs font-medium text-gray-700">
                  Sensitivity Threshold (Z-Score: {anomalyThreshold})
                </label>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="0.1"
                  value={anomalyThreshold}
                  onChange={(e) => setAnomalyThreshold(parseFloat(e.target.value))}
                  className="w-full accent-red-600"
                />
                <p className="text-xs text-gray-500">Lower = more sensitive. Above 3.0 represents a &gt;99.7% statistical deviation.</p>
              </div>
            )}
          </div>

          {/* Start / Pause / Reset */}
          <div className="flex gap-2">
            {!isStreaming ? (
              <button
                onClick={() => setIsStreaming(true)}
                disabled={!selectedTable || selectedColumns.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium text-sm"
              >
                <Play className="size-4" /> Start
              </button>
            ) : (
              <button
                onClick={() => setIsStreaming(false)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-medium text-sm"
              >
                <Pause className="size-4" /> Pause
              </button>
            )}
            <button
              onClick={() => { setIsStreaming(false); setDataPoints([]); replayIndexRef.current = 0; }}
              className="px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              <RotateCcw className="size-4" />
            </button>
          </div>

          {/* Status */}
          {connectionStatus === 'connected' && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <Activity className="size-5 text-green-600 animate-pulse" />
              <span className="text-sm font-medium text-green-700">Streaming Active</span>
            </div>
          )}
          {connectionStatus === 'error' && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <WifiOff className="size-5 text-red-500" />
              <span className="text-sm font-medium text-red-700">Connection Failed</span>
            </div>
          )}

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 space-y-1">
            <p><strong>Source:</strong> {selectedTable || '—'}</p>
            <p><strong>Points collected:</strong> {dataPoints.length}</p>
          </div>
        </div>

        {/* Visualization */}
        <div className="lg:col-span-3 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Current', value: stats.current, color: 'text-blue-600' },
              { label: 'Average', value: stats.avg, color: 'text-purple-600' },
              { label: 'Minimum', value: stats.min, color: 'text-green-600' },
              { label: 'Maximum', value: stats.max, color: 'text-red-600' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-500 mb-1">{s.label} <span className="text-xs font-mono text-gray-400">({selectedColumns[0] || '—'})</span></p>
                <p className={`text-2xl font-bold ${s.color}`}>
                  {s.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">Live Data Stream — <span className="text-blue-600 font-mono">{selectedTable}</span></h3>
              <div className="flex items-center gap-2">
                {connectionStatus === 'connected' ? (
                  <Wifi className="size-4 text-green-500" />
                ) : (
                  <WifiOff className="size-4 text-gray-400" />
                )}
                <div className={`w-3 h-3 rounded-full ${isStreaming && connectionStatus === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
                <span className="text-sm text-gray-600">
                  {isStreaming && connectionStatus === 'connected' ? 'Live' : isStreaming ? 'Connecting...' : 'Paused'}
                </span>
              </div>
            </div>

            {dataPoints.length > 0 ? (
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={dataPoints}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  {selectedColumns.map((col, i) => {
                    const isPrimaryCol = enableAnomalyDetection && i === 0;
                    return (
                      <Line
                        key={col}
                        type="monotone"
                        dataKey={col}
                        stroke={COLORS[i % COLORS.length]}
                        strokeWidth={2}
                        dot={isPrimaryCol ? (props: any) => {
                          const { cx, cy, payload } = props;
                          if (payload && payload.isAnomaly) {
                            return <circle key={`anomaly-${cx}-${cy}`} cx={cx} cy={cy} r={5} fill="red" stroke="white" strokeWidth={2} />;
                          }
                          return <span key={`empty-${cx}-${cy}`} />;
                        } : false}
                        name={col + (isPrimaryCol ? ' (Analyzed)' : '')}
                        isAnimationActive={false}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-96 text-gray-400">
                <div className="text-center">
                  <Radio className="size-16 mx-auto mb-3 text-gray-300" />
                  {isStreaming ? (
                    <p>Connecting and loading data<span className="animate-pulse">...</span></p>
                  ) : (
                    <p>Select a table and columns, then click <strong>Start</strong></p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Recent rows table */}
          {dataPoints.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-bold text-gray-900 mb-4">Recent Data Points</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                      {selectedColumns.map(col => (
                        <th key={col} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase font-mono">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {dataPoints.slice(-10).reverse().map((point, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-gray-600">{point.timestamp}</td>
                        {selectedColumns.map(col => (
                          <td key={col} className="px-4 py-2 font-bold text-blue-600">
                            {typeof point[col] === 'number'
                              ? point[col].toLocaleString(undefined, { maximumFractionDigits: 2 })
                              : (point[col] ?? '—')}
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