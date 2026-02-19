import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Overview } from '../components/Overview';
import { TableBrowser } from '../components/TableBrowser';
import { TableInspector } from '../components/TableInspector';
import { LayoutDashboard, Database } from 'lucide-react';

export const Dashboard: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [selectedTable, setSelectedTable] = useState<string | null>(null);

    // Derive active view from URL path
    const getActiveTab = () => {
        const path = location.pathname;
        if (path === '/tables') return 'tables';
        if (path === '/overview') return 'overview';
        return 'overview';
    };

    const activeTab = getActiveTab();

    const handleTableSelect = (tableName: string) => {
        setSelectedTable(tableName);
    };

    const handleOverviewTableSelect = (tableName: string) => {
        setSelectedTable(tableName);
    };

    return (
        <div className="dashboard-container">
            <header className="page-header">
                <h1>Analytics Dashboard</h1>
                <div className="tabs">
                    <button
                        className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                        onClick={() => navigate('/overview')}
                    >
                        <LayoutDashboard size={18} /> Overview
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'tables' ? 'active' : ''}`}
                        onClick={() => navigate('/tables')}
                    >
                        <Database size={18} /> Tables
                    </button>
                </div>
            </header>

            <div className="tab-content">
                {activeTab === 'overview' && (
                    <div className="full-view">
                        <Overview onSelectTable={handleOverviewTableSelect} />
                    </div>
                )}

                {activeTab === 'tables' && (
                    <div className="full-view">
                        <TableBrowser onSelectTable={handleTableSelect} />
                    </div>
                )}
            </div>

            {selectedTable && (
                <TableInspector
                    tableName={selectedTable}
                    onClose={() => setSelectedTable(null)}
                />
            )}

            <style>{`
                .dashboard-container {
                    padding: 2rem;
                    height: 100%;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                }
                .page-header {
                    margin-bottom: 2rem;
                }
                .page-header h1 {
                    font-size: 1.8rem;
                    margin-bottom: 1.5rem;
                }
                
                .tabs {
                    display: flex;
                    gap: 0.5rem;
                    border-bottom: 1px solid var(--color-border);
                    padding-bottom: 1px;
                }
                .tab-btn {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    padding: 0.75rem 1.25rem;
                    background: none;
                    border: none;
                    border-bottom: 2px solid transparent;
                    color: var(--color-text-secondary);
                    cursor: pointer;
                    font-weight: 500;
                    margin-bottom: -1px;
                }
                .tab-btn:hover { color: var(--color-primary); background: #f8fafc; }
                .tab-btn.active {
                    color: var(--color-primary);
                    border-bottom-color: var(--color-primary);
                }

                .tab-content { flex: 1; margin-top: 1.5rem; }
                
                .full-view { height: 100%; }

                @media (max-width: 768px) {
                    .dashboard-container {
                        padding: 1rem;
                    }
                    .page-header h1 {
                        font-size: 1.5rem;
                        margin-bottom: 1rem;
                    }
                    .tab-btn {
                        padding: 0.5rem 0.75rem;
                        font-size: 0.9rem;
                    }
                }
            `}</style>
        </div>
    );
};
