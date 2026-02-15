
import React, { useState, useEffect } from 'react';
import { BarChart2, AlertTriangle, TrendingUp } from 'lucide-react';
import { api } from '../services/api';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    ComposedChart, Scatter
} from 'recharts';

export const AnalyticsPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'forecast' | 'anomaly'>('forecast');
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

    useEffect(() => {
        const fetchTables = async () => {
            if (!apiKey) return;
            try {
                const data = await api.getTables(apiKey);
                setTables(data.tables);
                setSchemas(data.schemas);
                if (data.tables.length > 0) {
                    // Set default table if available
                    setForecastForm(prev => ({ ...prev, table_name: data.tables[0] }));
                    setAnomalyForm(prev => ({ ...prev, table_name: data.tables[0] }));
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
            // For chart, we need the full series data, but the API currently returns only anomalies or statistics?
            // Wait, detect_anomalies returns { anomalies: {indices, values}, ... }
            // It doesn't return the full dataset for plotting context.
            // Limitations of current backend implementation.
            // Ideally we'd overlay anomalies on the full time series.
            // For now, we'll just list them or show a scatter of anomalies (indices vs values).

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

    return (
        <div className="analytics-page">
            <h1 className="page-title">Advanced Analytics</h1>

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
            `}</style>
        </div>
    );
};
