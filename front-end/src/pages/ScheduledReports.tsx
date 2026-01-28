
import React, { useState, useEffect } from 'react';
import { Sidebar } from '../components/Sidebar';
import { Calendar, Trash2, Plus, Clock, Mail } from 'lucide-react';
import { api } from '../services/api';

interface ScheduledReport {
    id: number;
    query: string;
    frequency: string;
    next_run_at: string;
    recipients: string;
}

export const ScheduledReports: React.FC = () => {
    const [reports, setReports] = useState<ScheduledReport[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        query: '',
        frequency: 'biweekly',
        recipients: ''
    });

    const fetchReports = async () => {
        setIsLoading(true);
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (apiKey) {
                const data = await api.getScheduledReports(apiKey);
                setReports(data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchReports();
    }, []);

    const handleCreate = async () => {
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) return;

            await api.createScheduledReport(formData, apiKey);
            setShowModal(false);
            setFormData({ query: '', frequency: 'biweekly', recipients: '' });
            fetchReports();
        } catch (err) {
            alert('Failed to schedule report');
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Are you sure you want to cancel this report?')) return;
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) return;
            await api.deleteScheduledReport(id, apiKey);
            fetchReports();
        } catch (err) {
            alert('Failed to delete report');
        }
    };

    return (
        <div className="layout">
            <Sidebar />
            <main className="main-content">
                <div className="content-container">
                    <div className="page-header">
                        <div>
                            <h1 className="page-title">Scheduled Reports</h1>
                            <p className="page-subtitle">Automated insights delivered to your inbox.</p>
                        </div>
                        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                            <Plus size={18} />
                            Schedule Report
                        </button>
                    </div>

                    <div className="reports-grid">
                        {reports.map(report => (
                            <div key={report.id} className="report-card">
                                <div className="report-header">
                                    <div className="frequency-badge">
                                        <Clock size={14} />
                                        {report.frequency}
                                    </div>
                                    <button className="delete-btn" onClick={() => handleDelete(report.id)}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                <h3 className="report-query">"{report.query}"</h3>
                                <div className="report-meta">
                                    <div className="meta-item">
                                        <Calendar size={14} />
                                        Next Run: {new Date(report.next_run_at).toLocaleString()}
                                    </div>
                                    <div className="meta-item">
                                        <Mail size={14} />
                                        {report.recipients.split(',').length} Recipients
                                    </div>
                                </div>
                            </div>
                        ))}

                        {reports.length === 0 && !isLoading && (
                            <div className="empty-state">
                                <p>No scheduled reports yet.</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {showModal && (
                <div className="modal-overlay">
                    <div className="modal-card">
                        <h3>Schedule New Report</h3>
                        <div className="form-group">
                            <label>Analysis Query</label>
                            <textarea
                                className="input"
                                rows={3}
                                placeholder="E.g., Give me a summary of sales performance..."
                                value={formData.query}
                                onChange={e => setFormData({ ...formData, query: e.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <label>Frequency</label>
                            <select
                                className="input"
                                value={formData.frequency}
                                onChange={e => setFormData({ ...formData, frequency: e.target.value })}
                            >
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                                <option value="biweekly">Bi-Weekly</option>
                                <option value="monthly">Monthly</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Recipients (comma separated)</label>
                            <input
                                className="input"
                                placeholder="team@company.com, boss@company.com"
                                value={formData.recipients}
                                onChange={e => setFormData({ ...formData, recipients: e.target.value })}
                            />
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleCreate}>Schedule</button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .layout { display: flex; min-height: 100vh; background: var(--color-bg-primary); }
                .main-content { flex: 1; padding: 3rem; }
                .content-container { max-width: 1000px; margin: 0 auto; }
                
                .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; }
                .page-title { font-size: 2rem; margin-bottom: 0.5rem; }
                .page-subtitle { color: var(--color-text-secondary); }
                
                .reports-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
                
                .report-card { 
                    background: white; border-radius: 12px; padding: 1.5rem; 
                    border: 1px solid var(--color-border); box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                }
                
                .report-header { display: flex; justify-content: space-between; margin-bottom: 1rem; }
                .frequency-badge { 
                    background: #e0f2fe; color: #0284c7; padding: 0.25rem 0.75rem; 
                    border-radius: 20px; font-size: 0.8rem; font-weight: 600;
                    display: flex; align-items: center; gap: 0.5rem; text-transform: capitalize;
                }
                
                .delete-btn { background: none; border: none; color: #94a3b8; cursor: pointer; }
                .delete-btn:hover { color: #ef4444; }
                
                .report-query { font-size: 1.1rem; margin-bottom: 1.5rem; line-height: 1.4; font-weight: 500; }
                
                .report-meta { display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.9rem; color: #64748b; }
                .meta-item { display: flex; align-items: center; gap: 0.5rem; }
                
                .empty-state { grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 3rem; }
                
                /* Modal */
                .modal-overlay { 
                    position: fixed; inset: 0; background: rgba(0,0,0,0.5); 
                    display: flex; align-items: center; justify-content: center; z-index: 100;
                }
                .modal-card { background: white; padding: 2rem; border-radius: 12px; width: 500px; max-width: 90%; }
                .modal-card h3 { margin-bottom: 1.5rem; font-size: 1.25rem; }
                .form-group { margin-bottom: 1.25rem; }
                .form-group label { display: block; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.9rem; }
                .input { width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 8px; }
                .modal-actions { display: flex; justify-content: flex-end; gap: 1rem; margin-top: 2rem; }
                
                .btn { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 500; cursor: pointer; border: none; }
                .btn-primary { background: var(--color-primary); color: white; }
                .btn-secondary { background: #f1f5f9; color: #475569; }
            `}</style>
        </div>
    );
};
