import React, { useEffect, useState } from 'react';
import { X, LayoutGrid, AlertCircle, Loader2, Edit3, Save, PaintBucket, PlayCircle, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { useNavigate } from 'react-router-dom';

interface TableInspectorProps {
    tableName: string;
    onClose: () => void;
}

export const TableInspector: React.FC<TableInspectorProps> = ({ tableName, onClose }) => {
    const navigate = useNavigate();
    const [currentTable, setCurrentTable] = useState(tableName);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Editing state (auto-enable for copies)
    const isCopy = tableName.includes('_copy_');
    const [isEditing, setIsEditing] = useState(isCopy);
    const [editingCell, setEditingCell] = useState<{ rowId: any, col: string } | null>(null);
    const [isDuplicating, setIsDuplicating] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error("No API key");

            const result = await api.getTablePreview(currentTable, apiKey);
            setData(result);
        } catch (err: any) {
            setError(err.message || 'Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (currentTable) {
            fetchData();
        }
    }, [currentTable]);

    const handleEnterEditMode = async () => {
        if (isEditing) return;
        setIsDuplicating(true);
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error("No API key");

            // Duplicate table
            const result = await api.duplicateTable(tableName, apiKey);
            setCurrentTable(result.new_table);
            setIsEditing(true);
        } catch (err: any) {
            alert(`Failed to enter edit mode: ${err.message}`);
        } finally {
            setIsDuplicating(false);
        }
    };

    const handleCellClick = (rowId: any, col: string, currentValue: any) => {
        if (!isEditing) return;
        if (col === '_id') return; // Cannot edit ID
        setEditingCell({ rowId, col });
    };

    const handleCellSave = async (newValue: string) => {
        if (!editingCell) return;

        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error("No API key");

            await api.updateTableCell(currentTable, editingCell.rowId, editingCell.col, newValue, apiKey);

            // Refresh data locally
            const newData = { ...data };
            const row = newData.rows.find((r: any) => r._id === editingCell.rowId);
            if (row) row[editingCell.col] = newValue;
            setData(newData);

        } catch (err: any) {
            console.error("Update failed", err);
            alert("Failed to save value");
        } finally {
            setEditingCell(null);
        }
    };

    const handleDeleteRow = async (rowId: any) => {
        if (!window.confirm("Are you sure you want to delete this row?")) return;
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error("No API key");
            await api.deleteRow(currentTable, rowId, apiKey);
            fetchData(); // Refresh
        } catch (err: any) {
            alert(`Failed to delete row: ${err.message}`);
        }
    };

    const handleRenameColumn = async (oldName: string) => {
        const newName = window.prompt("Enter new column name:", oldName);
        if (!newName || newName === oldName) return;

        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error("No API key");
            await api.renameColumn(currentTable, oldName, newName, apiKey);
            fetchData();
        } catch (err: any) {
            alert(`Failed to rename column: ${err.message}`);
        }
    };

    const handleDropColumn = async (colName: string) => {
        if (!window.confirm(`Are you sure you want to delete column '${colName}'?`)) return;
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error("No API key");
            await api.dropColumn(currentTable, colName, apiKey);
            fetchData();
        } catch (err: any) {
            alert(`Failed to drop column: ${err.message}`);
        }
    };

    // Updated fill handler
    const handleFillMissing = async (colName: string) => {
        const strategy = window.prompt(
            `Fill missing values in '${colName}' using:\n- 'value' (specific value)\n- 'mean' (average)\n- 'median'\n- 'mode' (most frequent)\n- 'weighted_mean'\n\nEnter strategy:`,
            'value'
        );
        if (!strategy) return;

        let value = null;
        let weightCol = "";

        if (strategy === 'value') {
            const val = window.prompt("Enter value to fill with:");
            if (val === null) return;
            value = val;
        } else if (strategy === 'weighted_mean') {
            const wCol = window.prompt("Enter the name of the column to use as weights:");
            if (!wCol) return;
            weightCol = wCol;
        }

        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error("No API key");

            // @ts-ignore
            const result = await api.fillMissingValues(currentTable, colName, strategy, value, apiKey, weightCol || undefined);
            alert(`Filled missing values. Rows affected: ${result.rows_affected}`);
            fetchData();
        } catch (err: any) {
            alert(`Failed to fill missing values: ${err.message}`);
        }
    };

    const handleAnalyzeTable = () => {
        onClose();
        // Navigate to query page with this table as context
        navigate('/query', { state: { initialQuery: `Analyze the table '${currentTable}'.` } });
    };

    const handleDeleteTable = async () => {
        if (!window.confirm(`Are you sure you want to delete table '${currentTable}'? This cannot be undone.`)) return;
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error("No API key");
            await api.deleteTable(currentTable, apiKey);
            onClose(); // Close inspector since table is gone
            // Optionally refresh overview via a callback, but closing is minimal viable
            alert("Table deleted.");
            window.location.reload(); // Quick refresh to update lists
        } catch (err: any) {
            alert(`Failed to delete table: ${err.message}`);
        }
    };

    return (
        <div className="table-inspector-modal">
            <div className="card-panel inspector-card">
                <div className="inspector-header">
                    <div className="header-title">
                        <LayoutGrid size={20} className="icon-primary" />
                        <div>
                            <h3>{currentTable}</h3>
                            <div className="badges">
                                <span className="badge">Preview (50 rows)</span>
                                {isEditing && <span className="badge warning">Sandbox Mode</span>}
                            </div>
                        </div>
                    </div>
                    <div className="header-actions">
                        {isEditing ? (
                            <>
                                <button
                                    onClick={handleAnalyzeTable}
                                    className="btn btn-primary btn-sm"
                                >
                                    <PlayCircle size={14} />
                                    <span>Analyze Table</span>
                                </button>
                                <button
                                    onClick={handleDeleteTable}
                                    className="btn btn-icon danger"
                                    title="Delete Table"
                                >
                                    <Trash2 size={20} />
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={handleEnterEditMode}
                                className="btn btn-secondary btn-sm"
                                disabled={isDuplicating}
                            >
                                {isDuplicating ? <Loader2 size={14} className="spin" /> : <Edit3 size={14} />}
                                <span>{isDuplicating ? 'Creating Copy...' : 'Edit Data'}</span>
                            </button>
                        )}
                        <button onClick={onClose} className="btn-icon close-btn">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="inspector-content">
                    {loading && (
                        <div className="loading-state">
                            <Loader2 size={24} className="spin icon-primary" />
                            <p>Loading table data...</p>
                        </div>
                    )}

                    {error && (
                        <div className="error-state">
                            <AlertCircle size={24} className="icon-error" />
                            <p>{error}</p>
                        </div>
                    )}

                    {!loading && !error && data && (
                        <>
                            {isEditing && (
                                <div className="edit-banner">
                                    <AlertCircle size={16} />
                                    <span>
                                        <b>Sandbox Mode Active:</b> You are editing a copy of the data ({currentTable}).
                                        Original data is safe. Click a cell to edit. Use headers to rename/drop/fill columns.
                                    </span>
                                </div>
                            )}
                            <div className="data-grid-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            {data.columns.filter((c: any) => c.name !== '_id').map((col: any) => (
                                                <th key={col.name}>
                                                    <div className="th-content">
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span>{col.name}</span>
                                                            {isEditing && (
                                                                <div className="col-actions">
                                                                    <button onClick={() => handleFillMissing(col.name)} title="Fill Missing" className="icon-btn-tiny"><PaintBucket size={12} /></button>
                                                                    <button onClick={() => handleRenameColumn(col.name)} title="Rename" className="icon-btn-tiny"><Edit3 size={12} /></button>
                                                                    <button onClick={() => handleDropColumn(col.name)} title="Delete Column" className="icon-btn-tiny danger"><X size={12} /></button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <span className="col-type">{col.type}</span>
                                                    </div>
                                                </th>
                                            ))}
                                            {isEditing && <th style={{ width: '50px' }}>Actions</th>}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.rows.map((row: any, i: number) => {
                                            const rowId = row._id || i; // Fallback to index if no ID
                                            return (
                                                <tr key={i}>
                                                    {data.columns.filter((c: any) => c.name !== '_id').map((col: any) => {
                                                        const isCellEditing = editingCell?.rowId === rowId && editingCell?.col === col.name;
                                                        return (
                                                            <td
                                                                key={col.name}
                                                                onClick={() => handleCellClick(rowId, col.name, row[col.name])}
                                                                className={isEditing ? 'editable-cell' : ''}
                                                            >
                                                                {isCellEditing ? (
                                                                    <input
                                                                        autoFocus
                                                                        className="cell-input"
                                                                        defaultValue={String(row[col.name])}
                                                                        onBlur={(e) => handleCellSave(e.target.value)}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === 'Enter') handleCellSave(e.currentTarget.value);
                                                                            if (e.key === 'Escape') setEditingCell(null);
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <span title={String(row[col.name])}>{String(row[col.name])}</span>
                                                                )}
                                                            </td>
                                                        );
                                                    })}
                                                    {isEditing && (
                                                        <td>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleDeleteRow(rowId); }}
                                                                className="btn-icon danger"
                                                                title="Delete Row"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </td>
                                                    )}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <style>{`
                .table-inspector-modal {
                    position: fixed;
                    top: 0;
                    right: 0;
                    bottom: 0;
                    left: 0;
                    background-color: rgba(0,0,0,0.5);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 1000;
                    padding: 2rem;
                }

                .inspector-card {
                    width: 90%;
                    max-width: 1000px;
                    height: 80vh;
                    background: white;
                    border-radius: 12px;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.15);
                }

                .inspector-header {
                    padding: 1.25rem;
                    border-bottom: 1px solid var(--color-border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .header-title {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                }

                .badge {
                    background: #f1f5f9;
                    color: #64748b;
                    font-size: 0.75rem;
                    padding: 2px 8px;
                    border-radius: 12px;
                    font-weight: 500;
                }

                .inspector-content {
                    flex: 1;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }

                .loading-state, .error-state {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 1rem;
                    color: var(--color-text-secondary);
                }

                .icon-error { color: #ef4444; }

                .data-grid-container {
                    flex: 1;
                    overflow: auto;
                    padding: 0;
                }

                .data-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 0.9rem;
                }

                .data-table th {
                    background: #f8fafc;
                    position: sticky;
                    top: 0;
                    text-align: left;
                    padding: 0.75rem 1rem;
                    border-bottom: 1px solid var(--color-border);
                    color: var(--color-text-secondary);
                    font-weight: 600;
                    white-space: nowrap;
                    z-index: 10;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                }

                .th-content {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .col-type {
                    font-size: 0.7rem;
                    color: #94a3b8;
                    font-weight: 400;
                }

                .data-table td {
                    padding: 0.75rem 1rem;
                    border-bottom: 1px solid #f1f5f9;
                    color: var(--color-text-primary);
                    white-space: nowrap;
                    max-width: 300px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .data-table tbody tr:hover {
                    background-color: #f8fafc;
                }

                .close-btn:hover {
                    background-color: #fee2e2;
                    color: #ef4444;
                }
                
                .header-actions { display: flex; gap: 1rem; align-items: center; }
                .badges { display: flex; gap: 0.5rem; margin-top: 0.2rem; }
                .badge.warning { background: #fffbeb; color: #d97706; border: 1px solid #fcd34d; }
                
                .edit-banner {
                    background: #eff6ff;
                    border-bottom: 1px solid #bfdbfe;
                    padding: 0.75rem 1.25rem;
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    font-size: 0.9rem;
                    color: #1e40af;
                }
                
                .editable-cell { cursor: pointer; }
                .editable-cell:hover { background-color: #f1f5f9; }
                
                .cell-input {
                    width: 100%;
                    padding: 0.25rem;
                    border: 2px solid var(--color-primary);
                    border-radius: 4px;
                    font-family: inherit;
                    font-size: inherit;
                    outline: none;
                }
                
                .btn-sm { padding: 0.4rem 0.8rem; font-size: 0.85rem; }
                
                .col-actions { display: flex; gap: 4px; }
                .icon-btn-tiny {
                    background: none; border: none; cursor: pointer; padding: 2px; color: #94a3b8; border-radius: 4px;
                }
                .icon-btn-tiny:hover { background: #e2e8f0; color: #475569; }
                .icon-btn-tiny.danger:hover { background: #fee2e2; color: #ef4444; }
                
                .btn-icon.danger { color: #cbd5e1; }
                .btn-icon.danger:hover { color: #ef4444; background: #fee2e2; }
            `}</style>
        </div>
    );
};
