import React, { useState, useEffect, useCallback } from 'react';
import { Database, Copy, Trash2, Edit2, Zap, AlertCircle, CheckCircle2, RefreshCw, BookOpen, ChevronDown, ChevronUp, Sparkles, Save, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';

interface DataManagementProps {
    apiKey: string;
    onConfigured?: () => void;
    user?: { permissions?: string[] };
}

export function DataManagement({ apiKey, onConfigured, user }: DataManagementProps) {
    const hasMutatePerm = Array.isArray(user?.permissions) && user.permissions.includes('MUTATE_TABLES');

    const [tables, setTables] = useState<string[]>([]);
    const [selectedTable, setSelectedTable] = useState<string>('');
    const [tableData, setTableData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Cell Edit State
    const [editingCell, setEditingCell] = useState<{ rowId: string, column: string } | null>(null);
    const [editValue, setEditValue] = useState<string>('');

    // Column Descriptions State
    const [colDescs, setColDescs] = useState<{ table_name: string; column_name: string; description: string; generated_by: string }[]>([]);
    const [showColDescs, setShowColDescs] = useState(false);
    const [editingDesc, setEditingDesc] = useState<{ col: string; val: string } | null>(null);
    const [savingDesc, setSavingDesc] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [colDescsMsg, setColDescsMsg] = useState<string | null>(null);

    // Fill Missing State
    const [showFillModal, setShowFillModal] = useState(false);
    const [fillConfig, setFillConfig] = useState({
        column: '',
        strategy: 'mean',
        value: ''
    });

    useEffect(() => {
        fetchTables();
    }, [apiKey]);

    useEffect(() => {
        if (selectedTable) {
            fetchTablePreview(selectedTable);
            fetchColDescs(selectedTable);
        } else {
            setTableData(null);
            setColDescs([]);
        }
    }, [selectedTable]);

    const fetchColDescs = useCallback(async (tableName: string) => {
        try {
            const resp = await api.get<any>(`/column-descriptions?table_name=${encodeURIComponent(tableName)}`);
            setColDescs(resp || []);
        } catch {
            setColDescs([]);
        }
    }, []);

    const handleSaveDesc = async () => {
        if (!editingDesc || !selectedTable || savingDesc) return;
        setSavingDesc(true);
        setColDescsMsg(null);
        try {
            await api.put(`/column-descriptions/${encodeURIComponent(selectedTable)}/${encodeURIComponent(editingDesc.col)}`, {
                description: editingDesc.val,
            });
            setColDescs((prev: typeof colDescs) => prev.map((d: typeof colDescs[0]) =>
                d.column_name === editingDesc.col
                    ? { ...d, description: editingDesc.val, generated_by: 'manual' }
                    : d
            ));
            setEditingDesc(null);
            setColDescsMsg('Description saved.');
        } catch (err: any) {
            setColDescsMsg(`Save failed: ${err.message || 'Unknown error'}`);
        } finally {
            setSavingDesc(false);
        }
    };

    const handleRegenerate = async () => {
        if (!selectedTable || regenerating) return;
        setRegenerating(true);
        setColDescsMsg(null);
        try {
            await api.post(`/column-descriptions/${encodeURIComponent(selectedTable)}/regenerate`, {});
            setColDescsMsg('Re-generation started — descriptions will update in a few seconds.');
            // Poll once after 4 s to pick up new descriptions
            setTimeout(() => fetchColDescs(selectedTable), 4000);
        } catch (err: any) {
            setColDescsMsg(`Regenerate failed: ${err.message || 'Unknown error'}`);
        } finally {
            setRegenerating(false);
        }
    };

    const fetchTables = useCallback(async () => {
        try {
            const resp = await api.get<any>('/tables');
            setTables(resp.tables || []);
            if (resp.tables?.length > 0 && !selectedTable) {
                setSelectedTable(resp.tables[0]);
            }
        } catch (err) {
            console.error(err);
            setError('Failed to fetch tables');
        }
    }, [selectedTable]);

    const fetchTablePreview = useCallback(async (tableName: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const resp = await api.get<any>(`/tables/${tableName}/preview`);
            setTableData(resp);
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to load table details');
            setTableData(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const handleDuplicate = async () => {
        if (!selectedTable) return;
        setIsLoading(true);
        setError(null);
        setSuccess(null);
        try {
            const resp = await api.post<any>(`/tables/${selectedTable}/duplicate`, {});
            setSuccess(`Table duplicated successfully as ${resp.new_table}`);
            await fetchTables();
            setSelectedTable(resp.new_table);
        } catch (err: any) {
            setError(err.message || 'Failed to duplicate table');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedTable) return;
        if (!confirm(`Are you sure you want to delete table '${selectedTable}'?`)) return;
        setIsLoading(true);
        setError(null);
        setSuccess(null);
        try {
            await api.delete(`/tables/${selectedTable}`);
            setSuccess(`Table '${selectedTable}' deleted successfully`);
            const newTables = tables.filter(t => t !== selectedTable);
            setTables(newTables);
            setSelectedTable(newTables.length > 0 ? newTables[0] : '');
        } catch (err: any) {
            setError(err.message || 'Failed to delete table');
        } finally {
            setIsLoading(false);
        }
    };

    const saveCellEdit = async (rowId: string, column: string) => {
        if (!selectedTable) return;
        try {
            await api.patch(`/tables/${selectedTable}/cell`, {
                row_id: rowId,
                column: column,
                value: editValue
            });
            setSuccess('Cell updated successfully');
            setEditingCell(null);
            fetchTablePreview(selectedTable);
        } catch (err: any) {
            setError(err.message || 'Failed to update cell');
        }
    };

    const handleFillMissing = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTable || !fillConfig.column) return;
        setIsLoading(true);
        setError(null);
        setSuccess(null);
        try {
            const resp = await api.post<any>(`/tables/${selectedTable}/columns/${fillConfig.column}/fill`, {
                strategy: fillConfig.strategy,
                value: fillConfig.strategy === 'value' ? fillConfig.value : null
            });
            setSuccess(`Successfully filled missing values (${resp.rows_affected} rows affected)`);
            setShowFillModal(false);
            fetchTablePreview(selectedTable);
        } catch (err: any) {
            setError(err.message || 'Failed to fill missing values');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8">
            <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">Data Management</h1>
                <p className="text-sm text-gray-500 mt-1">View, edit, and manage your database tables.</p>
            </div>

            {error && (
                <div className="p-4 bg-red-50 text-red-600 rounded-lg flex items-center gap-3">
                    <AlertCircle className="size-5" />
                    {error}
                </div>
            )}

            {success && (
                <div className="p-4 bg-green-50 text-green-600 rounded-lg flex items-center gap-3">
                    <CheckCircle2 className="size-5" />
                    {success}
                </div>
            )}

            <div className="bg-white p-4 md:p-6 rounded-xl border border-gray-200 shadow-sm">
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Table</label>
                <div className="flex gap-2 md:gap-4 items-center">
                    <div className="relative flex-1 max-w-md">
                        <Database className="absolute left-3 top-1/2 -translate-y-1/2 size-4 md:size-5 text-gray-400" />
                        <select
                            value={selectedTable}
                            onChange={(e) => setSelectedTable(e.target.value)}
                            className="w-full pl-9 md:pl-10 pr-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none text-sm md:text-base cursor-pointer"
                        >
                            {tables.length === 0 && <option value="">No tables available</option>}
                            {tables.map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    </div>

                    <button
                        onClick={fetchTables}
                        className="p-2 text-gray-500 hover:text-blue-600 transition-colors"
                        title="Refresh Tables"
                    >
                        <RefreshCw className="size-5" />
                    </button>
                </div>
            </div>

            {isLoading && !tableData && (
                <div className="flex items-center justify-center p-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
            )}

            {tableData && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex gap-4 text-sm">
                            <div className="bg-blue-50 text-blue-700 font-medium px-4 py-2 rounded-lg">
                                Records: {tableData.total_rows}
                            </div>
                            <div className="bg-purple-50 text-purple-700 font-medium px-4 py-2 rounded-lg">
                                Columns: {tableData.columns?.length || 0}
                            </div>
                        </div>

                        {hasMutatePerm && (
                            <div className="flex flex-wrap gap-2 md:gap-3">
                                <button
                                    onClick={() => setShowFillModal(true)}
                                    className="flex items-center gap-2 px-3 md:px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors text-xs md:text-sm font-medium border border-indigo-100"
                                >
                                    <Zap className="size-4" />
                                    <span className="hidden sm:inline">Fill Missing</span>
                                    <span className="sm:hidden">Fill</span>
                                </button>
                                <button
                                    onClick={handleDuplicate}
                                    disabled={isLoading}
                                    className="flex items-center gap-2 px-3 md:px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors text-xs md:text-sm font-medium border border-emerald-100"
                                >
                                    <Copy className="size-4" />
                                    <span className="hidden sm:inline">Duplicate Table</span>
                                    <span className="sm:hidden">Duplicate</span>
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={isLoading}
                                    className="flex items-center gap-2 px-3 md:px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-xs md:text-sm font-medium border border-red-100"
                                >
                                    <Trash2 className="size-4" />
                                    Delete
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
                        {isLoading && (
                            <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            </div>
                        )}
                        <div className="overflow-x-auto max-h-[600px]">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50 sticky top-0 z-0 shadow-sm">
                                    <tr>
                                        {tableData.columns?.map((col: any) => (
                                            <th key={col.name} className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                                                {col.name} <span className="text-[10px] text-gray-400 normal-case ml-1">({col.type})</span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {tableData.rows?.map((row: any, i: number) => {
                                        // Extract ID using _id if returned by the backend logic, else just index for mapping
                                        const rowId = row._id || i.toString();

                                        return (
                                            <tr key={i} className="hover:bg-gray-50 transition-colors">
                                                {tableData.columns?.map((col: any) => {
                                                    const isEditing = editingCell?.rowId === rowId && editingCell?.column === col.name;
                                                    return (
                                                        <td
                                                            key={col.name}
                                                            className="px-6 py-4 text-sm text-gray-900 group relative select-all"
                                                        >
                                                            {isEditing ? (
                                                                <input
                                                                    type="text"
                                                                    autoFocus
                                                                    value={editValue}
                                                                    onChange={e => setEditValue(e.target.value)}
                                                                    onBlur={() => saveCellEdit(rowId, col.name)}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') saveCellEdit(rowId, col.name);
                                                                        if (e.key === 'Escape') setEditingCell(null);
                                                                    }}
                                                                    className="w-full px-2 py-1 border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                                />
                                                            ) : (
                                                                <div className="flex items-center justify-between gap-4">
                                                                    <span className="truncate max-w-[200px]">
                                                                        {row[col.name] !== null ? String(row[col.name]) : <em className="text-gray-400">null</em>}
                                                                    </span>
                                                                    {row._id && hasMutatePerm && (
                                                                        <button
                                                                            onClick={() => {
                                                                                setEditingCell({ rowId, column: col.name });
                                                                                setEditValue(row[col.name] !== null ? String(row[col.name]) : '');
                                                                            }}
                                                                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-blue-600 rounded transition-all"
                                                                        >
                                                                            <Edit2 className="size-3" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {tableData.rows?.length === 0 && (
                                <div className="p-12 text-center text-gray-500">
                                    No records found in this table.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Column Descriptions Panel */}
            {selectedTable && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <button
                        onClick={() => setShowColDescs(v => !v)}
                        className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <BookOpen className="size-5 text-purple-600" />
                            <span className="font-semibold text-gray-900">Column Descriptions</span>
                            {colDescs.length > 0 && (
                                <span className="bg-purple-100 text-purple-700 text-xs font-medium px-2.5 py-0.5 rounded-full">
                                    {colDescs.length} column{colDescs.length !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>
                        {showColDescs ? <ChevronUp className="size-4 text-gray-400" /> : <ChevronDown className="size-4 text-gray-400" />}
                    </button>

                    {showColDescs && (
                        <div className="border-t border-gray-100">
                            <div className="px-6 py-3 flex items-center justify-between bg-gray-50/50">
                                <p className="text-xs text-gray-500">
                                    AI-generated descriptions help the assistant understand ambiguous column names.
                                    Click any description to edit it.
                                </p>
                                <button
                                    onClick={handleRegenerate}
                                    disabled={regenerating}
                                    className="flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 disabled:opacity-50 transition-colors ml-4 shrink-0"
                                >
                                    {regenerating
                                        ? <><RefreshCw className="size-3.5 animate-spin" /> Regenerating…</>
                                        : <><Sparkles className="size-3.5" /> Re-generate all</>
                                    }
                                </button>
                            </div>

                            {colDescsMsg && (
                                <div className="mx-6 mt-3 px-3 py-2 bg-blue-50 text-blue-700 text-xs rounded-lg">
                                    {colDescsMsg}
                                </div>
                            )}

                            {colDescs.length === 0 ? (
                                <div className="px-6 py-8 text-center text-gray-400 text-sm">
                                    No descriptions yet — they are generated automatically after import,
                                    or click <span className="font-medium text-purple-600">Re-generate all</span>.
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-100">
                                    {colDescs.map(({ column_name, description, generated_by }: { column_name: string; description: string; generated_by: string }) => (
                                        <div key={column_name} className="px-6 py-3 flex items-start gap-4 group">
                                            <div className="w-48 shrink-0 pt-0.5">
                                                <span className="text-sm font-mono font-medium text-gray-800">{column_name}</span>
                                                <span className={`ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                                    generated_by === 'manual'
                                                        ? 'bg-green-100 text-green-700'
                                                        : 'bg-purple-100 text-purple-600'
                                                }`}>
                                                    {generated_by === 'manual' ? 'edited' : 'AI'}
                                                </span>
                                            </div>

                                            {editingDesc?.col === column_name ? (
                                                <div className="flex-1 flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={editingDesc.val}
                                                        onChange={e => setEditingDesc({ col: column_name, val: e.target.value })}
                                                        onKeyDown={e => { if (e.key === 'Enter') handleSaveDesc(); if (e.key === 'Escape') setEditingDesc(null); }}
                                                        autoFocus
                                                        className="flex-1 px-3 py-1.5 text-sm border border-purple-400 rounded-lg focus:ring-2 focus:ring-purple-300 outline-none"
                                                    />
                                                    <button
                                                        onClick={handleSaveDesc}
                                                        disabled={savingDesc}
                                                        className="p-1.5 text-purple-600 hover:text-purple-700 disabled:opacity-50"
                                                        title="Save"
                                                    >
                                                        <Save className="size-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingDesc(null)}
                                                        className="p-1.5 text-gray-400 hover:text-gray-600"
                                                        title="Cancel"
                                                    >
                                                        <RotateCcw className="size-4" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => { setEditingDesc({ col: column_name, val: description }); setColDescsMsg(null); }}
                                                    className="flex-1 text-left text-sm text-gray-600 hover:text-gray-900 py-1 px-2 -mx-2 rounded hover:bg-gray-50 transition-colors group-hover:text-gray-700"
                                                    title="Click to edit"
                                                >
                                                    {description || <em className="text-gray-300">no description</em>}
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Fill Missing Values Modal */}
            {showFillModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-gray-100">
                            <h3 className="text-xl font-bold text-gray-900">Fill Missing Values</h3>
                        </div>

                        <form onSubmit={handleFillMissing} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Column</label>
                                <select
                                    required
                                    value={fillConfig.column}
                                    onChange={e => setFillConfig({ ...fillConfig, column: e.target.value })}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">Select column...</option>
                                    {tableData?.columns?.map((c: any) => (
                                        <option key={c.name} value={c.name}>{c.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Strategy</label>
                                <select
                                    value={fillConfig.strategy}
                                    onChange={e => setFillConfig({ ...fillConfig, strategy: e.target.value })}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="mean">Mean (Average)</option>
                                    <option value="median">Median</option>
                                    <option value="mode">Mode (Most Frequent)</option>
                                    <option value="value">Specific Value</option>
                                </select>
                            </div>

                            {fillConfig.strategy === 'value' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Value</label>
                                    <input
                                        type="text"
                                        required
                                        value={fillConfig.value}
                                        onChange={e => setFillConfig({ ...fillConfig, value: e.target.value })}
                                        placeholder="Enter fill value..."
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            )}

                            <div className="flex gap-3 justify-end pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowFillModal(false)}
                                    className="px-5 py-2.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isLoading || !fillConfig.column}
                                    className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition-colors font-medium"
                                >
                                    Apply Fill
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
