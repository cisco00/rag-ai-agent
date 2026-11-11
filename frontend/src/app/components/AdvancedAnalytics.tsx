import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSessionStorage } from '../../hooks/useSessionStorage';
import { TrendingUp, Activity, Grid3x3, Layers, Play, Loader2, Sparkles, ChevronDown, ChevronUp, Save, BookOpen, Trash2, Clock } from 'lucide-react';
import { api } from '../../lib/api';
import {
  ComposedChart, Area, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceDot,
} from 'recharts';

interface AdvancedAnalyticsProps {
  apiKey: string;
}

type AnalyticsTab = 'forecast' | 'anomaly' | 'correlation' | 'cluster';

export function AdvancedAnalytics({ }: AdvancedAnalyticsProps) {
  const [activeTab, setActiveTab] = useSessionStorage<AnalyticsTab>('advanced_analytics_activeTab', 'forecast');
  const [isProcessing, setIsProcessing] = useState(false);
  const [forecastData, setForecastData] = useSessionStorage<any[]>('advanced_analytics_forecastData', []);
  const [forecastEngine, setForecastEngine] = useSessionStorage<string>('advanced_analytics_forecastEngine', '');
  const [anomalyData, setAnomalyData] = useSessionStorage<any[]>('advanced_analytics_anomalyData', []);
  const [correlationData, setCorrelationData] = useSessionStorage<any[][]>('advanced_analytics_correlationData', []);
  const [correlationColumns, setCorrelationColumns] = useSessionStorage<string[]>('advanced_analytics_correlationColumns', []);

  // Forecast configuration
  const [forecastConfig, setForecastConfig] = useSessionStorage('advanced_analytics_forecastConfig', {
    table: 'sales',
    dateColumn: 'date',
    valueColumn: 'revenue',
    periods: 30,
    freq: 'D',
  });

  // Anomaly configuration
  const [anomalyConfig, setAnomalyConfig] = useSessionStorage('advanced_analytics_anomalyConfig', {
    table: 'sales',
    valueColumn: 'revenue',
    contamination: 0.05,
    multivariate: false,
    mvColumns: [] as string[],  // selected columns for multivariate mode
  });
  // Full anomaly API response (needed for multivariate meta: pairs, feature_cols)
  const [anomalyResult, setAnomalyResult] = useSessionStorage<any>('advanced_analytics_anomalyResult', null);

  // Correlation configuration
  const [correlationConfig, setCorrelationConfig] = useSessionStorage('advanced_analytics_correlationConfig', {
    table: 'sales',
    columns: ['revenue', 'quantity', 'profit', 'discount'],
    method: 'pearson',
  });

  // Cluster configuration
  const [clusterConfig, setClusterConfig] = useSessionStorage('advanced_analytics_clusterConfig', {
    table: 'sales',
    xColumn: '',
    yColumn: '',
    nClusters: 3,
  });
  const [clusterData, setClusterData] = useSessionStorage<any>('advanced_analytics_clusterData', null);
  const [clusterColumns, setClusterColumns] = useState<string[]>([]);

  // AI insights
  const [insights, setInsights] = useState<Record<AnalyticsTab, string[]>>({
    forecast: [], anomaly: [], correlation: [], cluster: [],
  });
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(true);

  // Snapshots
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [snapshotSaving, setSnapshotSaving] = useState(false);

  const [tables, setTables] = useState<string[]>([]);
  const [forecastColumns, setForecastColumns] = useState<string[]>([]);
  const [anomalyColumns, setAnomalyColumns] = useState<string[]>([]);
  const [correlationColumnsList, setCorrelationColumnsList] = useState<string[]>([]);

  useEffect(() => {
    fetchTables();
  }, []);

  useEffect(() => {
    fetchSnapshots(activeTab);
  }, [activeTab]); // eslint-disable-line

  useEffect(() => {
    const fetchForecastCols = async () => {
      if (!forecastConfig.table) return;
      try {
        const data = await api.get<any>(`/tables/${forecastConfig.table}/preview?limit=1`);
        if (data && data.columns) {
          const cols = data.columns.map((c: any) => c.name);
          setForecastColumns(cols);
          // Auto-select defaults
          if (cols.length > 0) {
            const dateCol = cols.find((c: string) => c.toLowerCase().includes('date') || c.toLowerCase().includes('time')) || cols[0];
            const valCol = cols.find((c: string) => c !== dateCol) || cols[0];
            setForecastConfig(prev => ({ ...prev, dateColumn: dateCol, valueColumn: valCol }));
          }
        }
      } catch { /* ignore */ }
    };
    fetchForecastCols();
  }, [forecastConfig.table]);

  useEffect(() => {
    const fetchAnomalyCols = async () => {
      if (!anomalyConfig.table) return;
      try {
        const data = await api.get<any>(`/tables/${anomalyConfig.table}/preview?limit=1`);
        if (data && data.columns) {
          const cols = data.columns.map((c: any) => c.name);
          setAnomalyColumns(cols);
          if (cols.length > 0) {
            setAnomalyConfig(prev => ({ ...prev, valueColumn: cols[0] }));
          }
        }
      } catch { /* ignore */ }
    };
    fetchAnomalyCols();
  }, [anomalyConfig.table]);

  useEffect(() => {
    const fetchCorrCols = async () => {
      if (!correlationConfig.table) return;
      try {
        const data = await api.get<any>(`/tables/${correlationConfig.table}/preview?limit=1`);
        if (data && data.columns) {
          const cols = data.columns.map((c: any) => c.name);
          setCorrelationColumnsList(cols);
          if (cols.length >= 2) {
            setCorrelationConfig(prev => ({ ...prev, columns: cols.slice(0, 4) }));
          }
        }
      } catch { /* ignore */ }
    };
    fetchCorrCols();
  }, [correlationConfig.table]);

  // Cluster columns
  useEffect(() => {
    const fetchClusterCols = async () => {
      if (!clusterConfig.table) return;
      try {
        const data = await api.get<any>(`/tables/${clusterConfig.table}/preview?limit=1`);
        if (data && data.columns) {
          const cols = data.columns.map((c: any) => c.name);
          setClusterColumns(cols);
          if (cols.length >= 2) {
            setClusterConfig((prev: any) => ({
              ...prev,
              xColumn: prev.xColumn || cols[0],
              yColumn: prev.yColumn || cols[1],
            }));
          }
        }
      } catch { /* ignore */ }
    };
    fetchClusterCols();
  }, [clusterConfig.table]);

  const fetchSnapshots = useCallback(async (tab: AnalyticsTab) => {
    setSnapshotsLoading(true);
    try {
      const resp = await api.get<any>(`/analytics/snapshots?analysis_type=${tab}`);
      setSnapshots(resp?.snapshots ?? []);
    } catch { /* non-fatal */ }
    finally { setSnapshotsLoading(false); }
  }, []);

  const handleSaveSnapshot = useCallback(async () => {
    if (!saveName.trim()) return;
    setSnapshotSaving(true);
    try {
      let config: any = {};
      let result: any = {};
      let engine: string | null = null;
      if (activeTab === 'forecast') {
        config = forecastConfig;
        result = { chart: forecastData };
        engine = forecastEngine || null;
      } else if (activeTab === 'anomaly') {
        config = anomalyConfig;
        result = { data: anomalyData };
      } else if (activeTab === 'correlation') {
        config = correlationConfig;
        result = { correlation_matrix: correlationData, columns: correlationColumns };
      } else if (activeTab === 'cluster') {
        config = clusterConfig;
        result = clusterData ?? {};
      }
      await api.post('/analytics/snapshots', {
        name: saveName.trim(),
        analysis_type: activeTab,
        config,
        result,
        engine,
      });
      setSaveDialogOpen(false);
      setSaveName('');
      fetchSnapshots(activeTab);
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSnapshotSaving(false);
    }
  }, [saveName, activeTab, forecastConfig, forecastData, forecastEngine, anomalyConfig, anomalyData, correlationConfig, correlationData, correlationColumns, clusterConfig, clusterData, fetchSnapshots]);

  const handleLoadSnapshot = useCallback((snap: any) => {
    const { analysis_type, config, result, engine } = snap;
    if (analysis_type === 'forecast') {
      if (config) setForecastConfig(config);
      if (result?.chart?.length) {
        setForecastData(result.chart);
        setForecastEngine(engine ?? '');
      }
      setActiveTab('forecast');
    } else if (analysis_type === 'anomaly') {
      if (config) setAnomalyConfig(config);
      if (result?.data?.length) setAnomalyData(result.data);
      setActiveTab('anomaly');
    } else if (analysis_type === 'correlation') {
      if (config) setCorrelationConfig(config);
      if (result?.columns) setCorrelationColumns(result.columns);
      if (result?.correlation_matrix) setCorrelationData(result.correlation_matrix);
      setActiveTab('correlation');
    } else if (analysis_type === 'cluster') {
      if (config) setClusterConfig(config);
      if (result && Object.keys(result).length) setClusterData(result);
      setActiveTab('cluster');
    }
    setSnapshotsOpen(false);
  }, [setForecastConfig, setForecastData, setForecastEngine, setAnomalyConfig, setAnomalyData, setCorrelationConfig, setCorrelationColumns, setCorrelationData, setClusterConfig, setClusterData, setActiveTab]);

  const handleDeleteSnapshot = useCallback(async (id: number) => {
    if (!confirm('Delete this snapshot?')) return;
    try {
      await api.delete(`/analytics/snapshots/${id}`);
      fetchSnapshots(activeTab);
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  }, [activeTab, fetchSnapshots]);

  const fetchInsights = useCallback(async (tab: AnalyticsTab, stats: Record<string, any>) => {
    if (!stats || Object.keys(stats).length === 0) return;
    setInsightLoading(true);
    try {
      const resp = await api.post<{ insights: string[] }>('/analytics/insights', {
        analysis_type: tab,
        stats,
      });
      if (resp?.insights?.length) {
        setInsights(prev => ({ ...prev, [tab]: resp.insights }));
        setInsightsOpen(true);
      }
    } catch { /* non-fatal */ }
    finally { setInsightLoading(false); }
  }, []);

  const fetchTables = useCallback(async () => {
    try {
      const resp = await api.get<{ tables: string[] }>('/tables');
      if (resp.tables) {
        setTables(resp.tables);
        if (resp.tables.length > 0) {
          // Only auto-select table if not already configured in session storage
          setForecastConfig((prev: any) => prev.table !== 'sales' ? prev : { ...prev, table: resp.tables[0] });
          setAnomalyConfig((prev: any) => prev.table !== 'sales' ? prev : { ...prev, table: resp.tables[0] });
          setCorrelationConfig((prev: any) => prev.table !== 'sales' ? prev : { ...prev, table: resp.tables[0] });
        }
      }
    } catch (err) {
      console.error('Failed to fetch tables:', err);
    }
  }, [setForecastConfig, setAnomalyConfig, setCorrelationConfig]);

  const handleRunForecast = useCallback(async () => {
    if (!forecastConfig.table || !forecastConfig.dateColumn || !forecastConfig.valueColumn) return;
    setIsProcessing(true);

    try {
      const resp = await api.post<any>('/analytics/forecast', {
        table_name: forecastConfig.table,
        date_column: forecastConfig.dateColumn,
        value_column: forecastConfig.valueColumn,
        periods: forecastConfig.periods,
        freq: forecastConfig.freq
      });

      // New shape: { chart: [...], stats: {...} }
      // Legacy shape: plain array or { historical, forecast }
      let chartData: any[] = [];
      let statsData: Record<string, any> = {};

      if (resp && resp.chart) {
        chartData = resp.chart;
        statsData = resp.stats ?? {};
      } else if (Array.isArray(resp)) {
        chartData = resp;
      } else if (resp && resp.historical && resp.forecast) {
        const hist = resp.historical;
        const fcast = resp.forecast;
        const histDates: string[] = hist.dates || [];
        const histVals: number[] = hist.values || [];
        const fcastDates: string[] = fcast.dates || [];
        const fcastVals: number[] = fcast.values || [];
        const merged: Record<string, any> = {};
        histDates.forEach((d, i) => { merged[d] = { date: d, actual: histVals[i] }; });
        fcastDates.forEach((d, i) => {
          if (merged[d]) merged[d].forecast = fcastVals[i];
          else merged[d] = { date: d, forecast: fcastVals[i] };
        });
        chartData = Object.values(merged).sort((a: any, b: any) => a.date.localeCompare(b.date));
      }

      setForecastData(chartData);
      setForecastEngine(resp?.engine ?? '');
      fetchInsights('forecast', statsData);
      fetchSnapshots('forecast');
    } catch (err: any) {
      console.error(err);
      alert(`Forecast failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [forecastConfig, setForecastData, fetchInsights, fetchSnapshots]);

  const handleRunAnomalyDetection = async () => {
    if (!anomalyConfig.table || !anomalyConfig.valueColumn) return;
    // multivariate requires ≥2 selected columns
    if (anomalyConfig.multivariate && anomalyConfig.mvColumns.length < 2) {
      alert('Select at least 2 columns for multivariate mode.');
      return;
    }
    setIsProcessing(true);

    try {
      const payload: any = {
        table_name:    anomalyConfig.table,
        value_column:  anomalyConfig.valueColumn,
        contamination: anomalyConfig.contamination,
        multivariate:  anomalyConfig.multivariate,
      };
      if (anomalyConfig.multivariate) {
        payload.columns = anomalyConfig.mvColumns;
      }

      const resp = await api.post<any>('/analytics/anomaly', payload);

      // Normalise response shape
      let plotData: any[] = [];
      if (resp?.data && Array.isArray(resp.data)) {
        plotData = resp.data;
      } else if (Array.isArray(resp)) {
        plotData = resp;
      } else if (resp?.anomalies) {
        const raw = resp.anomalies;
        plotData = Array.isArray(raw)
          ? raw
          : Object.entries(raw).map(([idx, val]: [string, any]) => ({
              index: parseInt(idx),
              value: typeof val === 'object' ? val.value ?? val : val,
              isAnomaly: true,
            })).sort((a, b) => a.index - b.index);
      }

      setAnomalyData(plotData);
      setAnomalyResult(resp ?? null);
      if (resp?.stats) fetchInsights('anomaly', resp.stats);
      fetchSnapshots('anomaly');
    } catch (err: any) {
      console.error(err);
      alert(`Anomaly detection failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRunCorrelation = async () => {
    if (!correlationConfig.table || correlationConfig.columns.length < 2) {
      alert('Please specify at least 2 columns to run correlation.');
      return;
    }
    setIsProcessing(true);

    try {
      const resp = await api.post<any>('/analytics/correlation', {
        table_name: correlationConfig.table,
        columns: correlationConfig.columns,
        method: correlationConfig.method
      });
      const cols: string[] = resp.columns || correlationConfig.columns;
      const matrix: number[][] = resp.correlation_matrix ?? resp.matrix ?? [];
      setCorrelationColumns(cols);
      setCorrelationData(matrix);
      setDrillDown(null);
      if (resp?.stats) fetchInsights('correlation', resp.stats);
      fetchSnapshots('correlation');
    } catch (err: any) {
      console.error(err);
      alert(`Correlation analysis failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRunCluster = async () => {
    if (!clusterConfig.table || !clusterConfig.xColumn || !clusterConfig.yColumn) return;
    setIsProcessing(true);
    try {
      const resp = await api.post<any>('/analytics/cluster', {
        table_name: clusterConfig.table,
        x_column:   clusterConfig.xColumn,
        y_column:   clusterConfig.yColumn,
        n_clusters: clusterConfig.nClusters,
      });
      if (resp?.error) { alert(`Clustering failed: ${resp.error}`); return; }
      setClusterData(resp);
      if (resp?.stats) fetchInsights('cluster', resp.stats);
      fetchSnapshots('cluster');
    } catch (err: any) {
      console.error(err);
      alert(`Clustering failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Smooth diverging colour scale: red(-1) → white(0) → green(+1)
  const getCellStyle = (value: number): React.CSSProperties => {
    const v = Math.max(-1, Math.min(1, value));
    // Interpolate between red/white/green using the sign
    let r: number, g: number, b: number;
    if (v < 0) {
      // white → red
      const t = -v; // 0..1
      r = Math.round(255 - (255 - 220) * t);  // 255→220
      g = Math.round(255 - (255 -  38) * t);  // 255→38
      b = Math.round(255 - (255 -  38) * t);  // 255→38
    } else {
      // white → green
      const t = v;  // 0..1
      r = Math.round(255 - (255 -  22) * t);  // 255→22
      g = Math.round(255 - (255 - 163) * t);  // 255→163
      b = Math.round(255 - (255 -  74) * t);  // 255→74
    }
    const bg = `rgb(${r},${g},${b})`;
    // Dark text near white (abs < 0.4), white text otherwise
    const textColor = Math.abs(v) < 0.4 ? '#374151' : '#ffffff';
    return { backgroundColor: bg, color: textColor, cursor: 'pointer', transition: 'filter 0.15s' };
  };

  // Drill-down state: scatter of two correlated columns
  const [drillDown, setDrillDown] = useState<null | {
    col1: string; col2: string; r: number; data: { x: number; y: number }[];
  }>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const handleCellClick = useCallback(async (col1: string, col2: string, r: number) => {
    if (col1 === col2) return; // diagonal — no meaningful scatter
    setDrillDown(null);
    setDrillLoading(true);
    try {
      const resp = await api.get<any>(`/tables/${correlationConfig.table}/preview?limit=2000`);
      const rows: any[] = resp?.data ?? resp?.rows ?? [];
      const pts = rows
        .map((row: any) => ({ x: parseFloat(row[col1]), y: parseFloat(row[col2]) }))
        .filter((p: { x: number; y: number }) => !isNaN(p.x) && !isNaN(p.y));
      setDrillDown({ col1, col2, r, data: pts });
    } catch { /* ignore — drill-down is non-critical */ }
    finally { setDrillLoading(false); }
  }, [correlationConfig.table]);

  // Cluster colour palette (up to 8 clusters)
  const CLUSTER_COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#ec4899','#8b5cf6','#14b8a6'];

  const tabs = useMemo(() => [
    { id: 'forecast',     label: 'Time Series Forecast', icon: TrendingUp },
    { id: 'anomaly',      label: 'Anomaly Detection',    icon: Activity   },
    { id: 'correlation',  label: 'Correlation Analysis', icon: Grid3x3    },
    { id: 'cluster',      label: 'Cluster Analysis',     icon: Layers     },
  ], []);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <TrendingUp className="size-8 text-purple-600" />
          <h1 className="text-3xl font-bold text-gray-900">Advanced Analytics</h1>
        </div>
        <p className="text-gray-600">
          Predictive forecasting, anomaly detection, and correlation analysis.
        </p>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="flex border-b border-gray-200">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as AnalyticsTab)}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 font-medium transition-colors ${activeTab === tab.id
                  ? 'text-purple-600 border-b-2 border-purple-600'
                  : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                <Icon className="size-5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Time Series Forecast */}
      {activeTab === 'forecast' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Forecast Configuration</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Table
                </label>
                <select
                  value={forecastConfig.table}
                  onChange={(e) => setForecastConfig({ ...forecastConfig, table: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {tables.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date Column
                </label>
                <select
                  value={forecastConfig.dateColumn}
                  onChange={(e) => setForecastConfig({ ...forecastConfig, dateColumn: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">Select date column...</option>
                  {forecastColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Value Column
                </label>
                <select
                  value={forecastConfig.valueColumn}
                  onChange={(e) => setForecastConfig({ ...forecastConfig, valueColumn: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">Select value column...</option>
                  {forecastColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Forecast Periods
                </label>
                <select
                  value={forecastConfig.periods}
                  onChange={(e) => setForecastConfig({ ...forecastConfig, periods: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {[7, 14, 30, 60, 90].map(p => <option key={p} value={p}>{p} units</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Data Frequency
                </label>
                <select
                  value={forecastConfig.freq}
                  onChange={(e) => setForecastConfig({ ...forecastConfig, freq: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="D">Daily</option>
                  <option value="h">Hourly</option>
                  <option value="W">Weekly</option>
                  <option value="MS">Monthly</option>
                  <option value="B">Business Daily</option>
                </select>
              </div>

              <button
                onClick={handleRunForecast}
                disabled={isProcessing}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors font-medium"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="size-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="size-5" />
                    Run Forecast
                  </>
                )}
              </button>
            </div>

            <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-lg space-y-1.5">
              <p className="text-sm text-purple-800">
                <strong>Primary:</strong> Prophet (Facebook) — native 95% CI via <code className="text-xs bg-purple-100 px-1 rounded">yhat_lower</code> / <code className="text-xs bg-purple-100 px-1 rounded">yhat_upper</code>
              </p>
              <p className="text-sm text-purple-800">
                <strong>Fallback:</strong> Holt-Winters ± 1.96σ·√h approximation
              </p>
              <p className="text-sm text-purple-500 mt-1">Minimum 5 data points required.</p>
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <h3 className="font-bold text-gray-900">Forecast Results</h3>
              {forecastEngine && (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  forecastEngine === 'prophet'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {forecastEngine === 'prophet' ? '⚡ Prophet · 95% CI' : '📈 Holt-Winters · approx CI'}
                </span>
              )}
              {forecastData.length > 0 && (
                <div className="ml-auto flex items-center gap-2">
                  {saveDialogOpen ? (
                    <>
                      <input
                        autoFocus
                        value={saveName}
                        onChange={e => setSaveName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveSnapshot(); if (e.key === 'Escape') setSaveDialogOpen(false); }}
                        placeholder="Snapshot name…"
                        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                      <button onClick={handleSaveSnapshot} disabled={snapshotSaving || !saveName.trim()}
                        className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
                        {snapshotSaving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} Save
                      </button>
                      <button onClick={() => setSaveDialogOpen(false)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">✕</button>
                    </>
                  ) : (
                    <button onClick={() => { setSaveDialogOpen(true); setSaveName(''); }}
                      className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 hover:bg-purple-50 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors">
                      <Save className="size-3" /> Save snapshot
                    </button>
                  )}
                </div>
              )}
            </div>

            {forecastData.length > 0 ? (
              <ResponsiveContainer width="100%" height={380}>
                <ComposedChart data={forecastData}>
                  <defs>
                    <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={v => v?.slice(0,10) ?? v} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v: any, name: string) => [
                      v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—',
                      name
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {/* 95 % confidence band — shaded area between lower and upper */}
                  <Area type="monotone" dataKey="upper" stroke="none" fill="url(#ciGrad)"
                        name="95% CI Upper" legendType="none" connectNulls />
                  <Area type="monotone" dataKey="lower" stroke="none" fill="white"
                        name="95% CI Lower" legendType="none" connectNulls />
                  <Line type="monotone" dataKey="actual"   stroke="#8b5cf6" strokeWidth={2}
                        name="Historical" dot={false} connectNulls />
                  <Line type="monotone" dataKey="forecast" stroke="#10b981" strokeWidth={2}
                        strokeDasharray="6 3" name="Forecast" dot={false} connectNulls />
                  {/* Thin boundary lines */}
                  <Line type="monotone" dataKey="upper" stroke="#10b981" strokeWidth={1}
                        strokeDasharray="2 4" name="Upper bound" dot={false} connectNulls legendType="none" />
                  <Line type="monotone" dataKey="lower" stroke="#10b981" strokeWidth={1}
                        strokeDasharray="2 4" name="Lower bound" dot={false} connectNulls legendType="none" />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-96 text-gray-400">
                <div className="text-center">
                  <TrendingUp className="size-16 mx-auto mb-3 text-gray-300" />
                  <p>Configure and run forecast to see results</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Anomaly Detection */}
      {activeTab === 'anomaly' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Config panel ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Anomaly Configuration</h3>

            <div className="space-y-4">
              {/* Table */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Table</label>
                <select value={anomalyConfig.table}
                  onChange={e => setAnomalyConfig({ ...anomalyConfig, table: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  {tables.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* Mode toggle */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Detection Mode</label>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm font-medium">
                  <button
                    onClick={() => setAnomalyConfig({ ...anomalyConfig, multivariate: false })}
                    className={`flex-1 py-2 transition-colors ${!anomalyConfig.multivariate ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    Univariate
                  </button>
                  <button
                    onClick={() => setAnomalyConfig({ ...anomalyConfig, multivariate: true })}
                    className={`flex-1 py-2 transition-colors ${anomalyConfig.multivariate ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    Multivariate
                  </button>
                </div>
              </div>

              {/* Primary value column (always shown; in MV mode it's the "index" column for the univariate chart fallback) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {anomalyConfig.multivariate ? 'Primary Column (reference)' : 'Value Column'}
                </label>
                <select value={anomalyConfig.valueColumn}
                  onChange={e => setAnomalyConfig({ ...anomalyConfig, valueColumn: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="">Select column…</option>
                  {anomalyColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Multivariate column picker (2–4 columns) */}
              {anomalyConfig.multivariate && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Feature Columns <span className="text-gray-400 font-normal">(pick 2–4)</span>
                  </label>
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
                    {anomalyColumns.map(c => {
                      const checked = anomalyConfig.mvColumns.includes(c);
                      const atMax   = anomalyConfig.mvColumns.length >= 4 && !checked;
                      return (
                        <label key={c} className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm cursor-pointer select-none transition-colors ${
                          checked   ? 'bg-purple-50 border-purple-400 text-purple-800'
                          : atMax   ? 'opacity-40 cursor-not-allowed bg-gray-50 border-gray-200 text-gray-400'
                          :           'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}>
                          <input type="checkbox" className="sr-only"
                            checked={checked}
                            disabled={atMax}
                            onChange={e => {
                              const next = e.target.checked
                                ? [...anomalyConfig.mvColumns, c]
                                : anomalyConfig.mvColumns.filter((x: string) => x !== c);
                              setAnomalyConfig({ ...anomalyConfig, mvColumns: next });
                            }} />
                          <span className={`inline-block w-3 h-3 rounded border mr-0.5 flex-shrink-0 ${checked ? 'bg-purple-500 border-purple-500' : 'border-gray-300'}`} />
                          {c}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    {anomalyConfig.mvColumns.length}/4 selected · IsolationForest scores all selected dimensions jointly
                  </p>
                </div>
              )}

              {/* Contamination slider */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contamination <span className="text-purple-600 font-semibold">({(anomalyConfig.contamination * 100).toFixed(0)}%)</span>
                </label>
                <input type="range" min="0.01" max="0.5" step="0.01"
                  value={anomalyConfig.contamination}
                  onChange={e => setAnomalyConfig({ ...anomalyConfig, contamination: parseFloat(e.target.value) })}
                  className="w-full accent-purple-600" />
                <p className="text-xs text-gray-500 mt-1">Expected proportion of outliers in the data</p>
              </div>

              <button onClick={handleRunAnomalyDetection} disabled={isProcessing}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors font-medium">
                {isProcessing ? <><Loader2 className="size-5 animate-spin" />Processing…</> : <><Play className="size-5" />Detect Anomalies</>}
              </button>
            </div>

            <div className="mt-5 p-4 bg-purple-50 border border-purple-200 rounded-lg space-y-1">
              <p className="text-sm text-purple-800"><strong>Algorithm:</strong> Isolation Forest (sklearn)</p>
              <p className="text-sm text-purple-800">
                {anomalyConfig.multivariate
                  ? 'Fits an ensemble of random isolation trees across all selected features simultaneously — catches anomalies invisible in any single dimension.'
                  : 'Partitions values with random cuts; points requiring few cuts are outliers.'}
              </p>
            </div>

            {anomalyData.length > 0 && (
              <div className="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <p className="text-sm font-bold text-orange-900">
                  {anomalyData.filter(d => d.isAnomaly).length} anomalies detected
                </p>
                <p className="text-sm text-orange-700 mt-0.5">
                  out of {anomalyResult?.total_points ?? anomalyData.length} total points
                  {anomalyResult?.stats?.anomaly_pct != null && (
                    <> · <strong>{anomalyResult.stats.anomaly_pct}%</strong></>
                  )}
                </p>
                {anomalyResult?.multivariate && anomalyResult?.feature_cols && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {anomalyResult.feature_cols.map((f: string) => (
                      <span key={f} className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Results panel ── */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <h3 className="font-bold text-gray-900">
                {anomalyResult?.multivariate ? 'Multivariate Anomaly Results' : 'Anomaly Detection Results'}
              </h3>
              {anomalyData.length > 0 && (
                <div className="ml-auto flex items-center gap-2">
                  {saveDialogOpen ? (
                    <>
                      <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveSnapshot(); if (e.key === 'Escape') setSaveDialogOpen(false); }}
                        placeholder="Snapshot name…"
                        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-purple-400" />
                      <button onClick={handleSaveSnapshot} disabled={snapshotSaving || !saveName.trim()}
                        className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
                        {snapshotSaving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} Save
                      </button>
                      <button onClick={() => setSaveDialogOpen(false)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">✕</button>
                    </>
                  ) : (
                    <button onClick={() => { setSaveDialogOpen(true); setSaveName(''); }}
                      className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 hover:bg-purple-50 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors">
                      <Save className="size-3" /> Save snapshot
                    </button>
                  )}
                </div>
              )}
            </div>

            {anomalyData.length > 0 ? (
              <>
                {/* ── Univariate: simple index vs value scatter ── */}
                {!anomalyResult?.multivariate && (
                  <ResponsiveContainer width="100%" height={380}>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="index" name="Index" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="value" name="Value" tick={{ fontSize: 11 }} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }}
                        content={({ payload }) => {
                          if (!payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-white border border-gray-200 rounded-lg shadow px-3 py-2 text-xs">
                              <p className={`font-semibold mb-1 ${d.isAnomaly ? 'text-red-600' : 'text-purple-600'}`}>
                                {d.isAnomaly ? '⚠ Anomaly' : '● Normal'}
                              </p>
                              <p>Index: <strong>{d.index}</strong></p>
                              <p>Value: <strong>{Number(d.value).toLocaleString(undefined, { maximumFractionDigits: 3 })}</strong></p>
                            </div>
                          );
                        }}
                      />
                      <Legend />
                      <Scatter name="Normal" data={anomalyData.filter(d => !d.isAnomaly)} fill="#8b5cf6" fillOpacity={0.6} r={3} />
                      <Scatter name="Anomaly" data={anomalyData.filter(d => d.isAnomaly)} fill="#ef4444" fillOpacity={0.9} r={5} />
                    </ScatterChart>
                  </ResponsiveContainer>
                )}

                {/* ── Multivariate: scatter matrix (all column pairs) ── */}
                {anomalyResult?.multivariate && anomalyResult?.pairs?.length > 0 && (() => {
                  const pairs: { x: string; y: string }[] = anomalyResult.pairs;
                  const normal   = anomalyData.filter(d => !d.isAnomaly);
                  const outliers = anomalyData.filter(d =>  d.isAnomaly);
                  return (
                    <div>
                      <p className="text-xs text-gray-400 mb-3">
                        {pairs.length} pair{pairs.length > 1 ? 's' : ''} · {outliers.length} anomalies highlighted in red
                        — hover for anomaly score
                      </p>
                      <div className={`grid gap-4 ${pairs.length === 1 ? 'grid-cols-1' : pairs.length <= 3 ? 'grid-cols-2' : 'grid-cols-2 xl:grid-cols-3'}`}>
                        {pairs.map(({ x: xCol, y: yCol }) => (
                          <div key={`${xCol}-${yCol}`} className="border border-gray-100 rounded-xl p-2 bg-gray-50/50">
                            <p className="text-xs font-medium text-gray-500 text-center mb-1">{xCol} × {yCol}</p>
                            <ResponsiveContainer width="100%" height={220}>
                              <ScatterChart margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis type="number" dataKey={xCol} name={xCol} tick={{ fontSize: 10 }}
                                  label={{ value: xCol, position: 'insideBottom', offset: -10, fontSize: 10 }} />
                                <YAxis type="number" dataKey={yCol} name={yCol} tick={{ fontSize: 10 }}
                                  label={{ value: yCol, angle: -90, position: 'insideLeft', fontSize: 10 }} />
                                <Tooltip cursor={{ strokeDasharray: '3 3' }}
                                  content={({ payload }) => {
                                    if (!payload?.length) return null;
                                    const d = payload[0].payload;
                                    return (
                                      <div className="bg-white border border-gray-200 rounded-lg shadow px-3 py-2 text-xs">
                                        <p className={`font-semibold mb-1 ${d.isAnomaly ? 'text-red-600' : 'text-purple-600'}`}>
                                          {d.isAnomaly ? '⚠ Anomaly' : '● Normal'}
                                        </p>
                                        <p>{xCol}: <strong>{Number(d[xCol]).toLocaleString(undefined, { maximumFractionDigits: 3 })}</strong></p>
                                        <p>{yCol}: <strong>{Number(d[yCol]).toLocaleString(undefined, { maximumFractionDigits: 3 })}</strong></p>
                                        {d.anomalyScore != null && (
                                          <p className="mt-1 text-orange-600">Score: <strong>{(d.anomalyScore * 100).toFixed(1)}%</strong></p>
                                        )}
                                      </div>
                                    );
                                  }}
                                />
                                <Scatter name="Normal"  data={normal.map(d => ({ ...d, [xCol]: d[xCol], [yCol]: d[yCol] }))}
                                  fill="#8b5cf6" fillOpacity={0.45} r={2.5} />
                                <Scatter name="Anomaly" data={outliers.map(d => ({ ...d, [xCol]: d[xCol], [yCol]: d[yCol] }))}
                                  fill="#ef4444" fillOpacity={0.85} r={5}
                                  shape={(props: any) => {
                                    const { cx, cy } = props;
                                    return (
                                      <g>
                                        <circle cx={cx} cy={cy} r={6} fill="#ef4444" fillOpacity={0.15} stroke="#ef4444" strokeWidth={1.5} />
                                        <circle cx={cx} cy={cy} r={3} fill="#ef4444" />
                                      </g>
                                    );
                                  }} />
                              </ScatterChart>
                            </ResponsiveContainer>
                          </div>
                        ))}
                      </div>

                      {/* Anomaly score distribution */}
                      {outliers.length > 0 && (
                        <div className="mt-5 border-t border-gray-100 pt-4">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Top anomalies by score</p>
                          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                            {[...outliers]
                              .sort((a, b) => (b.anomalyScore ?? 0) - (a.anomalyScore ?? 0))
                              .slice(0, 20)
                              .map((d, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                  <span className="text-gray-400 w-6 text-right flex-shrink-0">#{d.index}</span>
                                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                                    <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-red-500"
                                      style={{ width: `${((d.anomalyScore ?? 0) * 100).toFixed(1)}%` }} />
                                  </div>
                                  <span className="text-orange-600 font-medium w-10 text-right flex-shrink-0">
                                    {((d.anomalyScore ?? 0) * 100).toFixed(0)}%
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            ) : (
              <div className="flex items-center justify-center h-96 text-gray-400">
                <div className="text-center">
                  <Activity className="size-16 mx-auto mb-3 text-gray-300" />
                  <p>Configure and run anomaly detection to see results</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Correlation Analysis */}
      {activeTab === 'correlation' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Correlation Configuration</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Table
                </label>
                <select
                  value={correlationConfig.table}
                  onChange={(e) => setCorrelationConfig({ ...correlationConfig, table: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {tables.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Columns (comma-separated)
                </label>
                <div className="flex flex-wrap gap-2">
                  {correlationColumnsList.map(c => (
                    <label key={c} className="flex items-center gap-2 p-2 border rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={correlationConfig.columns.includes(c)}
                        onChange={(e) => {
                          const newCols = e.target.checked
                            ? [...correlationConfig.columns, c]
                            : correlationConfig.columns.filter(col => col !== c);
                          setCorrelationConfig({ ...correlationConfig, columns: newCols });
                        }}
                      />
                      <span className="text-sm">{c}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Method
                </label>
                <select
                  value={correlationConfig.method}
                  onChange={(e) => setCorrelationConfig({ ...correlationConfig, method: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="pearson">Pearson</option>
                  <option value="spearman">Spearman</option>
                  <option value="kendall">Kendall Tau</option>
                </select>
              </div>

              <button
                onClick={handleRunCorrelation}
                disabled={isProcessing}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors font-medium"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="size-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="size-5" />
                    Calculate Correlation
                  </>
                )}
              </button>
            </div>

            <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <p className="text-sm text-purple-800">
                <strong>Interpretation:</strong>
              </p>
              <ul className="text-sm text-purple-800 mt-2 space-y-1">
                <li>• 1.0 = Perfect positive correlation</li>
                <li>• 0.0 = No correlation</li>
                <li>• -1.0 = Perfect negative correlation</li>
              </ul>
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <h3 className="font-bold text-gray-900">Correlation Heatmap</h3>
              {correlationData.length > 0 && (
                <div className="ml-auto flex items-center gap-2">
                  {saveDialogOpen ? (
                    <>
                      <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveSnapshot(); if (e.key === 'Escape') setSaveDialogOpen(false); }}
                        placeholder="Snapshot name…"
                        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-purple-400" />
                      <button onClick={handleSaveSnapshot} disabled={snapshotSaving || !saveName.trim()}
                        className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
                        {snapshotSaving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} Save
                      </button>
                      <button onClick={() => setSaveDialogOpen(false)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">✕</button>
                    </>
                  ) : (
                    <button onClick={() => { setSaveDialogOpen(true); setSaveName(''); }}
                      className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 hover:bg-purple-50 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors">
                      <Save className="size-3" /> Save snapshot
                    </button>
                  )}
                </div>
              )}
            </div>

            {correlationData.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="p-2 border border-gray-300 bg-gray-50"></th>
                      {correlationColumns.map((col) => (
                        <th key={col} className="p-2 border border-gray-300 bg-gray-50 text-xs font-medium text-gray-700">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {correlationData.map((row, i) => (
                      <tr key={i}>
                        <td className="p-2 border border-gray-300 bg-gray-50 text-xs font-medium text-gray-700 whitespace-nowrap">
                          {correlationColumns[i]}
                        </td>
                        {row.map((value, j) => {
                          const isDiag = i === j;
                          const isActive = drillDown?.col1 === correlationColumns[i] && drillDown?.col2 === correlationColumns[j]
                                        || drillDown?.col1 === correlationColumns[j] && drillDown?.col2 === correlationColumns[i];
                          return (
                            <td
                              key={j}
                              style={getCellStyle(value)}
                              onClick={() => !isDiag && handleCellClick(correlationColumns[i], correlationColumns[j], value)}
                              className={`p-4 border border-gray-200 text-center font-bold text-sm select-none
                                ${!isDiag ? 'hover:brightness-90 active:brightness-75' : ''}
                                ${isActive ? 'ring-2 ring-inset ring-purple-500' : ''}
                              `}
                              title={isDiag ? correlationColumns[i] : `${correlationColumns[i]} × ${correlationColumns[j]}: ${value.toFixed(3)}\nClick to explore`}
                            >
                              {value.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Smooth gradient legend */}
                <div className="mt-6 flex items-center gap-3 justify-center">
                  <span className="text-xs text-gray-500 font-medium">−1</span>
                  <div
                    className="h-3 rounded-full flex-1 max-w-xs"
                    style={{ background: 'linear-gradient(to right, rgb(220,38,38), rgb(255,255,255), rgb(22,163,74))' }}
                  />
                  <span className="text-xs text-gray-500 font-medium">+1</span>
                </div>
                <p className="text-center text-xs text-gray-400 mt-2">Click any off-diagonal cell to explore a scatter plot</p>

                {/* Drill-down scatter panel */}
                {(drillLoading || drillDown) && (
                  <div className="mt-6 border-t border-gray-100 pt-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <span className="font-semibold text-sm text-gray-800">
                          {drillDown ? `${drillDown.col1} × ${drillDown.col2}` : 'Loading…'}
                        </span>
                        {drillDown && (
                          <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${
                            drillDown.r > 0.4 ? 'bg-green-100 text-green-700'
                            : drillDown.r < -0.4 ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                          }`}>
                            r = {drillDown.r.toFixed(3)}
                          </span>
                        )}
                      </div>
                      {drillDown && (
                        <button onClick={() => setDrillDown(null)}
                          className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">
                          ✕ Close
                        </button>
                      )}
                    </div>
                    {drillLoading && (
                      <div className="flex items-center justify-center h-48 text-gray-400">
                        <Loader2 className="size-6 animate-spin mr-2" /> Loading scatter data…
                      </div>
                    )}
                    {drillDown && drillDown.data.length > 0 && (
                      <>
                        <p className="text-xs text-gray-400 mb-2">{drillDown.data.length.toLocaleString()} points</p>
                        <ResponsiveContainer width="100%" height={300}>
                          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis type="number" dataKey="x" name={drillDown.col1}
                              tick={{ fontSize: 11 }}
                              label={{ value: drillDown.col1, position: 'insideBottom', offset: -10, fontSize: 11 }} />
                            <YAxis type="number" dataKey="y" name={drillDown.col2}
                              tick={{ fontSize: 11 }}
                              label={{ value: drillDown.col2, angle: -90, position: 'insideLeft', fontSize: 11 }} />
                            <Tooltip
                              cursor={{ strokeDasharray: '3 3' }}
                              content={({ payload }) => {
                                if (!payload?.length) return null;
                                const d = payload[0].payload;
                                return (
                                  <div className="bg-white border border-gray-200 rounded-lg shadow px-3 py-2 text-xs">
                                    <p>{drillDown.col1}: <strong>{Number(d.x).toLocaleString(undefined, { maximumFractionDigits: 3 })}</strong></p>
                                    <p>{drillDown.col2}: <strong>{Number(d.y).toLocaleString(undefined, { maximumFractionDigits: 3 })}</strong></p>
                                  </div>
                                );
                              }}
                            />
                            <Scatter
                              data={drillDown.data}
                              fill={drillDown.r >= 0 ? '#16a34a' : '#dc2626'}
                              fillOpacity={0.5}
                              r={3}
                            />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </>
                    )}
                    {drillDown && drillDown.data.length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-8">No numeric data found for these two columns.</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-96 text-gray-400">
                <div className="text-center">
                  <Grid3x3 className="size-16 mx-auto mb-3 text-gray-300" />
                  <p>Configure and run correlation analysis to see results</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Cluster Analysis ──────────────────────────────────────────────── */}
      {activeTab === 'cluster' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Config panel */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Cluster Configuration</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Table</label>
                <select value={clusterConfig.table}
                  onChange={e => setClusterConfig((p: any) => ({ ...p, table: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  {tables.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">X Axis (numeric)</label>
                <select value={clusterConfig.xColumn}
                  onChange={e => setClusterConfig((p: any) => ({ ...p, xColumn: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="">Select column…</option>
                  {clusterColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Y Axis (numeric)</label>
                <select value={clusterConfig.yColumn}
                  onChange={e => setClusterConfig((p: any) => ({ ...p, yColumn: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="">Select column…</option>
                  {clusterColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Number of clusters: <span className="font-bold text-purple-700">{clusterConfig.nClusters}</span>
                </label>
                <input type="range" min={2} max={8} step={1}
                  value={clusterConfig.nClusters}
                  onChange={e => setClusterConfig((p: any) => ({ ...p, nClusters: Number(e.target.value) }))}
                  className="w-full accent-purple-600" />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  {[2,3,4,5,6,7,8].map(n => <span key={n}>{n}</span>)}
                </div>
              </div>

              <button onClick={handleRunCluster} disabled={isProcessing || !clusterConfig.xColumn || !clusterConfig.yColumn}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors font-medium">
                {isProcessing ? <><Loader2 className="size-5 animate-spin" />Processing…</> : <><Play className="size-5" />Run Clustering</>}
              </button>
            </div>

            <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <p className="text-sm text-purple-800"><strong>Algorithm:</strong> K-Means (scikit-learn)</p>
              <p className="text-sm text-purple-800 mt-1">Points are normalised before clustering. Centroids shown as ✕ markers.</p>
            </div>

            {/* Cluster size legend */}
            {clusterData?.cluster_sizes && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cluster sizes</p>
                {Object.entries(clusterData.cluster_sizes as Record<string, number>).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                      style={{ background: CLUSTER_COLORS[Number(k) % CLUSTER_COLORS.length] }} />
                    <span className="text-xs text-gray-600">Cluster {Number(k)+1}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full rounded-full" style={{
                        width: `${Math.round(v / clusterData.stats.n_points * 100)}%`,
                        background: CLUSTER_COLORS[Number(k) % CLUSTER_COLORS.length]
                      }} />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chart panel */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="font-bold text-gray-900">Cluster Scatter Plot</h3>
              {clusterData?.points?.length > 0 && (
                <div className="ml-auto flex items-center gap-2">
                  {saveDialogOpen ? (
                    <>
                      <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveSnapshot(); if (e.key === 'Escape') setSaveDialogOpen(false); }}
                        placeholder="Snapshot name…"
                        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-purple-400" />
                      <button onClick={handleSaveSnapshot} disabled={snapshotSaving || !saveName.trim()}
                        className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
                        {snapshotSaving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} Save
                      </button>
                      <button onClick={() => setSaveDialogOpen(false)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">✕</button>
                    </>
                  ) : (
                    <button onClick={() => { setSaveDialogOpen(true); setSaveName(''); }}
                      className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 hover:bg-purple-50 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors">
                      <Save className="size-3" /> Save snapshot
                    </button>
                  )}
                </div>
              )}
            </div>
            {clusterData?.points?.length > 0 ? (
              <>
                <p className="text-xs text-gray-400 mb-4">
                  {clusterData.stats.n_points.toLocaleString()} points · {clusterData.n_clusters} clusters ·
                  inertia {clusterData.stats.inertia?.toLocaleString()}
                </p>
                <ResponsiveContainer width="100%" height={380}>
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" dataKey="x" name={clusterConfig.xColumn}
                      tick={{ fontSize: 11 }} label={{ value: clusterConfig.xColumn, position: 'insideBottom', offset: -10, fontSize: 11 }} />
                    <YAxis type="number" dataKey="y" name={clusterConfig.yColumn}
                      tick={{ fontSize: 11 }} label={{ value: clusterConfig.yColumn, angle: -90, position: 'insideLeft', fontSize: 11 }} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }}
                      content={({ payload }) => {
                        if (!payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                            <p className="font-semibold mb-1" style={{ color: CLUSTER_COLORS[d.cluster % CLUSTER_COLORS.length] }}>
                              Cluster {d.cluster + 1}
                            </p>
                            <p>{clusterConfig.xColumn}: <strong>{Number(d.x).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></p>
                            <p>{clusterConfig.yColumn}: <strong>{Number(d.y).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></p>
                          </div>
                        );
                      }}
                    />
                    {/* One Scatter series per cluster */}
                    {Array.from({ length: clusterData.n_clusters }, (_, k) => (
                      <Scatter
                        key={k}
                        name={`Cluster ${k + 1}`}
                        data={clusterData.points.filter((p: any) => p.cluster === k)}
                        fill={CLUSTER_COLORS[k % CLUSTER_COLORS.length]}
                        fillOpacity={0.65}
                        r={3}
                      />
                    ))}
                    {/* Centroids as larger markers */}
                    <Scatter
                      name="Centroids"
                      data={clusterData.centroids.map((c: any) => ({ ...c, isCentroid: true }))}
                      shape={(props: any) => {
                        const { cx, cy, payload } = props;
                        const color = CLUSTER_COLORS[payload.cluster % CLUSTER_COLORS.length];
                        return (
                          <g>
                            <line x1={cx-7} y1={cy} x2={cx+7} y2={cy} stroke={color} strokeWidth={2.5} />
                            <line x1={cx} y1={cy-7} x2={cx} y2={cy+7} stroke={color} strokeWidth={2.5} />
                            <circle cx={cx} cy={cy} r={5} fill="white" stroke={color} strokeWidth={2} />
                          </g>
                        );
                      }}
                      fill="#fff"
                    />
                    <Legend />
                  </ScatterChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="flex items-center justify-center h-96 text-gray-400">
                <div className="text-center">
                  <Layers className="size-16 mx-auto mb-3 text-gray-300" />
                  <p>Select columns and run clustering to see results</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── AI Insights panel (shown when insights exist for active tab) ──── */}
      {insights[activeTab]?.length > 0 && (
        <div className="mt-6 bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setInsightsOpen(v => !v)}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-violet-100/50 transition-colors"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Sparkles className="size-4 text-violet-600 flex-shrink-0" />
              <span className="font-semibold text-sm text-violet-800">AI Insights</span>
              <span className="text-xs text-violet-500 bg-violet-200/70 px-2 py-0.5 rounded-full ml-1">
                {insights[activeTab].length} observations
              </span>
            </div>
            {insightLoading
              ? <Loader2 className="size-4 text-violet-500 animate-spin flex-shrink-0" />
              : insightsOpen
                ? <ChevronUp className="size-4 text-violet-500 flex-shrink-0" />
                : <ChevronDown className="size-4 text-violet-500 flex-shrink-0" />
            }
          </button>
          {insightsOpen && (
            <div className="px-5 pb-5 grid gap-3 sm:grid-cols-3">
              {insights[activeTab].map((insight, i) => (
                <div key={i} className="bg-white rounded-lg border border-violet-100 px-4 py-3 shadow-sm">
                  <div className="flex gap-2">
                    <span className="text-violet-500 font-bold text-sm flex-shrink-0 mt-0.5">{i + 1}.</span>
                    <p className="text-sm text-gray-700 leading-relaxed">{insight}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loading shimmer while insights are being fetched */}
      {insightLoading && !insights[activeTab]?.length && (
        <div className="mt-6 bg-violet-50 border border-violet-200 rounded-xl px-5 py-4 flex items-center gap-3">
          <Loader2 className="size-4 text-violet-500 animate-spin flex-shrink-0" />
          <span className="text-sm text-violet-600">Generating AI insights…</span>
        </div>
      )}

      {/* ── Saved Snapshots panel ─────────────────────────────────────────── */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setSnapshotsOpen(v => !v)}
          className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <BookOpen className="size-4 text-gray-500 flex-shrink-0" />
            <span className="font-semibold text-sm text-gray-700">Saved Snapshots</span>
            {snapshots.length > 0 && (
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full ml-1">
                {snapshots.length}
              </span>
            )}
          </div>
          {snapshotsLoading
            ? <Loader2 className="size-4 text-gray-400 animate-spin flex-shrink-0" />
            : snapshotsOpen
              ? <ChevronUp className="size-4 text-gray-400 flex-shrink-0" />
              : <ChevronDown className="size-4 text-gray-400 flex-shrink-0" />
          }
        </button>

        {snapshotsOpen && (
          <div className="border-t border-gray-100 px-5 py-4">
            {snapshots.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">
                No snapshots saved for {activeTab} yet. Run an analysis and click <strong>Save snapshot</strong>.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {snapshots.map((snap) => (
                  <div key={snap.id} className="flex items-center gap-3 py-3 group">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{snap.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {snap.engine && (
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                            snap.engine === 'prophet' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                          }`}>
                            {snap.engine}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Clock className="size-3" />
                          {new Date(snap.updated_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleLoadSnapshot(snap)}
                        title="Load snapshot"
                        className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 hover:bg-purple-50 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
                      >
                        <BookOpen className="size-3" /> Load
                      </button>
                      <button
                        onClick={() => handleDeleteSnapshot(snap.id)}
                        title="Delete snapshot"
                        className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
