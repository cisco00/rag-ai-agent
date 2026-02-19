
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
        new_type: 'int',
        method: 'min-max',
        feature_type: 'interaction',
        column1: '',
        column2: '',
        operation: '*',
        component: 'day'
    });

    const addOperation = () => {
        const op: any = { type: newOpType };

        if (newOpType === 'filter') {
            if (!newOpData.column || !newOpData.value) return;
            op.column = newOpData.column;
            op.op = newOpData.op;
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
            op.method = newOpData.method || 'value';

            if (newOpData.column) op.column = newOpData.column;

            if (op.method === 'value') {
                if (!newOpData.value) return; // Value required for fixed value
                const numVal = Number(newOpData.value);
                op.value = isNaN(numVal) ? newOpData.value : numVal;
            } else if (op.method === 'weighted_mean') {
                if (!newOpData.column1) return; // Weight column required
                op.weight_column = newOpData.column1;
            }
        } else if (newOpType === 'change_type') {
            if (!newOpData.column) return;
            op.column = newOpData.column;
            op.new_type = newOpData.new_type;
        } else if (newOpType === 'normalize') {
            if (!newOpData.column) return;
            op.column = newOpData.column;
            op.method = newOpData.method;
        } else if (newOpType === 'encode') {
            if (!newOpData.column) return;
            op.column = newOpData.column;
            op.method = newOpData.method;
        } else if (newOpType === 'feature_engineering') {
            op.feature_type = newOpData.feature_type;
            if (newOpData.feature_type === 'interaction') {
                if (!newOpData.column1 || !newOpData.column2) return;
                op.column1 = newOpData.column1;
                op.column2 = newOpData.column2;
                op.operation = newOpData.operation;
            } else if (newOpData.feature_type === 'time_component') {
                if (!newOpData.column) return;
                op.column = newOpData.column;
                op.component = newOpData.component;
            } else if (newOpData.feature_type === 'lag') {
                if (!newOpData.column) return;
                op.column = newOpData.column;
                op.periods = Number(newOpData.value) || 1;
            }
        } else if (newOpType === 'text_feature') {
            if (!newOpData.column) return;
            op.column = newOpData.column;
            op.method = newOpData.method;
        } else if (newOpType === 'clean_duplicates') {
            op.type = 'clean';
            op.method = 'drop_duplicates';
            if (newOpData.column) {
                op.subset = newOpData.column.split(',').map((s: string) => s.trim());
            }
        } else if (newOpType === 'clean_text') {
            op.type = 'clean';
            op.method = 'clean_text';
            if (!newOpData.column) return;
            op.column = newOpData.column;
            op.clean_type = newOpData.method || 'trim'; // Mapping 'method' in UI to 'clean_type'
            if (op.clean_type === 'replace') {
                op.old_value = newOpData.value;
                op.new_value = newOpData.new_name;
            }
        } else if (newOpType === 'remove_outliers') {
            op.type = 'clean';
            op.method = 'remove_outliers';
            if (!newOpData.column) return;
            op.column = newOpData.column;
            op.outlier_method = newOpData.method || 'z-score';
            op.threshold = Number(newOpData.value) || 3.0;
        }

        setTransformForm({
            ...transformForm,
            operations: [...transformForm.operations, op]
        });

        // Reset inputs (keep defaults)
        setNewOpData({
            column: '',
            op: '==',
            value: '',
            new_name: '',
            new_type: 'int',
            method: 'min-max',
            feature_type: 'interaction',
            column1: '',
            column2: '',
            operation: '*',
            component: 'day'
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
                    <Database size={16} /> Imported Files
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
                                    <tr><td colSpan={5} style={{ textAlign: 'center' }}>No imported files found</td></tr>
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
                                                    {op.type === 'fill_na' && `${op.column || 'Global'} (${op.method}) ${op.method === 'value' ? ': ' + op.value : ''}`}
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
                                            onChange={e => {
                                                setNewOpType(e.target.value);
                                                // Reset data when type changes
                                                setNewOpData({
                                                    column: '', op: '==', value: '', new_name: '', new_type: 'int',
                                                    method: 'min-max', feature_type: 'interaction', column1: '', column2: '', operation: '*',
                                                    component: 'day', group_cols: '', aggs: ''
                                                });
                                            }}
                                        >
                                            <optgroup label="Basic">
                                                <option value="filter">Filter Rows</option>
                                                <option value="drop_col">Drop Column</option>
                                                <option value="rename_col">Rename Column</option>
                                                <option value="fill_na">Fill Missing Values</option>
                                                <option value="change_type">Change Data Type</option>
                                            </optgroup>
                                            <optgroup label="Advanced">
                                                <option value="normalize">Normalization & Scaling</option>
                                                <option value="encode">Encode Categorical</option>
                                                <option value="feature_engineering">Feature Engineering</option>
                                                <option value="text_feature">Text Features</option>
                                            </optgroup>
                                            <optgroup label="Cleaning">
                                                <option value="clean_duplicates">Remove Duplicates</option>
                                                <option value="clean_text">Clean Text</option>
                                                <option value="remove_outliers">Remove Outliers</option>
                                            </optgroup>
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
                                                    <option value="!=">Not Equals (!=)</option>
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
                                                    placeholder="Column (Optional for Fixed Value)"
                                                    value={newOpData.column}
                                                    onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                />
                                                <select
                                                    value={newOpData.method}
                                                    onChange={e => setNewOpData({ ...newOpData, method: e.target.value })}
                                                >
                                                    <option value="value">Fixed Value</option>
                                                    <option value="mean">Mean (Average)</option>
                                                    <option value="median">Median</option>
                                                    <option value="mode">Mode (Most Frequent)</option>
                                                    <option value="weighted_mean">Weighted Mean</option>
                                                    <option value="random">Random Distribution</option>
                                                </select>

                                                {newOpData.method === 'value' && (
                                                    <input
                                                        type="text"
                                                        placeholder="Value to fill"
                                                        value={newOpData.value}
                                                        onChange={e => setNewOpData({ ...newOpData, value: e.target.value })}
                                                    />
                                                )}

                                                {newOpData.method === 'weighted_mean' && (
                                                    <input
                                                        type="text"
                                                        placeholder="Weight Column"
                                                        value={newOpData.column1} // Repurposing column1 for weight column
                                                        onChange={e => setNewOpData({ ...newOpData, column1: e.target.value })}
                                                    />
                                                )}
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
                                                    <option value="bool">Boolean</option>
                                                </select>
                                            </>
                                        )}

                                        {newOpType === 'normalize' && (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Column Name"
                                                    value={newOpData.column}
                                                    onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                />
                                                <select
                                                    value={newOpData.method}
                                                    onChange={e => setNewOpData({ ...newOpData, method: e.target.value })}
                                                >
                                                    <option value="min-max">Min-Max Scaling</option>
                                                    <option value="z-score">Z-Score (Standardization)</option>
                                                    <option value="log">Log Transform</option>
                                                    <option value="box-cox">Box-Cox</option>
                                                </select>
                                            </>
                                        )}

                                        {newOpType === 'encode' && (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Column Name"
                                                    value={newOpData.column}
                                                    onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                />
                                                <select
                                                    value={newOpData.method}
                                                    onChange={e => setNewOpData({ ...newOpData, method: e.target.value })}
                                                >
                                                    <option value="one-hot">One-Hot Encoding</option>
                                                    <option value="label">Label Encoding</option>
                                                    <option value="binary">Binary (Yes/No)</option>
                                                </select>
                                            </>
                                        )}

                                        {newOpType === 'feature_engineering' && (
                                            <>
                                                <select
                                                    value={newOpData.feature_type}
                                                    onChange={e => setNewOpData({ ...newOpData, feature_type: e.target.value })}
                                                    style={{ width: '100%', marginBottom: '0.5rem' }}
                                                >
                                                    <option value="interaction">Interaction (Math)</option>
                                                    <option value="time_component">Time Component</option>
                                                    <option value="lag">Lag (Time Series)</option>
                                                </select>

                                                {newOpData.feature_type === 'interaction' && (
                                                    <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                                                        <input
                                                            type="text"
                                                            placeholder="Col 1"
                                                            value={newOpData.column1}
                                                            onChange={e => setNewOpData({ ...newOpData, column1: e.target.value })}
                                                        />
                                                        <select
                                                            value={newOpData.operation}
                                                            onChange={e => setNewOpData({ ...newOpData, operation: e.target.value })}
                                                            style={{ minWidth: '60px' }}
                                                        >
                                                            <option value="*">*</option>
                                                            <option value="/">/</option>
                                                            <option value="+">+</option>
                                                            <option value="-">-</option>
                                                        </select>
                                                        <input
                                                            type="text"
                                                            placeholder="Col 2"
                                                            value={newOpData.column2}
                                                            onChange={e => setNewOpData({ ...newOpData, column2: e.target.value })}
                                                        />
                                                    </div>
                                                )}

                                                {newOpData.feature_type === 'time_component' && (
                                                    <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                                                        <input
                                                            type="text"
                                                            placeholder="Date Column"
                                                            value={newOpData.column}
                                                            onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                        />
                                                        <select
                                                            value={newOpData.component}
                                                            onChange={e => setNewOpData({ ...newOpData, component: e.target.value })}
                                                        >
                                                            <option value="day">Day</option>
                                                            <option value="month">Month</option>
                                                            <option value="year">Year</option>
                                                            <option value="dow">Day of Week</option>
                                                            <option value="quarter">Quarter</option>
                                                        </select>
                                                    </div>
                                                )}

                                                {newOpData.feature_type === 'lag' && (
                                                    <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                                                        <input
                                                            type="text"
                                                            placeholder="Column"
                                                            value={newOpData.column}
                                                            onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                        />
                                                        <input
                                                            type="number"
                                                            placeholder="Periods (1)"
                                                            value={newOpData.value} // Reuse value field for periods
                                                            onChange={e => setNewOpData({ ...newOpData, value: e.target.value })}
                                                            style={{ width: '80px' }}
                                                        />
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {newOpType === 'text_feature' && (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Text Column"
                                                    value={newOpData.column}
                                                    onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                />
                                                <select
                                                    value={newOpData.method}
                                                    onChange={e => setNewOpData({ ...newOpData, method: e.target.value })}
                                                >
                                                    <option value="len">Length</option>
                                                    <option value="word_count">Word Count</option>
                                                    <option value="tfidf">TF-IDF Vector</option>
                                                </select>
                                            </>
                                        )}

                                        {newOpType === 'clean_duplicates' && (
                                            <input
                                                type="text"
                                                placeholder="Subset Cols (comma sep) - Leave empty for all"
                                                value={newOpData.column} // repurposing column field for subset list
                                                onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                style={{ width: '100%' }}
                                            />
                                        )}

                                        {newOpType === 'clean_text' && (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Column"
                                                    value={newOpData.column}
                                                    onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                />
                                                <select
                                                    value={newOpData.method} // Using 'method' to store 'clean_type'
                                                    onChange={e => setNewOpData({ ...newOpData, method: e.target.value })}
                                                >
                                                    <option value="trim">Trim Whitespace</option>
                                                    <option value="lower">Lowercase</option>
                                                    <option value="upper">Uppercase</option>
                                                    <option value="title">Title Case</option>
                                                    <option value="remove_special">Remove Special Chars</option>
                                                    <option value="replace">Replace Value</option>
                                                </select>
                                                {newOpData.method === 'replace' && (
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <input
                                                            type="text"
                                                            placeholder="Old"
                                                            value={newOpData.value} // repurposing value for 'old_value'
                                                            onChange={e => setNewOpData({ ...newOpData, value: e.target.value })}
                                                        />
                                                        <input
                                                            type="text"
                                                            placeholder="New"
                                                            value={newOpData.new_name} // repurposing new_name for 'new_value'
                                                            onChange={e => setNewOpData({ ...newOpData, new_name: e.target.value })}
                                                        />
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {newOpType === 'remove_outliers' && (
                                            <>
                                                <input
                                                    type="text"
                                                    placeholder="Column"
                                                    value={newOpData.column}
                                                    onChange={e => setNewOpData({ ...newOpData, column: e.target.value })}
                                                />
                                                <select
                                                    value={newOpData.method} // Using 'method' for 'outlier_method'
                                                    onChange={e => setNewOpData({ ...newOpData, method: e.target.value })}
                                                >
                                                    <option value="z-score">Z-Score</option>
                                                    <option value="iqr">IQR</option>
                                                </select>
                                                <input
                                                    type="number"
                                                    placeholder="Threshold (3.0)"
                                                    value={newOpData.value} // repurposing value for threshold
                                                    onChange={e => setNewOpData({ ...newOpData, value: e.target.value })}
                                                    style={{ width: '80px' }}
                                                />
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
