import React, { useState, useEffect } from 'react';
import { X, Check, FileSpreadsheet, AlertCircle, Settings } from 'lucide-react';

interface PreviewFileModalProps {
    fileData: any;
    onConfirm: (cleaningOptions?: any) => void;
    onCancel: () => void;
    uploading: boolean;
}

export const PreviewFileModal: React.FC<PreviewFileModalProps> = ({
    fileData,
    onConfirm,
    onCancel,
    uploading
}) => {
    const [strategies, setStrategies] = useState<Record<string, string>>({});

    // Initialize strategies for columns with missing values
    useEffect(() => {
        if (fileData?.missing_values) {
            const initialStrategies: Record<string, string> = {};
            Object.keys(fileData.missing_values).forEach(col => {
                initialStrategies[col] = 'drop_rows'; // Default to dropping rows
            });
            setStrategies(initialStrategies);
        }
    }, [fileData]);

    if (!fileData) return null;

    const handleStrategyChange = (col: string, value: string) => {
        setStrategies(prev => ({
            ...prev,
            [col]: value
        }));
    };

    const handleConfirm = () => {
        // Construct cleaning options: only include if different from default or actually needed
        // For now, pass all strategies for columns with missing values
        const options: Record<string, string> = {};
        if (fileData.missing_values) {
            Object.keys(fileData.missing_values).forEach(col => {
                if (strategies[col]) {
                    options[col] = strategies[col];
                }
            });
        }

        // Map filename to options (api expects {filename: options})
        const finalOptions = Object.keys(options).length > 0
            ? { [fileData.filename]: options }
            : undefined;

        onConfirm(finalOptions);
    };

    const hasMissingValues = fileData.missing_values && Object.keys(fileData.missing_values).length > 0;

    return (
        <div className="preview-modal-overlay">
            <div className="preview-modal">
                <div className="modal-header">
                    <div className="header-title">
                        <FileSpreadsheet size={24} className="icon-primary" />
                        <div>
                            <h3>Import Preview</h3>
                            <p className="filename">{fileData.filename}</p>
                        </div>
                    </div>
                    <button onClick={onCancel} className="close-btn">
                        <X size={20} />
                    </button>
                </div>

                <div className="modal-content">
                    <div className="stats-row">
                        <div className="stat-item">
                            <span className="label">Total Rows</span>
                            <span className="value">{fileData.row_count.toLocaleString()}</span>
                        </div>
                        <div className="stat-item">
                            <span className="label">Columns</span>
                            <span className="value">{fileData.columns.length}</span>
                        </div>
                        {hasMissingValues && (
                            <div className="stat-item warning">
                                <span className="label">Missing Values</span>
                                <span className="value">{String(Object.values(fileData.missing_values).reduce((a: any, b: any) => a + b, 0))}</span>
                            </div>
                        )}
                    </div>

                    {hasMissingValues && (
                        <div className="cleaning-config">
                            <div className="config-header">
                                <Settings size={16} />
                                <h4>Handle Missing Values</h4>
                            </div>
                            <p className="config-desc">Some columns contain missing data. Choose how to handle them:</p>

                            <div className="strategies-grid">
                                {Object.entries(fileData.missing_values).map(([col, count]: [string, any]) => (
                                    <div key={col} className="strategy-item">
                                        <div className="col-info">
                                            <span className="col-name">{col}</span>
                                            <span className="missing-count">{count} missing</span>
                                        </div>
                                        <select
                                            value={strategies[col] || 'drop_rows'}
                                            onChange={(e) => handleStrategyChange(col, e.target.value)}
                                            className="strategy-select"
                                        >
                                            <option value="drop_rows">Drop Rows</option>
                                            <option value="fill_mean">Fill with Mean (Numeric)</option>
                                            <option value="fill_mode">Fill with Most Frequent</option>
                                            <option value="fill_zero">Fill with 0</option>
                                            <option value="fill_unknown">Fill with 'Unknown'</option>
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="preview-grid-wrapper">
                        <h4>Data Preview (First 5 rows)</h4>
                        <div className="table-container">
                            <table className="preview-table">
                                <thead>
                                    <tr>
                                        {fileData.columns.map((col: any) => (
                                            <th key={col.name}>
                                                <div className="th-content">
                                                    <span>{col.name}</span>
                                                    <span className="col-type">{col.type}</span>
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {fileData.preview_rows.map((row: any, i: number) => (
                                        <tr key={i}>
                                            {fileData.columns.map((col: any) => (
                                                <td key={col.name}>{String(row[col.name])}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div className="modal-footer">
                    <div className="warning-text">
                        <AlertCircle size={16} />
                        <span>Please verify the data above matches your expectations.</span>
                    </div>
                    <div className="actions">
                        <button className="btn btn-secondary" onClick={onCancel} disabled={uploading}>
                            Cancel
                        </button>
                        <button className="btn btn-primary" onClick={handleConfirm} disabled={uploading}>
                            {uploading ? 'Importing...' : 'Confirm Import'}
                            {!uploading && <Check size={18} />}
                        </button>
                    </div>
                </div>
            </div>

            <style>{`
                .preview-modal-overlay {
                    position: fixed;
                    top: 0;
                    right: 0;
                    bottom: 0;
                    left: 0;
                    background: rgba(0,0,0,0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                    padding: 2rem;
                }
                .preview-modal {
                    background: white;
                    border-radius: 12px;
                    width: 100%;
                    max-width: 900px;
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
                }
                .modal-header {
                    padding: 1.5rem;
                    border-bottom: 1px solid var(--color-border);
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                }
                .header-title {
                    display: flex;
                    gap: 1rem;
                    align-items: center;
                }
                .header-title h3 { margin: 0; font-size: 1.25rem; }
                .filename { color: var(--color-text-secondary); margin: 0; font-size: 0.9rem; }
                
                .modal-content {
                    padding: 1.5rem;
                    overflow-y: auto;
                    flex: 1;
                }
                
                .stats-row {
                    display: flex;
                    gap: 2rem;
                    margin-bottom: 1.5rem;
                    padding: 1rem;
                    background: #f8fafc;
                    border-radius: 8px;
                }
                .stat-item {
                    display: flex;
                    flex-direction: column;
                }
                .stat-item.warning .value { color: #d97706; }
                .stat-item .label { font-size: 0.8rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
                .stat-item .value { font-size: 1.5rem; font-weight: 600; color: var(--color-text-primary); }
                
                .cleaning-config {
                    margin-bottom: 2rem;
                    padding: 1.5rem;
                    background: #fffbeb;
                    border: 1px solid #fcd34d;
                    border-radius: 8px;
                }
                .config-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; color: #92400e; }
                .config-header h4 { margin: 0; font-size: 1rem; font-weight: 600; }
                .config-desc { margin: 0 0 1rem 0; font-size: 0.9rem; color: #b45309; }
                
                .strategies-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 1rem;
                }
                .strategy-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0.75rem;
                    background: white;
                    border-radius: 6px;
                    border: 1px solid #e2e8f0;
                }
                .col-info { display: flex; flex-direction: column; }
                .col-name { font-weight: 500; font-size: 0.9rem; }
                .missing-count { font-size: 0.8rem; color: #ef4444; }
                
                .strategy-select {
                    padding: 0.4rem;
                    border: 1px solid #cbd5e1;
                    border-radius: 4px;
                    font-size: 0.85rem;
                    max-width: 150px;
                }

                .preview-grid-wrapper h4, .columns-list h4 {
                    font-size: 0.95rem;
                    margin-bottom: 0.75rem;
                    color: var(--color-text-secondary);
                }
                
                .table-container {
                    border: 1px solid var(--color-border);
                    border-radius: 8px;
                    overflow-x: auto;
                    margin-bottom: 1.5rem;
                }
                .preview-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 0.9rem;
                }
                .preview-table th {
                    text-align: left;
                    padding: 0.75rem 1rem;
                    background: #f8fafc;
                    border-bottom: 1px solid var(--color-border);
                }
                .th-content { display: flex; flex-direction: column; gap: 2px; }
                .col-type { font-size: 0.7rem; color: #94a3b8; font-weight: normal; }
                .preview-table td {
                    padding: 0.5rem 1rem;
                    border-bottom: 1px solid #f1f5f9;
                    white-space: nowrap;
                }
                
                .tags { display: flex; flex-wrap: wrap; gap: 0.5rem; }
                .tag {
                    background: #f1f5f9;
                    padding: 0.25rem 0.75rem;
                    border-radius: 999px;
                    font-size: 0.85rem;
                    color: #475569;
                }
                
                .modal-footer {
                    padding: 1.25rem 1.5rem;
                    border-top: 1px solid var(--color-border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: #fcfcfc;
                    border-radius: 0 0 12px 12px;
                }
                
                .warning-text {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-size: 0.85rem;
                    color: #d97706;
                }
                
                .actions { display: flex; gap: 0.75rem; }
                .close-btn { border: none; background: none; cursor: pointer; color: #94a3b8; }
                .close-btn:hover { color: #ef4444; }
            `}</style>
        </div>
    );
};
