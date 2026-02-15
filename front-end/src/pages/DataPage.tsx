
import React, { useState, useEffect } from 'react';
import { Database, Upload, Wand2, RefreshCw, FileUp } from 'lucide-react';
import { api } from '../services/api';
import { FileImport } from '../components/FileImport';

export const DataPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'sources' | 'import' | 'file-import' | 'transform'>('sources');
    const [apiKey] = useState(localStorage.getItem('vantage_api_key'));
    const [sources, setSources] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Import Form State
    const [importForm, setImportForm] = useState({
        url: '',
        method: 'GET',
        table_name: '',
        headers: '',
        params: ''
    });

    // Transform Form State
    const [transformForm, setTransformForm] = useState<{
        table_name: string;
        target_table: string;
        operations: any[];
    }>({
        table_name: '',
        target_table: '',
        operations: []
    });

    // Operation Builder State
    const [newOpType, setNewOpType] = useState('filter');
    const [newOpData, setNewOpData] = useState<any>({
        column: '',
        op: '==',
        value: '',
        new_name: '',
        new_type: 'int'
    });

    const addOperation = () => {
        const op: any = { type: newOpType };

        if (newOpType === 'filter') {
            if (!newOpData.column || !newOpData.value) return;
            op.column = newOpData.column;
            op.op = newOpData.op;
            // Try to convert value to number if possible
            const numVal = Number(newOpData.value);
            op.value = isNaN(numVal) ? newOpData.value : numVal;
        } else if (newOpType === 'drop_col') {
            if (!newOpData.column) return;
            op.column = newOpData.column;
        } else if (newOpType === 'rename_col') {
            if (!newOpData.column || !newOpData.new_name) return;
            op.column = newOpData.column;
            op.new_name = newOpData.new_name;
        } else if (newOpType === 'fill_na') {
            if (!newOpData.value) return;
            // Try to convert value to number if possible
            const numVal = Number(newOpData.value);
            op.value = isNaN(numVal) ? newOpData.value : numVal;
        } else if (newOpType === 'change_type') {
            if (!newOpData.column) return;
            op.column = newOpData.column;
            op.new_type = newOpData.new_type;
        }

        setTransformForm({
            ...transformForm,
            operations: [...transformForm.operations, op]
        });

        // Reset inputs
        setNewOpData({
            column: '',
            op: '==',
            value: '',
            new_name: '',
            new_type: 'int'
        });
    };

    useEffect(() => {
        if (activeTab === 'sources' && apiKey) {
            loadSources();
        }
    }, [activeTab, apiKey]);

    const loadSources = async () => {
        if (!apiKey) return;
        setIsLoading(true);
        try {
            const data = await api.getSources(apiKey);
            setSources(data);
        } catch (e) {
            console.error("Failed to load sources", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleImport = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        setIsLoading(true);
        try {
            const payload = {
                url: importForm.url,
                method: importForm.method,
                table_name: importForm.table_name,
                headers: importForm.headers ? JSON.parse(importForm.headers) : undefined,
                params: importForm.params ? JSON.parse(importForm.params) : undefined
            };
            await api.importApi(payload, apiKey!);
            setMessage({ type: 'success', text: 'Import successful!' });
            setImportForm({ url: '', method: 'GET', table_name: '', headers: '', params: '' });
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message || 'Import failed' });
        } finally {
            setIsLoading(false);
        }
    };

    // Preview State
    const [previewData, setPreviewData] = useState<any[]>([]);

    // ... (rest of the code)

    const handleTransform = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        setIsLoading(true);
        setPreviewData([]); // Clear previous preview
        try {
            const payload = {
                table_name: transformForm.table_name,
                target_table: transformForm.target_table || undefined,
                operations: transformForm.operations
            };
            const response = await api.transform(payload, apiKey!);

            if (response.preview) {
                setPreviewData(response.preview);
                setMessage({ type: 'success', text: 'Transformation successful! See preview below.' });
            } else {
                setMessage({ type: 'success', text: 'Transformation successful! Table updated.' });
            }

            if (transformForm.target_table) {
                loadSources();
            }
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message || 'Transformation failed' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="data-page">
            <h1 className="page-title">Data Management</h1>

            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'sources' ? 'active' : ''}`}
                    onClick={() => setActiveTab('sources')}
                >
                    <Database size={16} /> Data Sources
                </button>
                <button
                    className={`tab ${activeTab === 'import' ? 'active' : ''}`}
                    onClick={() => setActiveTab('import')}
                >
                    <Upload size={16} /> API Import
                </button>
                <button
                    className={`tab ${activeTab === 'file-import' ? 'active' : ''}`}
                    onClick={() => setActiveTab('file-import')}
                >
                    <FileUp size={16} /> File Import
                </button>
                <button
                    className={`tab ${activeTab === 'transform' ? 'active' : ''}`}
                    onClick={() => setActiveTab('transform')}
                >
                    <Wand2 size={16} /> Transform
                </button>
            </div>

            <div className="content-area">
                {message && (
                    <div className={`message ${message.type}`}>
                        {message.text}
                    </div>
                )}

                {activeTab === 'sources' && (
                    <div className="sources-view">
                        <div className="table-actions">
                            <button onClick={loadSources} disabled={isLoading} className="refresh-btn">
                                <RefreshCw size={14} className={isLoading ? 'spin' : ''} /> Refresh
                            </button>
                        </div>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Type</th>
                                    <th>Table Name</th>
                                    <th>Details</th>
                                    <th>Created At</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sources.map(source => (
                                    <tr key={source.id}>
                                        <td>{source.name}</td>
                                        <td>{source.source_type}</td>
                                        <td>{source.table_name}</td>
                                        <td>{source.connection_details}</td>
                                        <td>{new Date(source.created_at).toLocaleString()}</td>
                                    </tr>
                                ))}
                                {sources.length === 0 && !isLoading && (
                                    <tr><td colSpan={5} style={{ textAlign: 'center' }}>No data sources found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {activeTab === 'import' && (
                    <form onSubmit={handleImport} className="form-layout">
                        <div className="form-group">
                            <label>API URL</label>
                            <input
                                type="url"
                                required
                                value={importForm.url}
                                onChange={e => setImportForm({ ...importForm, url: e.target.value })}
                                placeholder="https://api.example.com/data"
                            />
                        </div>
                        <div className="form-group">
                            <label>Method</label>
                            <select
                                value={importForm.method}
                                onChange={e => setImportForm({ ...importForm, method: e.target.value })}
                            >
                                <option value="GET">GET</option>
                                <option value="POST">POST</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Target Table Name</label>
                            <input
                                type="text"
                                required
                                value={importForm.table_name}
                                onChange={e => setImportForm({ ...importForm, table_name: e.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <label>Headers (JSON)</label>
                            <textarea
                                value={importForm.headers}
                                onChange={e => setImportForm({ ...importForm, headers: e.target.value })}
                                placeholder='{"Authorization": "Bearer token"}'
                                rows={3}
                            />
                        </div>
                        <div className="form-group">
                            <label>Params (JSON)</label>
                            <textarea
                                value={importForm.params}
                                onChange={e => setImportForm({ ...importForm, params: e.target.value })}
                                placeholder='{"limit": 100}'
                                rows={3}
                            />
                        </div>
                        <button type="submit" className="submit-btn" disabled={isLoading}>
                            {isLoading ? 'Importing...' : 'Start Import'}
                        </button>
                    </form>
                )}

                {activeTab === 'transform' && (
                    <>
                        <form onSubmit={handleTransform} className="form-layout">
                            <div className="form-group">
                                <label>Source Table</label>
                                <input
                                    type="text"
                                    required
                                    value={transformForm.table_name}
                                    onChange={e => setTransformForm({ ...transformForm, table_name: e.target.value })}
                                />
                            </div>
                            <div className="form-group">
                                <label>Target Table (Optional)</label>
                                <input
                                    type="text"
                                    value={transformForm.target_table}
                                    onChange={e => setTransformForm({ ...transformForm, target_table: e.target.value })}
                                    placeholder="Leave empty to overwrite or view only"
                                />
                            </div>

                            <div className="form-group">
                                <label>Operations</label>
                                <div className="operations-list">
                                    {transformForm.operations.map((op: any, index: number) => (
                                        <div key={index} className="operation-item">
                                            <div className="operation-summary">
                                                <span className="op-type">{op.type}</span>
                                                <span className="op-details">
                                                    {op.type === 'filter' && `${op.column} ${op.op} ${op.value}`}
                                                    {op.type === 'drop_col' && `Column: ${op.column}`}
                                                    {op.type === 'rename_col' && `${op.column} -> ${op.new_name}`}
                                                    {op.type === 'fill_na' && `${op.column || 'All'}: ${op.value}`}
                                                    {op.type === 'change_type' && `${op.column} -> ${op.new_type}`}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                className="remove-op-btn"
                                                onClick={() => {
                                                    const newOps = [...transformForm.operations];
                                                    newOps.splice(index, 1);
                                                    setTransformForm({ ...transformForm, operations: newOps });
                                                }}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                    {transformForm.operations.length === 0 && (
                                        <div className="no-ops">No operations added yet.</div>
                                    )}
                                </div>

                                <div className="add-operation-box">
                                    <h4>Add Operation</h4>
                                    <div className="op-type-selector">
                                        <select
                                            value={newOpType}
                                            onChange={e => setNewOpType(e.target.value)}
                                        >
                                            <option value="filter">Filter Rows</option>
                                            <option value="drop_col">Drop Column</option>
                                            <option value="rename_col">Rename Column</option>
                                            <option value="fill_na">Fill Missing Values</option>
                                            <option value="change_type">Change Data Type</option>
                                        </select>
                                    </div>

                                    <div className="op-inputs">
                                        {newOpType === 'filter' && (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Column Name"
                                                    value={newOpData.column}
                                                    onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                />
                                                <select
                                                    value={newOpData.op}
                                                    onChange={e => setNewOpData({ ...newOpData, op: e.target.value })}
                                                >
                                                    <option value="==">Equals (==)</option>
                                                    <option value=">">Greater Than (&gt;)</option>
                                                    <option value="<">Less Than (&lt;)</option>
                                                </select>
                                                <input
                                                    type="text"
                                                    placeholder="Value"
                                                    value={newOpData.value}
                                                    onChange={e => setNewOpData({ ...newOpData, value: e.target.value })}
                                                />
                                            </>
                                        )}

                                        {newOpType === 'drop_col' && (
                                            <input
                                                type="text"
                                                placeholder="Column Name"
                                                value={newOpData.column}
                                                onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                            />
                                        )}

                                        {newOpType === 'rename_col' && (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Old Name"
                                                    value={newOpData.column}
                                                    onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="New Name"
                                                    value={newOpData.new_name}
                                                    onChange={e => setNewOpData({ ...newOpData, new_name: e.target.value })}
                                                />
                                            </>
                                        )}

                                        {newOpType === 'fill_na' && (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Value to fill"
                                                    value={newOpData.value}
                                                    onChange={e => setNewOpData({ ...newOpData, value: e.target.value })}
                                                />
                                            </>
                                        )}

                                        {newOpType === 'change_type' && (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Column Name"
                                                    value={newOpData.column}
                                                    onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                />
                                                <select
                                                    value={newOpData.new_type}
                                                    onChange={e => setNewOpData({ ...newOpData, new_type: e.target.value })}
                                                >
                                                    <option value="int">Integer</option>
                                                    <option value="float">Float</option>
                                                    <option value="str">String</option>
                                                    <option value="datetime">Datetime</option>
                                                </select>
                                            </>
                                        )}
                                    </div>

                                    <button
                                        type="button"
                                        className="add-op-btn"
                                        onClick={addOperation}
                                    >
                                        + Add
                                    </button>
                                </div>
                            </div>

                            <button type="submit" className="submit-btn" disabled={isLoading}>
                                {isLoading ? 'Transforming...' : 'Run Transformation'}
                            </button>
                        </form>

                        {previewData.length > 0 && (
                            <div className="preview-section" style={{ marginTop: '2rem' }}>
                                <h3>Transformation Preview (First 10 rows)</h3>
                                <div className="table-container" style={{ overflowX: 'auto' }}>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                {Object.keys(previewData[0]).map(key => (
                                                    <th key={key}>{key}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {previewData.map((row, i) => (
                                                <tr key={i}>
                                                    {Object.values(row).map((val: any, j) => (
                                                        <td key={j}>
                                                            {val === null ? <span style={{ color: '#999', fontStyle: 'italic' }}>null</span> :
                                                                (typeof val === 'object' ? JSON.stringify(val) : String(val))}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {activeTab === 'file-import' && (
                    <div style={{ maxWidth: '800px' }}>
                        <FileImport />
                    </div>
                )}
            </div>

            <style>{`
                .data-page {
                    padding: 2rem;
                    height: 100vh;
                    overflow-y: auto;
                    color: var(--text-primary);
                }
                .page-title {
                    margin-bottom: 2rem;
                    color: var(--text-primary);
                }
                .tabs {
                    display: flex;
                    gap: 1rem;
                    margin-bottom: 2rem;
                    border-bottom: 1px solid var(--color-border);
                }
                .tab {
                    background: none;
                    border: none;
                    border-bottom: 2px solid transparent;
                    color: var(--text-secondary);
                    padding: 0.75rem 1.5rem;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-size: 1rem;
                }
                .tab.active {
                    color: var(--color-primary);
                    border-bottom-color: var(--color-primary);
                }
                .content-area {
                    background-color: var(--card-bg);
                    padding: 2rem;
                    border-radius: 8px;
                    border: 1px solid var(--color-border);
                }
                .data-table {
                    width: 100%;
                    border-collapse: collapse;
                }
                .data-table th, .data-table td {
                    padding: 1rem;
                    text-align: left;
                    border-bottom: 1px solid var(--color-border);
                }
                .form-layout {
                    max-width: 600px;
                    display: flex;
                    flex-direction: column;
                    gap: 1.5rem;
                }
                .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                }
                .form-group label {
                    font-weight: 500;
                }
                .form-group input, .form-group select, .form-group textarea {
                    padding: 0.75rem;
                    background-color: var(--bg-secondary);
                    border: 1px solid var(--color-border);
                    border-radius: 6px;
                    color: var(--text-primary);
                }
                .submit-btn, .refresh-btn {
                    padding: 0.75rem 1.5rem;
                    background-color: var(--color-primary);
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    width: fit-content;
                }
                .submit-btn:disabled, .refresh-btn:disabled {
                    opacity: 0.7;
                    cursor: not-allowed;
                }
                .message {
                    padding: 1rem;
                    border-radius: 6px;
                    margin-bottom: 1.5rem;
                }
                .message.success {
                    background-color: rgba(34, 197, 94, 0.1);
                    color: #22c55e;
                }
                .message.error {
                    background-color: rgba(239, 68, 68, 0.1);
                    color: #ef4444;
                }
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .operations-list {
                    background: var(--bg-secondary);
                    border: 1px solid var(--color-border);
                    border-radius: 6px;
                    padding: 0.5rem;
                    margin-bottom: 1rem;
                }
                .operation-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: var(--card-bg);
                    border: 1px solid var(--color-border);
                    padding: 0.5rem;
                    border-radius: 4px;
                    margin-bottom: 0.5rem;
                }
                .operation-item:last-child {
                    margin-bottom: 0;
                }
                .op-type {
                    font-weight: bold;
                    margin-right: 0.5rem;
                    text-transform: uppercase;
                    font-size: 0.8rem;
                    background: rgba(var(--color-primary-rgb), 0.1);
                    color: var(--color-primary);
                    padding: 0.2rem 0.4rem;
                    border-radius: 4px;
                }
                .remove-op-btn {
                    background: none;
                    border: none;
                    color: #ef4444;
                    cursor: pointer;
                    font-size: 1.2rem;
                }
                .add-operation-box {
                    background: var(--bg-secondary);
                    padding: 1rem;
                    border-radius: 6px;
                    border: 1px solid var(--color-border);
                }
                .add-operation-box h4 {
                    margin-top: 0;
                    margin-bottom: 1rem;
                    font-size: 0.9rem;
                    text-transform: uppercase;
                    color: var(--text-secondary);
                }
                .op-type-selector {
                    margin-bottom: 1rem;
                }
                .op-inputs {
                    display: flex;
                    gap: 0.5rem;
                    margin-bottom: 1rem;
                    flex-wrap: wrap;
                }
                .op-inputs input, .op-inputs select {
                    flex: 1;
                    min-width: 120px;
                }
                .add-op-btn {
                    width: 100%;
                    padding: 0.5rem;
                    background: var(--color-secondary);
                    color: var(--text-primary);
                    border: 1px solid var(--color-border);
                    border-radius: 4px;
                    cursor: pointer;
                }
                .no-ops {
                    color: var(--text-secondary);
                    text-align: center;
                    padding: 1rem;
                    font-style: italic;
                }
            `}</style>
        </div>
    );
};
