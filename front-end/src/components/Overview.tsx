import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Database, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

interface TableStats {
    table_name: string;
    total_rows: number;
    columns: number;
    total_missing: number;
    missing_values: Record<string, number>;
    error?: string;
}

interface OverviewProps {
    onSelectTable?: (tableName: string) => void;
}

export const Overview: React.FC<OverviewProps> = ({ onSelectTable }) => {
    const [stats, setStats] = useState<TableStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error("No API key");
            const result = await api.getStats(apiKey);
            setStats(result.tables);
        } catch (err: any) {
            setError(err.message || "Failed to load stats");
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="overview-loading">
                <Loader2 className="spin icon-primary" size={32} />
                <p>Loading overview...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="overview-error">
                <AlertTriangle size={32} className="icon-error" />
                <p>{error}</p>
                <button onClick={fetchStats} className="btn btn-secondary">Retry</button>
            </div>
        );
    }

    return (
        <div className="overview-container">
            <h2>Data Overview</h2>

            {stats.length === 0 ? (
                <div className="empty-state">
                    <Database size={48} color="#cbd5e1" />
                    <p>No tables found. Import some data to get started.</p>
                </div>
            ) : (
                <div className="stats-grid">
                    {stats.map((stat) => (
                        <div key={stat.table_name} className="stat-card" onClick={() => onSelectTable && onSelectTable(stat.table_name)}>
                            <div className="card-header">
                                <Database size={20} className="icon-primary" />
                                <h3>{stat.table_name}</h3>
                            </div>

                            {stat.error ? (
                                <div className="card-error">
                                    <AlertTriangle size={16} />
                                    <span>{stat.error}</span>
                                </div>
                            ) : (
                                <div className="card-metrics">
                                    <div className="metric">
                                        <span className="label">Rows</span>
                                        <span className="value">{stat.total_rows.toLocaleString()}</span>
                                    </div>
                                    <div className="metric">
                                        <span className="label">Columns</span>
                                        <span className="value">{stat.columns}</span>
                                    </div>
                                    <div className={`metric ${stat.total_missing > 0 ? 'warning' : 'success'}`}>
                                        <span className="label">Missing Values</span>
                                        <span className="value">
                                            {stat.total_missing > 0 ? (
                                                <div className="missing-badge">
                                                    <AlertTriangle size={14} />
                                                    {stat.total_missing}
                                                </div>
                                            ) : (
                                                <div className="success-badge">
                                                    <CheckCircle size={14} />
                                                    None
                                                </div>
                                            )}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {Object.keys(stat.missing_values || {}).length > 0 && (
                                <div className="missing-breakdown">
                                    <h4>Missing Breakdown:</h4>
                                    <ul>
                                        {Object.entries(stat.missing_values).slice(0, 3).map(([col, count]) => (
                                            <li key={col}>
                                                <span>{col}</span>
                                                <span className="count">{count}</span>
                                            </li>
                                        ))}
                                        {Object.keys(stat.missing_values).length > 3 && (
                                            <li className="more">
                                                +{Object.keys(stat.missing_values).length - 3} more
                                            </li>
                                        )}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <style>{`
                .overview-container {
                    padding: 1rem;
                    height: 100%;
                    overflow-y: auto;
                }
                .overview-container h2 {
                    font-size: 1.5rem;
                    margin-bottom: 2rem;
                    color: var(--color-text-primary);
                }
                
                .overview-loading, .overview-error, .empty-state {
                    height: 50vh;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 1rem;
                    color: var(--color-text-secondary);
                }
                
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 1.5rem;
                }
                
                .stat-card {
                    background: white;
                    border: 1px solid var(--color-border);
                    border-radius: 12px;
                    padding: 1.5rem;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .stat-card:hover {
                    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                    transform: translateY(-2px);
                    border-color: var(--color-primary);
                }
                
                .card-header {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    margin-bottom: 1.5rem;
                }
                .card-header h3 {
                    font-size: 1.1rem;
                    margin: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                
                .card-metrics {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 1rem;
                    margin-bottom: 1rem;
                }
                
                .metric {
                    display: flex;
                    flex-direction: column;
                    gap: 0.25rem;
                }
                .metric.warning .value { color: #d97706; }
                .metric.success .value { color: #059669; }
                
                .label { font-size: 0.8rem; color: var(--color-text-secondary); }
                .value { font-size: 1.2rem; font-weight: 600; color: var(--color-text-primary); }
                
                .missing-badge, .success-badge {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 1rem;
                }
                
                .missing-breakdown {
                    margin-top: 1rem;
                    padding-top: 1rem;
                    border-top: 1px solid #f1f5f9;
                }
                .missing-breakdown h4 {
                    font-size: 0.85rem;
                    color: var(--color-text-secondary);
                    margin-bottom: 0.5rem;
                }
                .missing-breakdown ul {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                .missing-breakdown li {
                    display: flex;
                    justify-content: space-between;
                    font-size: 0.85rem;
                    margin-bottom: 0.25rem;
                    color: #64748b;
                }
                .missing-breakdown .count { font-weight: 500; }
                .missing-breakdown .more { font-style: italic; font-size: 0.8rem; color: #94a3b8; }
                
                .card-error {
                    color: #ef4444;
                    background: #fee2e2;
                    padding: 0.5rem;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-size: 0.9rem;
                }
            `}</style>
        </div>
    );
};
