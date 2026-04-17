import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSessionStorage } from '../../hooks/useSessionStorage';
import { TrendingUp, Activity, Grid3x3, Play, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface AdvancedAnalyticsProps {
  apiKey: string;
}

type AnalyticsTab = 'forecast' | 'anomaly' | 'correlation';

export function AdvancedAnalytics({ }: AdvancedAnalyticsProps) {
  const [activeTab, setActiveTab] = useSessionStorage<AnalyticsTab>('advanced_analytics_activeTab', 'forecast');
  const [isProcessing, setIsProcessing] = useState(false);
  const [forecastData, setForecastData] = useSessionStorage<any[]>('advanced_analytics_forecastData', []);
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
  });

  // Correlation configuration
  const [correlationConfig, setCorrelationConfig] = useSessionStorage('advanced_analytics_correlationConfig', {
    table: 'sales',
    columns: ['revenue', 'quantity', 'profit', 'discount'],
    method: 'pearson',
  });

  const [tables, setTables] = useState<string[]>([]);
  const [forecastColumns, setForecastColumns] = useState<string[]>([]);
  const [anomalyColumns, setAnomalyColumns] = useState<string[]>([]);
  const [correlationColumnsList, setCorrelationColumnsList] = useState<string[]>([]);

  useEffect(() => {
    fetchTables();
  }, []);

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

      // Handle multiple server response formats
      let chartData: any[] = [];
      if (Array.isArray(resp)) {
        chartData = resp;
      } else if (resp && resp.historical && resp.forecast) {
        const hist = resp.historical;
        const fcast = resp.forecast;
        const histDates: string[] = hist.dates || [];
        const histVals: number[] = hist.values || [];
        const fcastDates: string[] = fcast.dates || [];
        const fcastVals: number[] = fcast.values || [];
        const merged: Record<string, any> = {};
        histDates.forEach((d, i) => {
          merged[d] = { date: d, actual: histVals[i] };
        });
        fcastDates.forEach((d, i) => {
          if (merged[d]) {
            merged[d].forecast = fcastVals[i];
          } else {
            merged[d] = { date: d, forecast: fcastVals[i] };
          }
        });
        chartData = Object.values(merged).sort((a: any, b: any) => a.date.localeCompare(b.date));
      }

      setForecastData(chartData);
    } catch (err: any) {
      console.error(err);
      alert(`Forecast failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [forecastConfig, setForecastData]);

  const handleRunAnomalyDetection = async () => {
    if (!anomalyConfig.table || !anomalyConfig.valueColumn) return;
    setIsProcessing(true);

    try {
      const resp = await api.post<any>('/analytics/anomaly', {
        table_name: anomalyConfig.table,
        value_column: anomalyConfig.valueColumn,
        contamination: anomalyConfig.contamination
      });

      // Handle multiple server response formats
      let plotData: any[] = [];
      if (resp && (resp.data || resp.anomalies)) {
        const raw = resp.data ?? resp.anomalies;
        if (Array.isArray(raw)) {
          // Format: [{index, value, isAnomaly}, ...]
          plotData = raw;
        } else if (typeof raw === 'object') {
          // Format: {index: value, ...} dict — anomalies only (no normal points)
          // We need to mark these as anomalies and infer a full dataset
          // Fallback: show only anomaly points
          plotData = Object.entries(raw).map(([idx, val]: [string, any]) => ({
            index: parseInt(idx),
            value: typeof val === 'object' ? val.value ?? val : val,
            isAnomaly: true
          })).sort((a, b) => a.index - b.index);
        }
      } else if (Array.isArray(resp)) {
        plotData = resp;
      }

      setAnomalyData(plotData);
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
      // Handle both 'correlation_matrix' and 'matrix' key names
      const cols: string[] = resp.columns || correlationConfig.columns;
      const matrix: number[][] = resp.correlation_matrix ?? resp.matrix ?? [];
      setCorrelationColumns(cols);
      setCorrelationData(matrix);
    } catch (err: any) {
      console.error(err);
      alert(`Correlation analysis failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const getCorrelationColor = (value: number) => {
    const absValue = Math.abs(value);
    if (absValue > 0.7) return value > 0 ? 'bg-green-600' : 'bg-red-600';
    if (absValue > 0.4) return value > 0 ? 'bg-green-400' : 'bg-red-400';
    if (absValue > 0.2) return value > 0 ? 'bg-green-200' : 'bg-red-200';
    return 'bg-gray-100';
  };

  const tabs = useMemo(() => [
    { id: 'forecast', label: 'Time Series Forecast', icon: TrendingUp },
    { id: 'anomaly', label: 'Anomaly Detection', icon: Activity },
    { id: 'correlation', label: 'Correlation Analysis', icon: Grid3x3 },
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

            <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <p className="text-sm text-purple-800">
                <strong>Algorithm:</strong> Holt-Winters Exponential Smoothing
              </p>
              <p className="text-sm text-purple-800 mt-2">
                Minimum 10 data points required for accurate forecasting.
              </p>
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Forecast Results</h3>

            {forecastData.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={forecastData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    name="Historical Data"
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast"
                    stroke="#10b981"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    name="Forecast"
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="upper"
                    stroke="#d1d5db"
                    strokeWidth={1}
                    name="Upper Bound"
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="lower"
                    stroke="#d1d5db"
                    strokeWidth={1}
                    name="Lower Bound"
                    connectNulls
                  />
                </LineChart>
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
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Anomaly Configuration</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Table
                </label>
                <select
                  value={anomalyConfig.table}
                  onChange={(e) => setAnomalyConfig({ ...anomalyConfig, table: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {tables.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Value Column
                </label>
                <select
                  value={anomalyConfig.valueColumn}
                  onChange={(e) => setAnomalyConfig({ ...anomalyConfig, valueColumn: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">Select column...</option>
                  {anomalyColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contamination Factor ({anomalyConfig.contamination})
                </label>
                <input
                  type="range"
                  value={anomalyConfig.contamination}
                  onChange={(e) => setAnomalyConfig({ ...anomalyConfig, contamination: parseFloat(e.target.value) })}
                  className="w-full"
                  min="0.01"
                  max="0.5"
                  step="0.01"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Expected proportion of outliers
                </p>
              </div>

              <button
                onClick={handleRunAnomalyDetection}
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
                    Detect Anomalies
                  </>
                )}
              </button>
            </div>

            <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <p className="text-sm text-purple-800">
                <strong>Algorithm:</strong> Isolation Forest
              </p>
              <p className="text-sm text-purple-800 mt-2">
                Identifies statistical outliers and irregular patterns.
              </p>
            </div>

            {anomalyData.length > 0 && (
              <div className="mt-6 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <p className="text-sm font-bold text-orange-900">
                  Anomalies Detected: {anomalyData.filter(d => d.isAnomaly).length}
                </p>
                <p className="text-sm text-orange-800 mt-1">
                  Out of {anomalyData.length} total data points
                </p>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Anomaly Detection Results</h3>

            {anomalyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="index" name="Index" />
                  <YAxis dataKey="value" name="Value" />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Legend />
                  <Scatter
                    name="Normal Data"
                    data={anomalyData.filter(d => !d.isAnomaly)}
                    fill="#8b5cf6"
                  />
                  <Scatter
                    name="Anomalies"
                    data={anomalyData.filter(d => d.isAnomaly)}
                    fill="#ef4444"
                  />
                </ScatterChart>
              </ResponsiveContainer>
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
            <h3 className="font-bold text-gray-900 mb-4">Correlation Heatmap</h3>

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
                        <td className="p-2 border border-gray-300 bg-gray-50 text-xs font-medium text-gray-700">
                          {correlationColumns[i]}
                        </td>
                        {row.map((value, j) => (
                          <td
                            key={j}
                            className={`p-4 border border-gray-300 text-center text-white font-bold ${getCorrelationColor(value)}`}
                          >
                            {value.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex items-center justify-center gap-6 mt-6">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-red-600 rounded"></div>
                    <span className="text-sm text-gray-600">Strong Negative</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-gray-100 rounded"></div>
                    <span className="text-sm text-gray-600">No Correlation</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-green-600 rounded"></div>
                    <span className="text-sm text-gray-600">Strong Positive</span>
                  </div>
                </div>
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
    </div>
  );
}
