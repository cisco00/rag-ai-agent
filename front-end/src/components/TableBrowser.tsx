import React, { useEffect, useState } from 'react';
import { Database, RefreshCw, AlertCircle, Info } from 'lucide-react';
import { api } from '../services/api';

interface TableBrowserProps {
    onSelectTable: (tableName: string) => void;
}

export const TableBrowser: React.FC<TableBrowserProps> = ({ onSelectTable }) => {
    const [tables, setTables] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchTables = async () => {
        try {
            setLoading(true);
            setError(null);
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error('No API key found');

            const data = await api.getTables(apiKey);
            setTables(data.tables || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load tables');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTables();
    }, []);

    return (
        <div className="card-panel">
            <div className="panel-header">
                <div className="flex-row">
                    <Database size={20} className="icon-primary" />
                    <h3>Database Tables</h3>
                </div>
                <button
                    className="btn-icon"
                    onClick={fetchTables}
                    disabled={loading}
                    title="Refresh tables"
                >
                    <RefreshCw size={16} className={loading ? 'spin' : ''} />
                </button>
            </div>

            <div className="panel-content">
                {error && (
                    <div className="alert-error">
                        <AlertCircle size={14} />
                        <span>{error}</span>
                    </div>
                )}

                {loading && <div className="loading-skeleton">Loading tables...</div>}

                {!loading && !error && tables.length === 0 && (
                    <div className="empty-state">
                        <p>No tables found.</p>
                        <small>Import a file or connect a database.</small>
                    </div>
                )}

                <ul className="table-list">
                    {tables.map((table) => (
                        <li key={table} onClick={() => onSelectTable(table)}>
                            <span className="table-name">{table}</span>
                        </li>
                    ))}
                </ul>

                <div className="help-tip">
                    <Info size={14} />
                    <span>Select a table to inspect schema.</span>
                </div>
            </div>

            <style>{`
                .card-panel {
                    background: white;
                    border: 1px solid var(--color-border);
                    border-radius: 12px;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                }
                .panel-header {
                    padding: 1rem;
                    border-bottom: 1px solid var(--color-border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .flex-row { display: flex; align-items: center; gap: 0.5rem; }
                .icon-primary { color: var(--color-primary); }
                h3 { font-size: 1rem; margin: 0; }
                .btn-icon { background: none; border: none; cursor: pointer; color: var(--color-text-secondary); padding: 4px; border-radius: 4px; }
                .btn-icon:hover { background: #f1f5f9; }
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { 100% { transform: rotate(360deg); } }
                
                .panel-content { padding: 1rem; flex: 1; overflow-y: auto; }
                
                .table-list { list-style: none; padding: 0; margin: 0; }
                .table-list li {
                    padding: 0.75rem;
                    border-radius: 6px;
                    cursor: pointer;
                    color: var(--color-text-secondary);
                    font-size: 0.9rem;
                    transition: all 0.2s;
                    border: 1px solid transparent;
                    margin-bottom: 0.25rem;
                }
                .table-list li:hover {
                    background-color: #f8fafc;
                    border-color: var(--color-border);
                    color: var(--color-primary);
                }
                
                .empty-state { text-align: center; color: var(--color-text-muted); padding: 2rem 0; }
                .alert-error { 
                    background: #fef2f2; 
                    color: #ef4444; 
                    padding: 0.75rem; 
                    border-radius: 6px; 
                    font-size: 0.85rem; 
                    display: flex; 
                    align-items: center; 
                    gap: 0.5rem;
                    margin-bottom: 1rem;
                }
                .help-tip {
                    margin-top: 1rem;
                    display: flex;
                    gap: 0.5rem;
                    font-size: 0.8rem;
                    color: var(--color-text-muted);
                    padding-top: 1rem;
                    border-top: 1px solid var(--color-border);
                }
            `}</style>
        </div>
    );
};
