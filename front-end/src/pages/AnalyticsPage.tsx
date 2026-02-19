
import React, { useState, useEffect } from 'react';
import { BarChart2, AlertTriangle, TrendingUp } from 'lucide-react';
import { api } from '../services/api';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    ComposedChart, Scatter
} from 'recharts';

export const AnalyticsPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'forecast' | 'anomaly' | 'correlation'>('forecast');
    const [apiKey] = useState(localStorage.getItem('vantage_api_key'));
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [tables, setTables] = useState<string[]>([]);
    const [schemas, setSchemas] = useState<Record<string, any[]>>({});

    // Forecast State
    const [forecastForm, setForecastForm] = useState({
        table_name: '',
        date_column: '',
        value_column: '',
        periods: 30
    });
    const [forecastData, setForecastData] = useState<any>(null);

    // Anomaly State
    const [anomalyForm, setAnomalyForm] = useState({
        table_name: '',
        value_column: '',
        contamination: 0.05
    });
    const [anomalyData, setAnomalyData] = useState<any>(null);

    // Correlation State
    const [correlationForm, setCorrelationForm] = useState({
        table_name: '',
        columns: [] as string[],
        method: 'pearson'
    });
    const [correlationData, setCorrelationData] = useState<any>(null);

    useEffect(() => {
        const fetchTables = async () => {
            if (!apiKey) return;
            try {
                const data = await api.getTables(apiKey);
                setTables(data.tables);
                setSchemas(data.schemas);
                if (data.tables.length > 0) {
                    const defaultTable = data.tables[0];
                    setForecastForm(prev => ({ ...prev, table_name: defaultTable }));
                    setAnomalyForm(prev => ({ ...prev, table_name: defaultTable }));
                    setCorrelationForm(prev => ({ ...prev, table_name: defaultTable }));
                }
            } catch (e) {
                console.error("Failed to fetch tables", e);
            }
        };
        fetchTables();
    }, [apiKey]);


    const handleForecast = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!apiKey) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await api.getForecast({
                ...forecastForm,
                freq: 'D' // Default to daily for UI simplicity
            }, apiKey);

            // Format data for Recharts
            // historical: {dates: [], values: []}
            // forecast: {dates: [], values: []}

            const chartData = [];
            // Combine historical
            if (data.historical) {
                data.historical.dates.forEach((date: string, i: number) => {
                    chartData.push({
                        date,
                        historical: data.historical.values[i],
                        forecast: null
                    });
                });
            }
            // Combine forecast
            if (data.forecast) {
                data.forecast.dates.forEach((date: string, i: number) => {
                    chartData.push({
                        date,
                        historical: null,
                        forecast: data.forecast.values[i]
                    });
                });
            }
            setForecastData(chartData);
        } catch (e: any) {
            setError(e.message || 'Forecast failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAnomaly = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!apiKey) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await api.getAnomalies(anomalyForm, apiKey);
            // data: { anomalies: {indices: [], values: []}, total_points: X, anomaly_count: Y }

            const chartData = data.anomalies.indices.map((idx: any, i: number) => ({
                index: idx,
                value: data.anomalies.values[i]
            }));

            setAnomalyData({ stats: data, chartData });
        } catch (e: any) {
            setError(e.message || 'Anomaly detection failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCorrelation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!apiKey) return;
        setIsLoading(true);
        setError(null);
        try {
            // If no columns selected, send empty list (backend will use all numeric)
            const data = await api.getCorrelation(correlationForm, apiKey);
            setCorrelationData(data);
        } catch (e: any) {
            setError(e.message || 'Correlation failed');
        } finally {
            setIsLoading(false);
        }
    };

    // Helper to toggle columns in multi-select (simple implementation)
    const toggleColumn = (col: string) => {
        setCorrelationForm(prev => {
            if (prev.columns.includes(col)) {
                return { ...prev, columns: prev.columns.filter(c => c !== col) };
            } else {
                return { ...prev, columns: [...prev.columns, col] };
            }
        });
    };

    return (
        <div className="analytics-page">
            <h1 className="page-title">Analytics Dashboard</h1>

            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'forecast' ? 'active' : ''}`}
                    onClick={() => setActiveTab('forecast')}
                >
                    <TrendingUp size={16} /> Forecast
                </button>
                <button
                    className={`tab ${activeTab === 'anomaly' ? 'active' : ''}`}
                    onClick={() => setActiveTab('anomaly')}
                >
                    <AlertTriangle size={16} /> Anomaly Detection
                </button>
                <button
                    className={`tab ${activeTab === 'correlation' ? 'active' : ''}`}
                    onClick={() => setActiveTab('correlation')}
                >
                    <BarChart2 size={16} /> Correlation
                </button>
            </div>

            <div className="content-area">
                {error && <div className="error-message">{error}</div>}

                {activeTab === 'forecast' && (
                    <div className="analysis-view">
                        <div className="controls">
                            <h3>Time Series Forecasting</h3>
                            <form onSubmit={handleForecast} className="controls-form">
                                <select
                                    value={forecastForm.table_name}
                                    onChange={e => setForecastForm({ ...forecastForm, table_name: e.target.value })}
                                    required
                                >
                                    <option value="" disabled>Select Table</option>
                                    {tables.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <select
                                    value={forecastForm.date_column}
                                    onChange={e => setForecastForm({ ...forecastForm, date_column: e.target.value })}
                                    required
                                >
                                    <option value="" disabled>Select Date Column</option>
                                    {schemas[forecastForm.table_name]?.map((col: any) => (
                                        <option key={col[0]} value={col[0]}>{col[0]} ({col[1]})</option>
                                    ))}
                                </select>
                                <select
                                    value={forecastForm.value_column}
                                    onChange={e => setForecastForm({ ...forecastForm, value_column: e.target.value })}
                                    required
                                >
                                    <option value="" disabled>Select Value Column</option>
                                    {schemas[forecastForm.table_name]?.map((col: any) => (
                                        <option key={col[0]} value={col[0]}>{col[0]} ({col[1]})</option>
                                    ))}
                                </select>
                                <input
                                    type="number"
                                    placeholder="Periods (30)"
                                    value={forecastForm.periods}
                                    onChange={e => setForecastForm({ ...forecastForm, periods: parseInt(e.target.value) })}
                                />
                                <button type="submit" disabled={isLoading}>
                                    {isLoading ? 'Running...' : 'Generate Forecast'}
                                </button>
                            </form>
                        </div>

                        <div className="chart-container">
                            {forecastData ? (
                                <ResponsiveContainer width="100%" height={400}>
                                    <ComposedChart data={forecastData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="date" />
                                        <YAxis />
                                        <Tooltip />
                                        <Legend />
                                        <Line type="monotone" dataKey="historical" stroke="#8884d8" name="Historical" dot={false} />
                                        <Line type="monotone" dataKey="forecast" stroke="#82ca9d" name="Forecast" strokeDasharray="5 5" />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="placeholder">Enter parameters to visualize forecast</div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'anomaly' && (
                    <div className="analysis-view">
                        <div className="controls">
                            <h3>Anomaly Detection</h3>
                            <form onSubmit={handleAnomaly} className="controls-form">
                                <select
                                    value={anomalyForm.table_name}
                                    onChange={e => setAnomalyForm({ ...anomalyForm, table_name: e.target.value })}
                                    required
                                >
                                    <option value="" disabled>Select Table</option>
                                    {tables.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <select
                                    value={anomalyForm.value_column}
                                    onChange={e => setAnomalyForm({ ...anomalyForm, value_column: e.target.value })}
                                    required
                                >
                                    <option value="" disabled>Select Value Column</option>
                                    {schemas[anomalyForm.table_name]?.map((col: any) => (
                                        <option key={col[0]} value={col[0]}>{col[0]} ({col[1]})</option>
                                    ))}
                                </select>
                                <input
                                    type="number"
                                    step="0.01"
                                    placeholder="Contamination (0.05)"
                                    value={anomalyForm.contamination}
                                    onChange={e => setAnomalyForm({ ...anomalyForm, contamination: parseFloat(e.target.value) })}
                                />
                                <button type="submit" disabled={isLoading}>
                                    {isLoading ? 'Running...' : 'Detect Anomalies'}
                                </button>
                            </form>
                        </div>

                        <div className="results-container">
                            {anomalyData ? (
                                <>
                                    <div className="stats-cards">
                                        <div className="card">
                                            <h4>Total Points</h4>
                                            <p>{anomalyData.stats.total_points}</p>
                                        </div>
                                        <div className="card warning">
                                            <h4>Anomalies Found</h4>
                                            <p>{anomalyData.stats.anomaly_count}</p>
                                        </div>
                                    </div>
                                    <div className="chart-container">
                                        <ResponsiveContainer width="100%" height={300}>
                                            <ComposedChart data={anomalyData.chartData}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="index" />
                                                <YAxis />
                                                <Tooltip />
                                                <Legend />
                                                <Scatter name="Anomalies" dataKey="value" fill="red" />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                </>
                            ) : (
                                <div className="placeholder">Enter parameters to detect anomalies</div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'correlation' && (
                    <div className="analysis-view">
                        <div className="controls">
                            <h3>Correlation Matrix</h3>
                            <form onSubmit={handleCorrelation} className="controls-form">
                                <select
                                    value={correlationForm.table_name}
                                    onChange={e => setCorrelationForm({ ...correlationForm, table_name: e.target.value, columns: [] })}
                                    required
                                >
                                    <option value="" disabled>Select Table</option>
                                    {tables.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>

                                <select
                                    value={correlationForm.method}
                                    onChange={e => setCorrelationForm({ ...correlationForm, method: e.target.value })}
                                >
                                    <option value="pearson">Pearson (Standard)</option>
                                    <option value="spearman">Spearman (Rank)</option>
                                    <option value="kendall">Kendall (Tau)</option>
                                </select>

                                <button type="submit" disabled={isLoading}>
                                    {isLoading ? 'Running...' : 'Generate Heatmap'}
                                </button>
                            </form>

                            {/* Column Selector (Multi toggle) */}
                            {correlationForm.table_name && (
                                <div className="column-selector">
                                    <h4>Select Columns (Optional - defaults to all numeric)</h4>
                                    <div className="tags-container">
                                        {schemas[correlationForm.table_name]?.map((col: any) => (
                                            <button
                                                type="button"
                                                key={col[0]}
                                                className={`tag ${correlationForm.columns.includes(col[0]) ? 'active' : ''}`}
                                                onClick={() => toggleColumn(col[0])}
                                            >
                                                {col[0]}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="results-container">
                            {correlationData ? (
                                <div className="heatmap-container">
                                    <div
                                        className="heatmap-grid"
                                        style={{
                                            gridTemplateColumns: `auto repeat(${correlationData.columns.length}, 1fr)`
                                        }}
                                    >
                                        {/* Header Row */}
                                        <div className="heatmap-cell header"></div>
                                        {correlationData.columns.map((col: string) => (
                                            <div key={col} className="heatmap-cell header" title={col}>{col}</div>
                                        ))}

                                        {/* Rows */}
                                        {correlationData.matrix.map((row: (number | null)[], i: number) => (
                                            <React.Fragment key={i}>
                                                <div className="heatmap-cell header" title={correlationData.columns[i]}>
                                                    {correlationData.columns[i]}
                                                </div>
                                                {row.map((val, j) => {
                                                    // Calculate color
                                                    // -1 (red) -> 0 (white) -> 1 (blue)
                                                    let bg = '#fff';
                                                    let color = '#000';
                                                    if (val !== null) {
                                                        if (val > 0) {
                                                            const intensity = Math.round(val * 255);
                                                            bg = `rgba(59, 130, 246, ${val})`; // Blue
                                                            color = val > 0.5 ? '#fff' : '#000';
                                                        } else {
                                                            const intensity = Math.round(Math.abs(val) * 255);
                                                            bg = `rgba(239, 68, 68, ${Math.abs(val)})`; // Red
                                                            color = Math.abs(val) > 0.5 ? '#fff' : '#000';
                                                        }
                                                    }

                                                    return (
                                                        <div
                                                            key={j}
                                                            className="heatmap-cell value"
                                                            style={{ backgroundColor: bg, color: color }}
                                                            title={`Correlation: ${val?.toFixed(4)}`}
                                                        >
                                                            {val?.toFixed(2)}
                                                        </div>
                                                    );
                                                })}
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="placeholder">Select parameters to generate correlation matrix</div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                .analytics-page {
                    padding: 2rem;
                    height: 100vh;
                    overflow-y: auto;
                    color: var(--text-primary);
                }
                .analysis-view {
                    display: flex;
                    flex-direction: column;
                    gap: 2rem;
                }
                .controls {
                    background-color: var(--bg-secondary);
                    padding: 1.5rem;
                    border-radius: 8px;
                }
                .controls-form {
                    display: flex;
                    gap: 1rem;
                    flex-wrap: wrap;
                    margin-top: 1rem;
                }
                .controls-form input,
                .controls-form select {
                    padding: 0.5rem;
                    border: 1px solid var(--color-border);
                    border-radius: 4px;
                    background-color: var(--card-bg);
                    color: var(--text-primary);
                }
                .controls-form button {
                    padding: 0.5rem 1rem;
                    background-color: var(--color-primary);
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                .chart-container {
                    background-color: var(--card-bg);
                    padding: 1rem;
                    border-radius: 8px;
                    border: 1px solid var(--color-border);
                    min-height: 400px;
                }
                .placeholder {
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--text-secondary);
                }
                .stats-cards {
                    display: flex;
                    gap: 1rem;
                }
                .card {
                    background-color: var(--card-bg);
                    padding: 1rem;
                    border-radius: 8px;
                    border: 1px solid var(--color-border);
                    flex: 1;
                }
                .card.warning {
                    border-color: #ef4444;
                    background-color: rgba(239, 68, 68, 0.05);
                }
                .error-message {
                    color: #ef4444;
                    padding: 1rem;
                    background-color: rgba(239, 68, 68, 0.1);
                    border-radius: 6px;
                    margin-bottom: 1rem;
                }
                .column-selector {
                    margin-top: 1rem;
                }
                .column-selector h4 {
                    font-size: 0.9rem;
                    margin-bottom: 0.5rem;
                    color: var(--text-secondary);
                }
                .tags-container {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.5rem;
                }
                .tag {
                    padding: 0.25rem 0.5rem;
                    border: 1px solid var(--color-border);
                    border-radius: 12px;
                    background: var(--card-bg);
                    color: var(--text-secondary);
                    font-size: 0.8rem;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .tag:hover {
                    border-color: var(--color-primary);
                }
                .tag.active {
                    background: var(--color-primary);
                    color: white;
                    border-color: var(--color-primary);
                }

                /* Heatmap */
                .heatmap-container {
                    background: var(--card-bg);
                    padding: 1rem;
                    border-radius: 8px;
                    overflow: auto;
                }
                .heatmap-grid {
                    display: grid;
                    gap: 1px;
                    background: var(--color-border);
                }
                .heatmap-cell {
                    padding: 0.75rem;
                    text-align: center;
                    font-size: 0.85rem;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .heatmap-cell.header {
                    background: var(--bg-secondary);
                    font-weight: 600;
                    color: var(--text-primary);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 0.75rem;
                }
                .heatmap-cell.value {
                    transition: transform 0.2s;
                }
                .heatmap-cell.value:hover {
                    transform: scale(1.05);
                    z-index: 10;
                    box-shadow: 0 0 10px rgba(0,0,0,0.2);
                }
            `}</style>
        </div>
    );
};
