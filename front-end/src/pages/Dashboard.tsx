import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Overview } from '../components/Overview';
import { Sidebar } from '../components/Sidebar';
import { TableBrowser } from '../components/TableBrowser';
import { QueryInterface } from '../components/QueryInterface';
import { TableInspector } from '../components/TableInspector';
import { HistoryView } from '../components/HistoryView';
import { LayoutDashboard, FileUp, Database, MessageSquare, History } from 'lucide-react';

export const Dashboard: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [selectedTable, setSelectedTable] = useState<string | null>(null);

    // Derive active view from URL path
    const getActiveTab = () => {
        const path = location.pathname;
        if (path === '/query') return 'query';
        if (path === '/tables') return 'tables';
        if (path === '/overview') return 'overview';
        if (path === '/history') return 'history';
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
        <div className="layout">
            <Sidebar />
            <main className="main-content">
                <div className="content-container">
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
                            <button
                                className={`tab-btn ${activeTab === 'query' ? 'active' : ''}`}
                                onClick={() => navigate('/query')}
                            >
                                <MessageSquare size={18} /> Query
                            </button>
                            <button
                                className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
                                onClick={() => navigate('/history')}
                            >
                                <History size={18} /> History
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

                        {activeTab === 'query' && (
                            <div className="full-view query-view">
                                <QueryInterface />
                            </div>
                        )}

                        {activeTab === 'history' && (
                            <div className="full-view">
                                <HistoryView />
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {selectedTable && (
                <TableInspector
                    tableName={selectedTable}
                    onClose={() => setSelectedTable(null)}
                />
            )}

            <style>{`
                .layout {
                    display: flex;
                    min-height: 100vh;
                    background-color: var(--color-bg-primary);
                }
                .main-content {
                    flex: 1;
                    padding: 2rem;
                    overflow-y: auto;
                }
                .content-container {
                    max-width: 1200px;
                    margin: 0 auto;
                    height: 100%;
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
                
                .grid-overview {
                    display: grid;
                    grid-template-columns: 1.5fr 1fr;
                    gap: 1.5rem;
                    align-items: start;
                }
                
                .overview-card h3 {
                    margin-bottom: 1rem;
                    font-size: 1.1rem;
                }

                .full-view { height: 100%; }
                .query-view { height: 75vh; }
            `}</style>
        </div>
    );
};
