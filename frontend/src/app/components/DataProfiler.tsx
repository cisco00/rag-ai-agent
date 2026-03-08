import { useState, useEffect } from 'react';
import { BarChart3, RefreshCw, ChevronDown, ChevronUp, Table, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';

interface ColumnProfile {
    column: string;
    dtype: string;
    total_count: number;
    null_count: number;
    null_pct: number;
    distinct_count: number;
    min?: number | string;
    max?: number | string;
    mean?: number;
    median?: number;
    std?: number;
    p25?: number;
    p75?: number;
    top_values?: [string, number][];
    sample_values?: any[];
}

interface TableProfile {
    table: string;
    row_count: number;
    column_count: number;
    columns: ColumnProfile[];
    profiled_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function DataProfiler({ apiKey: _apiKey }: { apiKey: string }) {
    const [profiles, setProfiles] = useState<Record<string, TableProfile>>({});
    const [tables, setTables] = useState<string[]>([]);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [profile, setProfile] = useState<TableProfile | null>(null);
    const [loading, setLoading] = useState(false);
    const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());

    const fetchTables = async () => {
        try {
            const d = await api.get<{ tables: string[] }>('/tables');
            setTables(d.tables || []);
        } catch (e) { console.error(e); }
    };

    useEffect(() => { fetchTables(); }, []);

    const profileTable = async (tableName: string, force = false) => {
        setSelectedTable(tableName);
        setLoading(true);
        try {
            const d = await api.get<{ profile: TableProfile }>(`/tables/${tableName}/profile${force ? '?force=true' : ''}`);
            setProfile(d.profile);
            setProfiles(prev => ({ ...prev, [tableName]: d.profile }));
        } catch (e: any) { alert(e.message || 'Failed to profile table'); setProfile(null); }
        setLoading(false);
    };

    const toggleCol = (col: string) => {
        setExpandedCols(prev => {
            const next = new Set(prev);
            if (next.has(col)) next.delete(col); else next.add(col);
            return next;
        });
    };

    const NullBar = ({ pct }: { pct: number }) => (
        <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct > 50 ? '#ef4444' : pct > 20 ? '#f59e0b' : '#10b981' }} />
            </div>
            <span className="text-xs text-gray-500 w-10 text-right">{pct.toFixed(1)}%</span>
        </div>
    );

    return (
        <div className="flex h-full">
            {/* Table list */}
            <aside className="w-64 border-r border-gray-200 bg-white flex flex-col">
                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center gap-2 mb-1">
                        <BarChart3 className="size-5 text-purple-600" />
                        <h2 className="font-semibold text-gray-900">Data Profiler</h2>
                    </div>
                    <p className="text-xs text-gray-500">Column-level statistics for all tables</p>
                </div>
                <nav className="flex-1 overflow-y-auto p-2 space-y-1">
                    {tables.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No tables found. Import data first.</p>}
                    {tables.map(t => (
                        <button key={t} onClick={() => profileTable(t)}
                            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${selectedTable === t ? 'bg-purple-50 text-purple-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>
                            <Table className="size-3.5 flex-shrink-0 opacity-60" />
                            <span className="truncate font-mono">{t}</span>
                            {profiles[t] && <span className="ml-auto text-xs text-gray-400">{profiles[t].row_count.toLocaleString()}</span>}
                        </button>
                    ))}
                </nav>
            </aside>

            {/* Main content */}
            <main className="flex-1 overflow-auto p-6 bg-gray-50">
                {!selectedTable && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <BarChart3 className="size-16 opacity-20 mb-4" />
                        <p className="text-lg">Select a table to profile it</p>
                        <p className="text-sm mt-1">Column stats, null rates, min/max/mean and more</p>
                    </div>
                )}

                {loading && (
                    <div className="flex items-center justify-center h-48 gap-3 text-gray-500">
                        <RefreshCw className="size-5 animate-spin text-purple-500" />
                        <span>Profiling <span className="font-mono">{selectedTable}</span>…</span>
                    </div>
                )}

                {!loading && profile && (
                    <div className="max-w-4xl mx-auto space-y-4">
                        {/* Summary card */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h1 className="text-xl font-bold text-gray-900 font-mono">{profile.table}</h1>
                                    <p className="text-sm text-gray-500 mt-0.5">
                                        Profiled {new Date(profile.profiled_at).toLocaleString()}
                                    </p>
                                </div>
                                <button onClick={() => profileTable(profile.table, true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 text-gray-700">
                                    <RefreshCw className="size-3.5" />Refresh
                                </button>
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                {[
                                    { label: 'Rows', value: profile.row_count.toLocaleString() },
                                    { label: 'Columns', value: profile.column_count },
                                    { label: 'Avg Null %', value: `${(profile.columns.reduce((s, c) => s + c.null_pct, 0) / profile.column_count).toFixed(1)}%` },
                                ].map(s => (
                                    <div key={s.label} className="bg-gray-50 rounded-lg p-3 text-center">
                                        <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                                        <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Column list */}
                        <div className="space-y-2">
                            {profile.columns.map(col => {
                                const expanded = expandedCols.has(col.column);
                                const isNumeric = ['int', 'float', 'number', 'decimal'].some(t => col.dtype.toLowerCase().includes(t));
                                return (
                                    <div key={col.column} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                        <button onClick={() => toggleCol(col.column)} className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors">
                                            <div className="w-48 text-left truncate">
                                                <span className="font-mono text-sm font-medium text-gray-900">{col.column}</span>
                                                <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{col.dtype}</span>
                                            </div>
                                            <div className="flex-1"><NullBar pct={col.null_pct} /></div>
                                            <div className="flex items-center gap-6 text-xs text-gray-500 w-64 justify-end">
                                                <span>{col.distinct_count.toLocaleString()} distinct</span>
                                                <span>{col.null_count} nulls</span>
                                            </div>
                                            {expanded ? <ChevronUp className="size-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="size-4 text-gray-400 flex-shrink-0" />}
                                        </button>
                                        {expanded && (
                                            <div className="border-t border-gray-100 px-4 py-4 bg-gray-50">
                                                {isNumeric && (col.mean !== undefined) ? (
                                                    <div className="grid grid-cols-5 gap-3">
                                                        {[
                                                            { label: 'Min', value: col.min },
                                                            { label: 'P25', value: col.p25 },
                                                            { label: 'Median', value: col.median },
                                                            { label: 'Mean', value: col.mean?.toFixed(2) },
                                                            { label: 'Max', value: col.max },
                                                        ].map(s => (
                                                            <div key={s.label} className="bg-white rounded-lg p-2 text-center border border-gray-100">
                                                                <p className="text-sm font-semibold text-gray-800">{s.value ?? '—'}</p>
                                                                <p className="text-xs text-gray-400">{s.label}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : col.top_values && col.top_values.length > 0 ? (
                                                    <div>
                                                        <p className="text-xs font-medium text-gray-600 mb-2">Top Values</p>
                                                        <div className="space-y-1">
                                                            {col.top_values.slice(0, 5).map(([val, cnt]) => (
                                                                <div key={val} className="flex items-center gap-2">
                                                                    <span className="text-xs font-mono text-gray-700 w-32 truncate">{String(val)}</span>
                                                                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                                                                        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(cnt / col.total_count) * 100}%` }} />
                                                                    </div>
                                                                    <span className="text-xs text-gray-400 w-8 text-right">{cnt}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 text-gray-400">
                                                        <AlertCircle className="size-4" />
                                                        <span className="text-sm">No detailed stats available for this column type.</span>
                                                    </div>
                                                )}
                                                {col.sample_values && col.sample_values.length > 0 && (
                                                    <div className="mt-3">
                                                        <p className="text-xs font-medium text-gray-600 mb-1">Sample Values</p>
                                                        <div className="flex flex-wrap gap-1">
                                                            {col.sample_values.slice(0, 8).map((v, i) => (
                                                                <span key={i} className="text-xs bg-white border border-gray-200 rounded px-2 py-0.5 font-mono">{String(v)}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
