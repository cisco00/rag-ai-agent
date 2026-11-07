import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Wrench, Plus, Play, Eye, AlertCircle, CheckCircle,
  Trash2, ArrowRightLeft, Save, FolderOpen, BarChart2,
  GripVertical, X, ChevronDown, ChevronUp, Download,
  Lightbulb, MessageSquare, Send, RotateCcw,
  Clock, Layers, CheckSquare, Square, RefreshCw,
  AlertTriangle, BookOpen, Sparkles,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Operation {
  id: string;
  type: string;
  params: Record<string, any>;
}

interface SavedPipeline {
  id: number;
  name: string;
  table_name: string;
  operations: Operation[];
  updated_at: string;
}

interface ColProfile {
  dtype: string;
  count: number;
  null_count: number;
  null_pct: number;
  unique_count: number;
  // numeric
  min?: number;
  max?: number;
  mean?: number;
  std?: number;
  histogram?: { counts: number[]; edges: number[] };
  // categorical
  top_values?: { value: string; count: number }[];
}

interface AutoSuggestion {
  id: string;
  label: string;
  detail: string;
  severity: 'warn' | 'info';
  operation: { type: string; params: Record<string, any> };
}

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  operations?: Operation[];  // operations generated in this turn
}

interface PipelineScheduleInfo {
  scheduled: boolean;
  schedule_id?: number;
  frequency?: string;
  is_active?: boolean;
  next_run_at?: string;
  last_run_at?: string;
  last_run_status?: string;
  last_run_message?: string;
}

interface BatchResult {
  table: string;
  status: 'success' | 'error' | 'skipped';
  target?: string;
  rows?: number;
  message?: string;
}

// ── Helper: download array-of-objects as CSV ─────────────────────────────────

function downloadCSV(rows: Record<string, any>[], filename = 'preview.csv') {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Helper: map frontend ops → backend canonical format ──────────────────────

function mapOpForBackend(op: Operation): Record<string, any> {
  const p = op.params;
  switch (op.type) {
    case 'drop_duplicates':    return { type: 'clean',  method: 'drop_duplicates',  subset: p.subset || undefined };
    case 'clean_text':         return { type: 'clean',  method: 'clean_text',       column: p.column, clean_type: p.operation || 'lower' };
    case 'remove_outliers':    return { type: 'clean',  method: 'remove_outliers',  column: p.column, outlier_method: 'z-score', threshold: p.threshold ?? 3 };
    case 'filter':             return { type: 'filter', column: p.column, op: p.operator || '>', value: p.value };
    case 'rename_col':         return { type: 'rename_col',  column: p.column, new_name: p.new_name };
    case 'drop_col':           return { type: 'drop_col',    column: p.column };
    case 'change_type':        return { type: 'change_type', column: p.column, new_type: p.new_type || 'str' };
    case 'fill_na':            return { type: 'fill_na',     column: p.column, method: p.method || 'mean', value: p.value };
    case 'normalize':          return { type: 'normalize',   columns: p.columns || [], method: p.method || 'minmax' };
    case 'encode':             return { type: 'encode',      column: p.column, method: p.method || 'onehot' };
    case 'feature_engineering':return { type: 'feature_engineering', feature_type: p.feat_type || 'interaction', ...p };
    case 'text_feature':       return { type: 'text_feature', column: p.column, method: p.feature || 'len' };
    case 'groupby':            return { type: 'aggregate', method: 'groupby', group_cols: (p.group_cols || '').split(',').map((c:string)=>c.trim()).filter(Boolean), aggregations: (() => { try { return JSON.parse(p.aggregations||'{}'); } catch { return {}; } })() };
    case 'resample':           return { type: 'aggregate', method: 'resample', date_col: p.time_column, freq: p.frequency || 'D', aggregations: (() => { try { return JSON.parse(p.agg_json||'{}'); } catch { return {}; } })() };
    default:                   return { type: op.type, ...p };
  }
}

// ── Sortable operation card wrapper ──────────────────────────────────────────

function SortableCard({ op, index, onRemove, conflicts, children }: {
  op: Operation; index: number; onRemove: () => void;
  conflicts?: string[]; children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: op.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const operationLabels: Record<string, string> = {
    drop_duplicates: 'Drop Duplicates', clean_text: 'Clean Text', remove_outliers: 'Remove Outliers',
    filter: 'Filter Rows', rename_col: 'Rename Column', drop_col: 'Drop Column',
    change_type: 'Change Type', fill_na: 'Fill Missing Values', normalize: 'Normalize',
    encode: 'Encode', feature_engineering: 'Feature Engineering', text_feature: 'Text Features',
    groupby: 'Summarize (Group By)', resample: 'Time Series Resample',
  };

  const hasConflicts = conflicts && conflicts.length > 0;

  return (
    <div ref={setNodeRef} style={style}
      className={`p-4 border-2 rounded-lg transition-colors ${isDragging ? 'border-blue-400 shadow-lg bg-blue-50' : hasConflicts ? 'border-amber-400 bg-amber-50/40' : 'border-gray-200 hover:border-blue-300'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button {...attributes} {...listeners}
            className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing p-0.5 rounded touch-none">
            <GripVertical className="size-5" />
          </button>
          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold">#{index + 1}</span>
          <h3 className="font-bold text-gray-900 text-sm">
            {op.params.friendly_description || operationLabels[op.type] || op.type}
          </h3>
          {hasConflicts && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold border border-amber-200">
              <AlertTriangle className="size-3" /> {conflicts!.length} conflict{conflicts!.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button onClick={onRemove} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded text-lg leading-none">×</button>
      </div>
      {hasConflicts && (
        <div className="mb-3 space-y-1">
          {conflicts!.map((msg, i) => (
            <p key={i} className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              <AlertTriangle className="size-3 shrink-0 mt-0.5" />{msg}
            </p>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Searchable column combobox ───────────────────────────────────────────────

function ColumnCombobox({
  value, onChange, columns, placeholder = 'Select column',
}: {
  value: string;
  onChange: (v: string) => void;
  columns: string[];
  placeholder?: string;
}) {
  const [query, setQuery]   = useState('');
  const [open, setOpen]     = useState(false);
  const [cursor, setCursor] = useState(0);
  const containerRef        = useRef<HTMLDivElement>(null);
  const inputRef            = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? columns.filter(c => c.toLowerCase().includes(query.toLowerCase()))
    : columns;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery('');
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = (col: string) => { onChange(col); setOpen(false); setQuery(''); setCursor(0); };

  const openDropdown = () => {
    setOpen(true);
    setCursor(value ? Math.max(0, filtered.indexOf(value)) : 0);
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const highlight = (col: string) => {
    if (!query.trim()) return <>{col}</>;
    const idx = col.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return <>{col}</>;
    return (
      <>
        {col.slice(0, idx)}
        <mark className="bg-yellow-100 text-yellow-900 not-italic rounded">{col.slice(idx, idx + query.length)}</mark>
        {col.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <button type="button"
        onClick={() => open ? setOpen(false) : openDropdown()}
        className="w-full flex items-center justify-between px-3 py-2 border border-blue-200 bg-blue-50 rounded text-sm text-blue-900 hover:border-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500">
        <span className={`truncate flex-1 text-left ${!value ? 'text-gray-400' : ''}`}>
          {value || placeholder}
        </span>
        <ChevronDown className={`size-3.5 text-gray-400 shrink-0 ml-1 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}/>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-full min-w-[160px] bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <input ref={inputRef} type="text" value={query}
              onChange={e => { setQuery(e.target.value); setCursor(0); }}
              placeholder="Search…"
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
                else if (e.key === 'Enter' && filtered.length > 0) { e.preventDefault(); select(filtered[cursor] ?? filtered[0]); }
                else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
              }}/>
          </div>
          <div className="max-h-44 overflow-y-auto py-1">
            {filtered.length === 0
              ? <p className="px-3 py-2 text-xs text-gray-400 text-center">No columns match</p>
              : filtered.map((col, i) => (
                <button key={col} type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => select(col)}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    i === cursor ? 'bg-blue-100 text-blue-800'
                      : col === value ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'}`}>
                  {highlight(col)}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tiny histogram (numeric columns) ─────────────────────────────────────────

function MiniHistogram({ counts, edges }: { counts: number[]; edges: number[] }) {
  const max = Math.max(...counts, 1);
  return (
    <div className="flex items-end gap-0.5 h-8 mt-1">
      {counts.map((c, i) => (
        <div key={i} title={`${edges[i].toFixed(2)} – ${edges[i+1]?.toFixed(2)}: ${c}`}
          style={{ height: `${Math.round((c / max) * 100)}%` }}
          className="flex-1 bg-blue-400 rounded-sm min-h-[2px]" />
      ))}
    </div>
  );
}

// ── Column profile card ───────────────────────────────────────────────────────

function ColumnCard({ name, stats }: { name: string; stats: ColProfile }) {
  const isNumeric = stats.histogram != null;
  const nullColor = stats.null_pct > 30 ? 'text-red-600' : stats.null_pct > 10 ? 'text-amber-600' : 'text-green-600';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-mono text-sm font-bold text-gray-900 truncate max-w-[140px]" title={name}>{name}</p>
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{stats.dtype}</span>
        </div>
        <span className={`text-xs font-semibold ${nullColor}`}>{stats.null_pct}% null</span>
      </div>
      <div className="text-xs text-gray-500 grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2">
        <span>Rows: <b className="text-gray-700">{stats.count.toLocaleString()}</b></span>
        <span>Unique: <b className="text-gray-700">{stats.unique_count.toLocaleString()}</b></span>
        {isNumeric && <>
          <span>Min: <b className="text-gray-700">{stats.min}</b></span>
          <span>Max: <b className="text-gray-700">{stats.max}</b></span>
          <span>Mean: <b className="text-gray-700">{stats.mean}</b></span>
          <span>Std: <b className="text-gray-700">{stats.std}</b></span>
        </>}
      </div>
      {isNumeric && stats.histogram && (
        <MiniHistogram counts={stats.histogram.counts} edges={stats.histogram.edges} />
      )}
      {!isNumeric && stats.top_values && stats.top_values.length > 0 && (
        <div className="space-y-1">
          {stats.top_values.map(({ value, count }) => {
            const pct = stats.count > 0 ? Math.round((count / stats.count) * 100) : 0;
            return (
              <div key={value} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 truncate flex-1 min-w-0" title={value}>{value || <i className="text-gray-400">empty</i>}</span>
                <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden shrink-0">
                  <div style={{ width: `${pct}%` }} className="h-full bg-blue-400 rounded-full" />
                </div>
                <span className="text-xs text-gray-400 w-7 text-right shrink-0">{pct}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DataTransformation({ }: { apiKey?: string }) {
  const [selectedTable, setSelectedTable] = useState('');
  const [operations, setOperations] = useState<Operation[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [success, setSuccess]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [tables, setTables]             = useState<string[]>([]);
  const [columns, setColumns]           = useState<string[]>([]);
  const [aiPrompt, setAiPrompt]         = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [missingSummary, setMissingSummary] = useState<Array<{column:string;missing:number;pct:number;suggested:string}>>([]);

  // Preview
  const [showPreview, setShowPreview]   = useState(false);
  const [previewBefore, setPreviewBefore] = useState<any[]>([]);
  const [previewAfter, setPreviewAfter]   = useState<any[]>([]);
  const [previewTab, setPreviewTab]       = useState<'before'|'after'>('after');
  const [runStats, setRunStats] = useState<{
    engine: string; sql_ops: number; pandas_ops: number; cte_count: number;
    total_time_ms: number; rows_before: number; rows_after: number;
  } | null>(null);

  // Pipeline save/load
  const [savedPipelines, setSavedPipelines] = useState<SavedPipeline[]>([]);
  const [showSaveInput, setShowSaveInput]   = useState(false);
  const [saveName, setSaveName]             = useState('');
  const [isSaving, setIsSaving]             = useState(false);
  const [showLoadMenu, setShowLoadMenu]     = useState(false);

  // Data profiling
  const [showProfile, setShowProfile]       = useState(false);
  const [profileData, setProfileData]       = useState<Record<string, ColProfile> | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Auto-suggestions (feature 5)
  const [autoSuggestions, setAutoSuggestions] = useState<AutoSuggestion[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());

  // Multi-step AI conversation (feature 6)
  const [aiConversation, setAiConversation] = useState<ConversationTurn[]>([]);
  const [showAiChat, setShowAiChat]         = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Schedule (feature 7) — per-pipeline schedule info cache
  const [schedules, setSchedules]           = useState<Record<number, PipelineScheduleInfo>>({});
  const [schedulingId, setSchedulingId]     = useState<number | null>(null); // which pipeline is open in schedule picker
  const [scheduleFreq, setScheduleFreq]     = useState('daily');

  // Conflict confirmation gate (features 9+)
  const [conflictConfirmMode, setConflictConfirmMode] = useState<'preview' | 'apply' | null>(null);

  // AI explain (feature 10)
  const [explanationText, setExplanationText] = useState<string | null>(null);
  const [explanationSummary, setExplanationSummary] = useState<string | null>(null);
  const [isExplaining, setIsExplaining]       = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);

  // Batch apply (feature 8)
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchPipelineId, setBatchPipelineId] = useState<number | null>(null);
  const [batchSelected, setBatchSelected]   = useState<Set<string>>(new Set());
  const [isBatching, setIsBatching]         = useState(false);
  const [batchResults, setBatchResults]     = useState<BatchResult[] | null>(null);

  // DnD sensors
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ── Feature 9: Operation conflict detection ─────────────────────────────────
  const pipelineConflicts = useMemo(() => {
    const conflicts = new Map<string, string[]>();
    const add = (id: string, msg: string) => {
      const list = conflicts.get(id) ?? [];
      list.push(msg);
      conflicts.set(id, list);
    };

    const droppedCols   = new Set<string>();
    const renamedCols   = new Map<string, string>(); // old → new
    const nonNumericCols= new Set<string>();
    const normalizedCols= new Set<string>();
    let afterGroupBy    = false;

    for (const op of operations) {
      const p = op.params;
      // Collect all column refs in this op
      const colsUsed: string[] = [];
      if (p.column)   colsUsed.push(p.column);
      if (p.column1)  colsUsed.push(p.column1);
      if (p.column2)  colsUsed.push(p.column2);
      if (p.subset)   p.subset.split(',').map((c: string) => c.trim()).filter(Boolean).forEach((c: string) => colsUsed.push(c));
      if (Array.isArray(p.columns)) colsUsed.push(...p.columns);
      else if (p.columns && typeof p.columns === 'string')
        p.columns.split(',').map((c: string) => c.trim()).filter(Boolean).forEach((c: string) => colsUsed.push(c));

      // 1. Using a column that was dropped earlier
      for (const col of colsUsed)
        if (droppedCols.has(col)) add(op.id, `"${col}" was dropped in a previous step`);

      // 2. Using the old name after a rename
      for (const col of colsUsed)
        if (renamedCols.has(col)) add(op.id, `"${col}" was renamed to "${renamedCols.get(col)}" earlier`);

      // 3. fill_na after normalize on the same column
      if (op.type === 'fill_na' && p.column && (normalizedCols.has(p.column) || normalizedCols.has('*')))
        add(op.id, `Filling nulls after normalizing "${p.column}" produces incorrect results — move Fill before Normalize`);

      // 4. Normalizing a non-numeric column
      if (op.type === 'normalize') {
        const cols: string[] = Array.isArray(p.columns) ? p.columns
          : typeof p.columns === 'string' ? p.columns.split(',').map((c: string) => c.trim()).filter(Boolean) : [];
        for (const col of cols)
          if (nonNumericCols.has(col)) add(op.id, `"${col}" was changed to a non-numeric type — Normalize requires numbers`);
      }

      // 5. Filter after Group By (operates on aggregated rows)
      if (op.type === 'filter' && afterGroupBy)
        add(op.id, `Filtering after Group By operates on aggregated rows — consider moving the filter before Group By`);

      // Update state for the ops that follow
      if (op.type === 'drop_col'    && p.column)             droppedCols.add(p.column);
      if (op.type === 'rename_col'  && p.column && p.new_name) renamedCols.set(p.column, p.new_name);
      if (op.type === 'change_type' && p.column) {
        if (['str','bool','datetime'].includes(p.new_type ?? '')) nonNumericCols.add(p.column);
        else nonNumericCols.delete(p.column);
      }
      if (op.type === 'groupby') afterGroupBy = true;
      if (op.type === 'normalize') {
        const cols: string[] = Array.isArray(p.columns) ? p.columns
          : typeof p.columns === 'string' ? p.columns.split(',').map((c: string) => c.trim()).filter(Boolean) : [];
        if (cols.length === 0) normalizedCols.add('*');
        else cols.forEach(c => normalizedCols.add(c));
      }
    }
    return conflicts;
  }, [operations]);

  const totalConflicts = useMemo(
    () => Array.from(pipelineConflicts.values()).reduce((n, msgs) => n + msgs.length, 0),
    [pipelineConflicts]
  );

  // ── Feature 11: Post-transform quality score ────────────────────────────────
  const qualityMetrics = useMemo(() => {
    const compute = (rows: any[]) => {
      if (!rows.length) return null;
      const cols = Object.keys(rows[0]);
      const totalCells = rows.length * cols.length;
      const nulls = rows.reduce(
        (n, row) => n + cols.filter(c => row[c] === null || row[c] === undefined || row[c] === '').length, 0
      );
      const completePct = Math.round(((totalCells - nulls) / totalCells) * 100);
      const rowStrs = rows.map(r => JSON.stringify(r));
      const dupRate = Math.round(((rows.length - new Set(rowStrs).size) / rows.length) * 100);
      return { completePct, dupRate, rowCount: rows.length };
    };
    if (!showPreview || (!previewBefore.length && !previewAfter.length)) return null;
    return { before: compute(previewBefore), after: compute(previewAfter) };
  }, [previewBefore, previewAfter, showPreview]);

  // ── Fetch tables ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const resp = await api.get<{ tables: string[] }>('/tables');
        if (resp.tables) {
          setTables(resp.tables);
          if (resp.tables.length > 0) setSelectedTable(resp.tables[0]);
        }
      } catch {}
    })();
  }, []);

  // ── Fetch columns on table change ───────────────────────────────────────────
  useEffect(() => {
    if (!selectedTable) return;
    setProfileData(null);
    setShowProfile(false);
    (async () => {
      try {
        const data = await api.get<any>(`/tables/${selectedTable}/preview?limit=1`);
        if (data?.columns) setColumns(data.columns.map((c:any) => c.name));
      } catch {}
    })();
  }, [selectedTable]);

  // ── Missing-values summary + auto-suggestions ──────────────────────────────
  useEffect(() => {
    if (!selectedTable) return;
    setAutoSuggestions([]);
    setDismissedSuggestions(new Set());
    (async () => {
      try {
        const data = await api.get<any>(`/tables/${selectedTable}/preview?limit=500`);
        if (data?.rows && data?.columns) {
          const colNames: string[] = data.columns.map((c:any) => c.name);
          const rows: any[] = data.rows;
          const total = rows.length;
          if (total === 0) return;

          const suggestions: AutoSuggestion[] = [];

          const colMeta = data.columns as Array<{ name: string; type: string }>;
          const summary = colNames.map(col => {
            const missing = rows.filter((r:any) => r[col] === null || r[col] === '' || r[col] === undefined).length;
            const pct = Math.round((missing/total)*100);
            const colType = (colMeta.find((c) => c.name===col)?.type||'').toLowerCase();
            const isNumeric = ['int','float','number','numeric','bigint','double','decimal'].some(t => colType.includes(t));
            return { column: col, missing, pct, suggested: isNumeric ? 'mean' : 'mode', isNumeric, colType };
          });
          setMissingSummary(summary.filter(s => s.missing > 0));

          // ── Suggestion rules ───────────────────────────────────────────────

          // 1. Columns with >10% nulls
          summary.filter(s => s.pct > 10).forEach(s => {
            suggestions.push({
              id: `fill_${s.column}`,
              label: `Fill nulls in "${s.column}"`,
              detail: `${s.pct}% missing — suggest filling with ${s.suggested}`,
              severity: s.pct > 30 ? 'warn' : 'info',
              operation: { type: 'fill_na', params: { column: s.column, method: s.suggested, value: '' } },
            });
          });

          // 2. Text columns that look like they should be lowercase (e.g. email, name)
          const EMAIL_COLS = /email|e_mail|mail/i;
          const NAME_COLS  = /name|first_name|last_name|fname|lname|title/i;
          colNames.forEach(col => {
            const isText = !summary.find(s=>s.column===col)?.isNumeric;
            if (!isText) return;
            const vals = rows.map((r:any) => r[col]).filter((v:any) => v && typeof v === 'string');
            if (vals.length === 0) return;
            const hasUpper = vals.some((v:string) => v !== v.toLowerCase());
            if (EMAIL_COLS.test(col) && hasUpper) {
              suggestions.push({
                id: `lower_${col}`,
                label: `Lowercase "${col}"`,
                detail: `Email addresses should be lowercase for consistent matching`,
                severity: 'warn',
                operation: { type: 'clean_text', params: { column: col, operation: 'lower' } },
              });
            } else if (NAME_COLS.test(col) && hasUpper) {
              const hasLower = vals.some((v:string) => v !== v.toUpperCase());
              if (hasLower) {
                suggestions.push({
                  id: `title_${col}`,
                  label: `Title-case "${col}"`,
                  detail: `Name column has mixed casing — standardize to Title Case`,
                  severity: 'info',
                  operation: { type: 'clean_text', params: { column: col, operation: 'title' } },
                });
              }
            }
          });

          // 3. Columns that look like dates but are stored as text
          const DATE_COLS = /date|time|created|updated|at$|_on$/i;
          colNames.forEach(col => {
            const meta = summary.find(s=>s.column===col);
            if (!meta || meta.isNumeric) return;
            if (!DATE_COLS.test(col)) return;
            if (/datetime|timestamp/i.test(meta.colType)) return;
            const sample = rows.slice(0, 20).map((r:any) => r[col]).filter(Boolean);
            const looksLikeDate = sample.some((v:any) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(String(v)));
            if (looksLikeDate) {
              suggestions.push({
                id: `datetime_${col}`,
                label: `Parse "${col}" as datetime`,
                detail: `Column contains date strings — convert for time-based operations`,
                severity: 'info',
                operation: { type: 'change_type', params: { column: col, new_type: 'datetime' } },
              });
            }
          });

          // 4. Numeric columns with high outlier potential (std > 3× mean)
          colNames.forEach(col => {
            const meta = summary.find(s=>s.column===col);
            if (!meta?.isNumeric) return;
            const vals: number[] = rows.map((r:any) => r[col]).filter((v:any) => v !== null && v !== undefined && !isNaN(Number(v))).map(Number);
            if (vals.length < 10) return;
            const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
            const std  = Math.sqrt(vals.map(v=>(v-mean)**2).reduce((a,b)=>a+b,0)/vals.length);
            if (mean !== 0 && std / Math.abs(mean) > 3) {
              suggestions.push({
                id: `outliers_${col}`,
                label: `Remove outliers in "${col}"`,
                detail: `High spread detected (std/mean = ${(std/Math.abs(mean)).toFixed(1)})`,
                severity: 'warn',
                operation: { type: 'remove_outliers', params: { column: col, threshold: 3 } },
              });
            }
          });

          // 5. High-cardinality text columns that may benefit from encoding
          colNames.forEach(col => {
            const meta = summary.find(s=>s.column===col);
            if (!meta || meta.isNumeric) return;
            const vals = rows.map((r:any) => r[col]).filter((v:any) => v !== null && v !== undefined);
            const unique = new Set(vals).size;
            if (unique >= 2 && unique <= 20 && unique < vals.length * 0.5) {
              suggestions.push({
                id: `encode_${col}`,
                label: `Encode "${col}"`,
                detail: `${unique} unique values — good candidate for one-hot or label encoding`,
                severity: 'info',
                operation: { type: 'encode', params: { column: col, method: 'onehot' } },
              });
            }
          });

          // Keep at most 6 suggestions; warn-severity first
          const sorted = [...suggestions].sort((a,b) => (a.severity==='warn'?0:1)-(b.severity==='warn'?0:1));
          setAutoSuggestions(sorted.slice(0, 6));
        }
      } catch {}
    })();
  }, [selectedTable]);

  // ── Load saved pipelines on table change ────────────────────────────────────
  const fetchPipelines = useCallback(async () => {
    if (!selectedTable) return;
    try {
      const data = await api.get<SavedPipeline[]>(`/transform/pipelines?table=${encodeURIComponent(selectedTable)}`);
      setSavedPipelines(Array.isArray(data) ? data : []);
    } catch {}
  }, [selectedTable]);

  useEffect(() => { fetchPipelines(); }, [fetchPipelines]);

  // ── Operation types ─────────────────────────────────────────────────────────
  const operationTypes = [
    { value: 'drop_duplicates',    label: 'Drop Duplicates',       category: 'Cleaning' },
    { value: 'clean_text',         label: 'Clean Text',            category: 'Cleaning' },
    { value: 'remove_outliers',    label: 'Remove Outliers',       category: 'Cleaning' },
    { value: 'filter',             label: 'Filter Rows',           category: 'Select' },
    { value: 'rename_col',         label: 'Rename Column',         category: 'Select' },
    { value: 'drop_col',           label: 'Drop Column',           category: 'Select' },
    { value: 'change_type',        label: 'Change Type',           category: 'Select' },
    { value: 'fill_na',            label: 'Fill Missing Values',   category: 'Select' },
    { value: 'normalize',          label: 'Normalize',             category: 'Smart Prep' },
    { value: 'encode',             label: 'Encode',                category: 'Smart Prep' },
    { value: 'feature_engineering',label: 'Feature Engineering',   category: 'Smart Prep' },
    { value: 'text_feature',       label: 'Text Features',         category: 'Smart Prep' },
    { value: 'groupby',            label: 'Summarize (Group By)',  category: 'Summarize' },
    { value: 'resample',           label: 'Time Series Resample',  category: 'Summarize' },
  ];

  const getDefaultParams = (type: string): Record<string, any> => ({
    drop_duplicates:     { subset: '' },
    clean_text:          { column: '', operation: 'lower' },
    remove_outliers:     { column: '', threshold: 3 },
    filter:              { column: '', operator: '>', value: '' },
    rename_col:          { column: '', new_name: '' },
    drop_col:            { column: '' },
    change_type:         { column: '', new_type: 'str' },
    fill_na:             { column: '', method: 'mean', value: '' },
    normalize:           { columns: [], method: 'minmax' },
    encode:              { column: '', method: 'onehot' },
    feature_engineering: { feat_type: 'interaction', column1: '', column2: '', operation: '*', column: '', component: 'year' },
    text_feature:        { column: '', feature: 'len' },
    groupby:             { group_cols: '', aggregations: '{}' },
    resample:            { time_column: '', frequency: 'D', agg_json: '{}' },
  }[type] ?? {});

  const addOperation = (type: string) =>
    setOperations(prev => [...prev, { id: Math.random().toString(36).substr(2,9), type, params: getDefaultParams(type) }]);

  const removeOperation = (id: string) =>
    setOperations(prev => prev.filter(op => op.id !== id));

  const updateParam = (id: string, param: string, value: any) =>
    setOperations(prev => prev.map(op => op.id === id ? { ...op, params: { ...op.params, [param]: value } } : op));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setOperations(prev => {
        const from = prev.findIndex(op => op.id === active.id);
        const to   = prev.findIndex(op => op.id === over.id);
        return arrayMove(prev, from, to);
      });
    }
  };

  // ── Preview ─────────────────────────────────────────────────────────────────
  const handlePreview = async () => {
    if (!selectedTable) return;
    setIsProcessing(true); setError(null);
    try {
      if (operations.length === 0) {
        const data = await api.get<any>(`/tables/${selectedTable}/preview?limit=10`);
        const rows = data?.rows ?? data ?? [];
        setPreviewBefore(rows); setPreviewAfter(rows); setPreviewTab('before');
      } else {
        const result = await api.post<any>('/transform/preview', {
          table_name: selectedTable,
          operations: operations.map(mapOpForBackend),
        });
        setPreviewBefore(result.before ?? []); setPreviewAfter(result.after ?? []);
        setPreviewTab('after');
        if (result.run_stats) setRunStats(result.run_stats);
      }
      setShowPreview(true);
    } catch (err: any) {
      setError(`Preview failed: ${err.message ?? 'Unknown error'}`);
    } finally { setIsProcessing(false); }
  };

  // ── Apply ───────────────────────────────────────────────────────────────────
  const handleApply = async () => {
    if (!selectedTable || operations.length === 0) return;
    setIsProcessing(true); setError(null); setSuccess(false);
    try {
      const response = await api.post<any>('/transform', {
        table_name: selectedTable,
        operations: operations.map(mapOpForBackend),
      });
      setSuccess(true);
      if (response?.target_table && !tables.includes(response.target_table))
        setTables(prev => [...prev, response.target_table]);
      if (response?.preview) {
        setPreviewAfter(response.preview); setPreviewBefore([]); setPreviewTab('after'); setShowPreview(true);
      }
      if (response?.run_stats) setRunStats(response.run_stats);
    } catch (err: any) {
      setError(`Transformation failed: ${err.message ?? 'Unknown error'}`);
    } finally { setIsProcessing(false); }
  };

  // ── AI wizard (supports multi-turn) ────────────────────────────────────────
  const handleGenerateAI = async (promptOverride?: string) => {
    const prompt = promptOverride ?? aiPrompt;
    if (!prompt.trim() || !selectedTable) return;
    setIsGenerating(true); setError(null);

    // Build conversation history from prior turns (user + assistant pairs)
    const history = aiConversation.flatMap(turn => {
      const msgs: { role: string; content: string }[] = [{ role: 'user', content: turn.content }];
      if (turn.operations) msgs.push({ role: 'assistant', content: JSON.stringify(turn.operations.map(mapOpForBackend)) });
      return msgs;
    });

    try {
      const response = await api.post<{
        status: string; operations: any[];
        user_message?: string; assistant_message?: string;
      }>('/transform/suggest', {
        table_name: selectedTable,
        prompt,
        conversation: history,
      });

      if (response?.operations) {
        const newOps: Operation[] = response.operations.map((op: any) => {
          let type = op.type;
          if (type==='clean') type = op.method==='remove_outliers' ? 'remove_outliers' : op.method==='clean_text' ? 'clean_text' : 'drop_duplicates';
          if (type==='aggregate') type = op.method==='resample' ? 'resample' : 'groupby';
          return { id: Math.random().toString(36).substr(2,9), type, params: { ...op } };
        });

        // Append this turn to conversation history
        setAiConversation(prev => [...prev, { role: 'user', content: prompt, operations: newOps }]);

        // For follow-ups: replace ops from previous AI turns; for first turn: append
        if (aiConversation.length === 0) {
          setOperations(prev => [...prev, ...newOps]);
        } else {
          // Replace only the AI-generated ops (keep any manually added ones)
          setOperations(prev => {
            const manualOps = prev.filter(op => !aiConversation.some(t => t.operations?.some(o => o.id === op.id)));
            return [...manualOps, ...newOps];
          });
        }

        setAiPrompt('');
        setShowAiChat(true);
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    } catch (err: any) {
      setError(`AI generation failed: ${err.message ?? 'Unknown error'}`);
    } finally { setIsGenerating(false); }
  };

  const handleResetAiConversation = () => {
    setAiConversation([]);
    setShowAiChat(false);
  };

  // ── Save pipeline ───────────────────────────────────────────────────────────
  const handleSavePipeline = async () => {
    if (!saveName.trim() || operations.length === 0) return;
    setIsSaving(true);
    try {
      await api.post('/transform/pipelines', {
        name: saveName.trim(), table_name: selectedTable, operations,
      });
      await fetchPipelines();
      setSaveName(''); setShowSaveInput(false);
    } catch (err: any) {
      setError(`Save failed: ${err.message ?? 'Unknown error'}`);
    } finally { setIsSaving(false); }
  };

  const handleLoadPipeline = (p: SavedPipeline) => {
    setOperations(p.operations.map(op => ({ ...op, id: Math.random().toString(36).substr(2,9) })));
    setShowLoadMenu(false);
    setSuccess(false); setError(null);
  };

  const handleDeletePipeline = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.delete(`/transform/pipelines/${id}`);
      setSavedPipelines(prev => prev.filter(p => p.id !== id));
    } catch {}
  };

  // ── Schedule handlers (feature 7) ──────────────────────────────────────────
  const fetchSchedule = useCallback(async (pipelineId: number) => {
    try {
      const data = await api.get<PipelineScheduleInfo>(`/transform/pipelines/${pipelineId}/schedule`);
      setSchedules(prev => ({ ...prev, [pipelineId]: data }));
    } catch {}
  }, []);

  const openSchedulePicker = async (pipelineId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetchSchedule(pipelineId);
    const existing = schedules[pipelineId];
    if (existing?.scheduled && existing.frequency) setScheduleFreq(existing.frequency);
    setSchedulingId(prev => prev === pipelineId ? null : pipelineId);
  };

  const handleSetSchedule = async (pipelineId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const data = await api.post<PipelineScheduleInfo>(`/transform/pipelines/${pipelineId}/schedule`, { frequency: scheduleFreq });
      setSchedules(prev => ({ ...prev, [pipelineId]: { ...data, scheduled: true } }));
      setSchedulingId(null);
    } catch (err: any) {
      setError(`Schedule failed: ${err.message ?? 'Unknown error'}`);
    }
  };

  const handleRemoveSchedule = async (pipelineId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.delete(`/transform/pipelines/${pipelineId}/schedule`);
      setSchedules(prev => ({ ...prev, [pipelineId]: { scheduled: false } }));
      setSchedulingId(null);
    } catch (err: any) {
      setError(`Remove schedule failed: ${err.message ?? 'Unknown error'}`);
    }
  };

  // ── Batch handlers (feature 8) ──────────────────────────────────────────────
  const openBatchModal = (pipelineId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setBatchPipelineId(pipelineId);
    setBatchSelected(new Set());
    setBatchResults(null);
    setShowBatchModal(true);
    setShowLoadMenu(false);
  };

  const toggleBatchTable = (t: string) => {
    setBatchSelected(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  const handleBatchRun = async () => {
    if (!batchPipelineId || batchSelected.size === 0) return;
    setIsBatching(true); setBatchResults(null);
    try {
      const result = await api.post<{ results: BatchResult[] }>('/transform/batch', {
        pipeline_id: batchPipelineId,
        tables: [...batchSelected],
      });
      setBatchResults(result.results ?? []);
    } catch (err: any) {
      setError(`Batch run failed: ${err.message ?? 'Unknown error'}`);
    } finally { setIsBatching(false); }
  };

  // ── Data profiling ──────────────────────────────────────────────────────────
  const handleProfile = async () => {
    if (showProfile && profileData) { setShowProfile(false); return; }
    setProfileLoading(true); setError(null);
    try {
      const result = await api.get<any>(`/tables/${selectedTable}/profile`);
      setProfileData(result.profile ?? {});
      setShowProfile(true);
    } catch (err: any) {
      setError(`Profile failed: ${err.message ?? 'Unknown error'}`);
    } finally { setProfileLoading(false); }
  };

  // ── Feature 10: AI explain pipeline ────────────────────────────────────────
  const handleExplain = async () => {
    if (operations.length === 0) return;
    setIsExplaining(true); setShowExplanation(true);
    try {
      const result = await api.post<{ paragraph: string; summary: string }>('/transform/explain', {
        table_name: selectedTable,
        operations: operations.map(mapOpForBackend),
      });
      setExplanationText(result.paragraph ?? null);
      setExplanationSummary(result.summary ?? null);
    } catch (err: any) {
      setExplanationText(`Could not generate explanation: ${err.message ?? 'Unknown error'}`);
      setExplanationSummary(null);
    } finally { setIsExplaining(false); }
  };

  // ── Per-operation forms ─────────────────────────────────────────────────────
  const renderForm = (op: Operation) => {
    // Searchable column picker — replaces plain <select> for all column choices
    const sel = (paramName: string, placeholder = 'Select column') => (
      <ColumnCombobox
        value={op.params[paramName] || ''}
        onChange={v => updateParam(op.id, paramName, v)}
        columns={columns}
        placeholder={placeholder}
      />
    );

    switch (op.type) {
      case 'clean_text': return (
        <div className="grid grid-cols-2 gap-3">
          {sel('column')}
          <select value={op.params.operation||'lower'} onChange={e=>updateParam(op.id,'operation',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
            <option value="lower">Lowercase</option><option value="upper">Uppercase</option>
            <option value="trim">Trim whitespace</option><option value="title">Title Case</option>
            <option value="remove_special">Remove special chars</option>
          </select>
        </div>
      );
      case 'filter': return (
        <div className="grid grid-cols-3 gap-3">
          {sel('column')}
          <select value={op.params.operator||'>'} onChange={e=>updateParam(op.id,'operator',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
            <option value=">">{'>'} greater than</option><option value="<">{'<'} less than</option>
            <option value="==">== equals</option><option value="!=">!= not equal</option>
            <option value=">=">{'>='} ≥</option><option value="<=">{'<='} ≤</option>
          </select>
          <input type="text" placeholder="Value" value={op.params.value||''} onChange={e=>updateParam(op.id,'value',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm"/>
        </div>
      );
      case 'rename_col': return (
        <div className="grid grid-cols-2 gap-3">
          {sel('column','Old column')}
          <input type="text" placeholder="New name" value={op.params.new_name||''} onChange={e=>updateParam(op.id,'new_name',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm"/>
        </div>
      );
      case 'drop_col': return <div>{sel('column')}</div>;
      case 'change_type': return (
        <div className="grid grid-cols-2 gap-3">
          {sel('column')}
          <select value={op.params.new_type||'str'} onChange={e=>updateParam(op.id,'new_type',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
            <option value="int">Integer</option><option value="float">Float</option>
            <option value="str">String</option><option value="datetime">Date/Time</option><option value="bool">Boolean</option>
          </select>
        </div>
      );
      case 'fill_na': return (
        <div className="space-y-3">
          {missingSummary.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-800 mb-2">📊 Missing Values</p>
              <div className="overflow-auto max-h-28">
                <table className="w-full text-xs"><thead><tr className="text-amber-700 border-b border-amber-200">
                  <th className="text-left py-1 pr-3">Column</th><th className="text-right py-1 pr-3">Missing</th>
                  <th className="text-right py-1 pr-3">%</th><th className="text-left py-1 pr-3">Suggested</th><th className="py-1">Use</th>
                </tr></thead><tbody>{missingSummary.map(s=>(
                  <tr key={s.column} className="border-b border-amber-100">
                    <td className="py-1 pr-3 font-mono">{s.column}</td>
                    <td className="py-1 pr-3 text-right">{s.missing}</td>
                    <td className={`py-1 pr-3 text-right font-semibold ${s.pct>20?'text-red-600':'text-amber-700'}`}>{s.pct}%</td>
                    <td className="py-1 pr-3"><span className="px-1 bg-blue-100 text-blue-700 rounded">{s.suggested}</span></td>
                    <td className="py-1"><button onClick={()=>{updateParam(op.id,'column',s.column);updateParam(op.id,'method',s.suggested);}} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs hover:bg-purple-200">Use</button></td>
                  </tr>
                ))}</tbody></table>
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {sel('column')}
            <select value={op.params.method||'mean'} onChange={e=>updateParam(op.id,'method',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="mean">Mean</option><option value="median">Median</option>
              <option value="mode">Mode</option><option value="value">Fixed value</option>
            </select>
            <input type="text" placeholder="Value (if fixed)" value={op.params.value||''} onChange={e=>updateParam(op.id,'value',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm"/>
          </div>
        </div>
      );
      case 'drop_duplicates': return <div>{sel('subset','Check column (optional)')}</div>;
      case 'remove_outliers': return (
        <div className="grid grid-cols-2 gap-3">
          {sel('column')}
          <input type="number" step="0.1" placeholder="Z-score threshold (default 3)" value={op.params.threshold??3} onChange={e=>updateParam(op.id,'threshold',parseFloat(e.target.value))} className="px-3 py-2 border border-gray-300 rounded text-sm"/>
        </div>
      );
      case 'normalize': return (
        <div className="grid grid-cols-2 gap-3">
          <input type="text" placeholder="Columns (comma-separated)" value={Array.isArray(op.params.columns)?op.params.columns.join(', '):op.params.columns||''} onChange={e=>updateParam(op.id,'columns',e.target.value.split(',').map((c:string)=>c.trim()).filter(Boolean))} className="px-3 py-2 border border-gray-300 rounded text-sm"/>
          <select value={op.params.method||'minmax'} onChange={e=>updateParam(op.id,'method',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
            <option value="minmax">Min-Max (0–1)</option><option value="zscore">Z-Score</option><option value="log">Log transform</option>
          </select>
        </div>
      );
      case 'encode': return (
        <div className="grid grid-cols-2 gap-3">
          {sel('column')}
          <select value={op.params.method||'onehot'} onChange={e=>updateParam(op.id,'method',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
            <option value="onehot">One-Hot</option><option value="label">Label (integers)</option><option value="binary">Binary (Yes/No→1/0)</option>
          </select>
        </div>
      );
      case 'text_feature': return (
        <div className="grid grid-cols-2 gap-3">
          {sel('column')}
          <select value={op.params.feature||'len'} onChange={e=>updateParam(op.id,'feature',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
            <option value="len">Character length</option><option value="word_count">Word count</option><option value="tfidf">TF-IDF features</option>
          </select>
        </div>
      );
      case 'feature_engineering': {
        const ft = op.params.feat_type||'interaction';
        return (
          <div className="space-y-3">
            <select value={ft} onChange={e=>updateParam(op.id,'feat_type',e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="interaction">Column interaction</option><option value="time_component">Extract time component</option>
            </select>
            {ft==='interaction' && <div className="grid grid-cols-3 gap-3">
              {sel('column1','Column A')}
              <select value={op.params.operation||'*'} onChange={e=>updateParam(op.id,'operation',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
                <option value="*">× Multiply</option><option value="/">÷ Divide</option><option value="+">+ Add</option><option value="-">− Subtract</option>
              </select>
              {sel('column2','Column B')}
            </div>}
            {ft==='time_component' && <div className="grid grid-cols-2 gap-3">
              {sel('column','Date column')}
              <select value={op.params.component||'year'} onChange={e=>updateParam(op.id,'component',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
                <option value="year">Year</option><option value="month">Month</option><option value="day">Day</option><option value="dow">Day of week</option><option value="quarter">Quarter</option>
              </select>
            </div>}
          </div>
        );
      }
      case 'groupby': return (
        <div className="space-y-3">
          <input type="text" placeholder="Group by columns (comma-separated, e.g. region, category)" value={op.params.group_cols||''} onChange={e=>updateParam(op.id,'group_cols',e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded text-sm"/>
          <input type="text" placeholder={'{"revenue": ["sum","mean"]}'} value={op.params.aggregations||'{}'} onChange={e=>updateParam(op.id,'aggregations',e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"/>
        </div>
      );
      case 'resample': return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {sel('time_column','Date/Time column')}
            <select value={op.params.frequency||'D'} onChange={e=>updateParam(op.id,'frequency',e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="D">Daily</option><option value="W">Weekly</option><option value="ME">Monthly</option><option value="QE">Quarterly</option><option value="YE">Yearly</option>
            </select>
          </div>
          <input type="text" placeholder={'{"revenue": "sum"}'} value={op.params.agg_json||'{}'} onChange={e=>updateParam(op.id,'agg_json',e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"/>
        </div>
      );
      default: return (
        <textarea placeholder="Configuration (JSON)" value={JSON.stringify(op.params,null,2)}
          onChange={e=>{try{const p=JSON.parse(e.target.value);setOperations(prev=>prev.map(o=>o.id===op.id?{...o,params:p}:o));}catch{}}}
          rows={3} className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"/>
      );
    }
  };

  const categories = [...new Set(operationTypes.map(op => op.category))];
  const previewData = previewTab==='before' ? previewBefore : previewAfter;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Wrench className="size-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Data Prep</h1>
        </div>
        <p className="text-gray-600">Prepare and refine your data with AI-powered suggestions, live preview, and saveable pipelines.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="size-5 text-red-600 mt-0.5 shrink-0"/>
              <p className="text-sm text-red-800 flex-1">{error}</p>
              <button onClick={()=>setError(null)} className="text-red-400 hover:text-red-600"><X className="size-4"/></button>
            </div>
          )}
          {/* Success */}
          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle className="size-5 text-green-600"/>
              <div className="flex-1">
                <p className="font-medium text-green-900">Transformations applied!</p>
                <p className="text-sm text-green-700">Saved to <code className="font-mono">transformed_{selectedTable}</code></p>
              </div>
              <button onClick={()=>{setSuccess(false);setOperations([]);}} className="text-xs px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200">Clear pipeline</button>
            </div>
          )}

          {/* Table selector + profile button */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">Source Table</label>
                <select value={selectedTable} onChange={e=>setSelectedTable(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                  {tables.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <button onClick={handleProfile} disabled={!selectedTable||profileLoading}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg border font-medium text-sm transition-colors ${showProfile ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'} disabled:opacity-50`}>
                <BarChart2 className="size-4"/>
                {profileLoading ? 'Loading…' : showProfile ? 'Hide Profile' : 'Profile Table'}
                {showProfile ? <ChevronUp className="size-4"/> : <ChevronDown className="size-4"/>}
              </button>
            </div>
          </div>

          {/* ── Data profiling panel ── */}
          {showProfile && profileData && (
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-5 border-b border-gray-200 flex items-center gap-2">
                <BarChart2 className="size-5 text-blue-600"/>
                <h2 className="text-lg font-bold text-gray-900">Column Profile</h2>
                <span className="text-sm text-gray-500 ml-1">— {Object.keys(profileData).length} columns</span>
              </div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {Object.entries(profileData).map(([col, stats]) => (
                  <ColumnCard key={col} name={col} stats={stats}/>
                ))}
              </div>
            </div>
          )}

          {/* ── Auto-suggestions (feature 5) ── */}
          {autoSuggestions.filter(s => !dismissedSuggestions.has(s.id)).length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="size-5 text-amber-600"/>
                <h3 className="font-bold text-amber-900">Smart Suggestions</h3>
                <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  {autoSuggestions.filter(s => !dismissedSuggestions.has(s.id)).length} issues found
                </span>
              </div>
              <div className="space-y-2">
                {autoSuggestions.filter(s => !dismissedSuggestions.has(s.id)).map(s => (
                  <div key={s.id} className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border ${s.severity==='warn' ? 'bg-red-50 border-red-200' : 'bg-white border-amber-200'}`}>
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <span className={`mt-0.5 size-2 rounded-full shrink-0 ${s.severity==='warn' ? 'bg-red-500' : 'bg-amber-400'}`}/>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{s.label}</p>
                        <p className="text-xs text-gray-500">{s.detail}</p>
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => { setOperations(prev => [...prev, { id: Math.random().toString(36).substr(2,9), ...s.operation }]); setDismissedSuggestions(prev => new Set([...prev, s.id])); }}
                        className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                        Add
                      </button>
                      <button onClick={() => setDismissedSuggestions(prev => new Set([...prev, s.id]))}
                        className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                        <X className="size-3"/>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Wizard (feature 6: multi-step conversation) */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-600 rounded-lg shrink-0"><Wrench className="size-6 text-white"/></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-lg font-bold text-blue-900">AI Data Prep Wizard</h3>
                    {aiConversation.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowAiChat(v=>!v)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200">
                          <MessageSquare className="size-3.5"/>
                          {aiConversation.length} turn{aiConversation.length!==1?'s':''}
                          {showAiChat ? <ChevronUp className="size-3"/> : <ChevronDown className="size-3"/>}
                        </button>
                        <button onClick={handleResetAiConversation} title="Reset conversation"
                          className="p-1.5 rounded-lg text-blue-400 hover:text-blue-700 hover:bg-blue-100">
                          <RotateCcw className="size-3.5"/>
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-blue-800 text-sm mb-4">
                    {aiConversation.length === 0
                      ? 'Describe what you want — the AI will configure the operations.'
                      : 'Follow up to refine: "make the filter < 100 instead", "also encode the category column"…'}
                  </p>
                  <div className="flex gap-3">
                    <input type="text" value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)}
                      placeholder={aiConversation.length === 0
                        ? 'e.g. Remove empty rows, lowercase the email column, drop zip_code'
                        : 'Follow up: "change the threshold to 2", "add encoding for category"…'}
                      className="flex-1 px-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                      onKeyDown={e=>{if(e.key==='Enter')handleGenerateAI();}}/>
                    <button onClick={()=>handleGenerateAI()} disabled={isGenerating||!aiPrompt.trim()}
                      className="shrink-0 flex items-center gap-2 px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                      <Send className="size-4"/>
                      {isGenerating ? 'Working…' : aiConversation.length === 0 ? 'Generate' : 'Follow up'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Conversation history */}
            {showAiChat && aiConversation.length > 0 && (
              <div className="border-t border-blue-100 px-6 pb-5 pt-4 space-y-3 max-h-72 overflow-y-auto">
                {aiConversation.map((turn, i) => (
                  <div key={i} className="flex gap-3">
                    <div className={`size-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${turn.role==='user' ? 'bg-gray-200 text-gray-700' : 'bg-blue-600 text-white'}`}>
                      {turn.role==='user' ? 'U' : 'AI'}
                    </div>
                    <div className="flex-1 bg-white rounded-lg px-3 py-2 border border-blue-100">
                      <p className="text-xs font-semibold text-gray-500 mb-1">{turn.role==='user' ? 'You' : 'AI'}</p>
                      <p className="text-sm text-gray-800">{turn.content}</p>
                      {turn.operations && turn.operations.length > 0 && (
                        <p className="text-xs text-blue-600 mt-1">→ Generated {turn.operations.length} operation{turn.operations.length!==1?'s':''}</p>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef}/>
              </div>
            )}
          </div>

          {/* ── Pipeline ── */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-gray-900">Pipeline</h2>
                    {totalConflicts > 0 && (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold border border-amber-200">
                        <AlertTriangle className="size-3.5" /> {totalConflicts} conflict{totalConflicts > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{operations.length} operation{operations.length!==1?'s':''} — drag to reorder</p>
                </div>
                <div className="flex items-center gap-2">
                  {/* Explain button */}
                  {operations.length > 0 && (
                    <button onClick={handleExplain} disabled={isExplaining}
                      className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-purple-300 rounded-lg hover:bg-purple-50 text-purple-700 disabled:opacity-50">
                      <BookOpen className="size-4"/> {isExplaining ? 'Explaining…' : 'Explain'}
                    </button>
                  )}
                  {/* Load button */}
                  <div className="relative">
                    <button onClick={()=>setShowLoadMenu(v=>!v)}
                      className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
                      <FolderOpen className="size-4"/> Load
                      {savedPipelines.length > 0 && <span className="ml-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">{savedPipelines.length}</span>}
                    </button>
                    {showLoadMenu && (
                      <div className="absolute right-0 top-9 z-30 w-72 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                        <div className="p-3 border-b border-gray-100">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Saved Pipelines for "{selectedTable}"</p>
                        </div>
                        {savedPipelines.length === 0 ? (
                          <p className="p-4 text-sm text-gray-500 text-center">No saved pipelines for this table.</p>
                        ) : (
                          <div className="max-h-80 overflow-y-auto">
                            {savedPipelines.map(p => {
                              const sched = schedules[p.id];
                              const isScheduled = sched?.scheduled;
                              const isOpenSched = schedulingId === p.id;
                              return (
                                <div key={p.id} className="border-b border-gray-50">
                                  {/* Main row */}
                                  <div onClick={()=>handleLoadPipeline(p)}
                                    className="flex items-center justify-between px-4 py-3 hover:bg-blue-50 cursor-pointer">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                                        {isScheduled && (
                                          <span className="shrink-0 text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                                            {sched.frequency}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-gray-400">{p.operations.length} ops · {new Date(p.updated_at).toLocaleDateString()}</p>
                                    </div>
                                    {/* Action icons */}
                                    <div className="flex items-center gap-0.5 ml-2 shrink-0" onClick={e=>e.stopPropagation()}>
                                      <button title="Run on multiple tables" onClick={e=>openBatchModal(p.id, e)}
                                        className="p-1.5 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded">
                                        <Layers className="size-3.5"/>
                                      </button>
                                      <button title={isScheduled ? 'Edit schedule' : 'Schedule this pipeline'}
                                        onClick={e=>openSchedulePicker(p.id, e)}
                                        className={`p-1.5 rounded ${isScheduled ? 'text-green-600 hover:bg-green-50' : 'text-gray-300 hover:text-amber-600 hover:bg-amber-50'}`}>
                                        <Clock className="size-3.5"/>
                                      </button>
                                      <button onClick={e=>handleDeletePipeline(p.id,e)}
                                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded">
                                        <Trash2 className="size-3.5"/>
                                      </button>
                                    </div>
                                  </div>

                                  {/* Inline schedule picker */}
                                  {isOpenSched && (
                                    <div className="mx-3 mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg" onClick={e=>e.stopPropagation()}>
                                      <p className="text-xs font-semibold text-amber-800 mb-2">
                                        {isScheduled ? '✏️ Edit schedule' : '⏰ Schedule pipeline'}
                                      </p>
                                      <div className="flex gap-2">
                                        <select value={scheduleFreq} onChange={e=>setScheduleFreq(e.target.value)}
                                          className="flex-1 px-2 py-1.5 border border-amber-300 rounded text-xs bg-white">
                                          <option value="hourly">Every hour</option>
                                          <option value="daily">Every day</option>
                                          <option value="weekly">Every week</option>
                                          <option value="monthly">Every month</option>
                                        </select>
                                        <button onClick={e=>handleSetSchedule(p.id, e)}
                                          className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs hover:bg-amber-700 font-medium">
                                          Save
                                        </button>
                                        {isScheduled && (
                                          <button onClick={e=>handleRemoveSchedule(p.id, e)}
                                            className="px-3 py-1.5 bg-red-100 text-red-600 rounded text-xs hover:bg-red-200 font-medium">
                                            Remove
                                          </button>
                                        )}
                                      </div>
                                      {sched?.last_run_at && (
                                        <p className="mt-2 text-xs text-amber-700">
                                          Last run: {new Date(sched.last_run_at).toLocaleString()} —{' '}
                                          <span className={sched.last_run_status === 'success' ? 'text-green-700' : 'text-red-600'}>
                                            {sched.last_run_status}
                                          </span>
                                        </p>
                                      )}
                                      {sched?.next_run_at && (
                                        <p className="text-xs text-amber-600">
                                          Next run: {new Date(sched.next_run_at).toLocaleString()}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div className="p-2 border-t border-gray-100">
                          <button onClick={()=>setShowLoadMenu(false)} className="w-full text-xs text-gray-400 py-1 hover:text-gray-600">Close</button>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Save button */}
                  {operations.length > 0 && (
                    <button onClick={()=>setShowSaveInput(v=>!v)}
                      className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-blue-300 rounded-lg hover:bg-blue-50 text-blue-700">
                      <Save className="size-4"/> Save
                    </button>
                  )}
                  {operations.length > 0 && (
                    <button onClick={()=>setOperations([])} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 text-red-500">
                      <Trash2 className="size-4"/> Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Save name input */}
              {showSaveInput && (
                <div className="mt-4 flex gap-2">
                  <input type="text" placeholder="Pipeline name…" value={saveName} onChange={e=>setSaveName(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter')handleSavePipeline();if(e.key==='Escape')setShowSaveInput(false);}}
                    className="flex-1 px-3 py-2 border border-blue-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" autoFocus/>
                  <button onClick={handleSavePipeline} disabled={!saveName.trim()||isSaving}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {isSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={()=>setShowSaveInput(false)} className="px-3 py-2 text-gray-400 hover:text-gray-600 rounded-lg"><X className="size-4"/></button>
                </div>
              )}
            </div>

            {/* AI explanation panel */}
            {showExplanation && (
              <div className="mx-6 mt-4 p-4 bg-purple-50 border border-purple-200 rounded-xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <BookOpen className="size-4 text-purple-600 mt-0.5 shrink-0"/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">AI Pipeline Explanation</p>
                        {explanationSummary && (
                          <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-600 rounded-full border border-purple-200 italic truncate max-w-xs">
                            {explanationSummary}
                          </span>
                        )}
                      </div>
                      {isExplaining ? (
                        <p className="text-sm text-purple-500 animate-pulse">Analysing pipeline…</p>
                      ) : (
                        <p className="text-sm text-purple-900 leading-relaxed">{explanationText}</p>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setShowExplanation(false)} className="text-purple-300 hover:text-purple-600 p-1 rounded shrink-0">
                    <X className="size-4"/>
                  </button>
                </div>
              </div>
            )}

            {/* Operations list with DnD */}
            <div className="p-6 space-y-4">
              {/* Conflict summary (if any) */}
              {totalConflicts > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="size-4 text-amber-600 mt-0.5 shrink-0"/>
                  <div className="text-xs text-amber-800">
                    <span className="font-semibold">{totalConflicts} pipeline conflict{totalConflicts > 1 ? 's' : ''} detected.</span>{' '}
                    Operations with ⚠ badges below may produce incorrect results. Review the highlighted steps.
                  </div>
                </div>
              )}

              {operations.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Wrench className="size-12 mx-auto mb-3 text-gray-300"/>
                  <p>No operations yet.</p>
                  <p className="text-sm">Add from the panel on the right, or use the AI wizard above.</p>
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={operations.map(op=>op.id)} strategy={verticalListSortingStrategy}>
                    {operations.map((op, index) => (
                      <SortableCard key={op.id} op={op} index={index} onRemove={()=>removeOperation(op.id)}
                        conflicts={pipelineConflicts.get(op.id)}>
                        {renderForm(op)}
                      </SortableCard>
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {operations.length > 0 && (
              conflictConfirmMode ? (
                /* ── Conflict confirmation ── */
                <div className="border-t border-amber-200 bg-amber-50 rounded-b-xl p-5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="size-5 text-amber-600 mt-0.5 shrink-0"/>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-amber-900">
                        {totalConflicts} conflict{totalConflicts > 1 ? 's' : ''} detected — results may be incorrect
                      </p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        Review the highlighted operations above, or proceed and check the preview output.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => {
                        const mode = conflictConfirmMode;
                        setConflictConfirmMode(null);
                        if (mode === 'preview') handlePreview();
                        else handleApply();
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 font-medium">
                      {conflictConfirmMode === 'preview'
                        ? <><Eye className="size-4"/> Preview anyway</>
                        : <><Play className="size-4"/> Run & Save anyway</>}
                    </button>
                    <button onClick={() => setConflictConfirmMode(null)}
                      className="px-4 py-2 border border-amber-300 text-amber-800 text-sm rounded-lg hover:bg-amber-100 font-medium">
                      Fix conflicts first
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Normal action bar ── */
                <div className="p-6 border-t border-gray-200 flex gap-3">
                  <button
                    onClick={() => totalConflicts > 0 ? setConflictConfirmMode('preview') : handlePreview()}
                    disabled={isProcessing}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 disabled:opacity-50 font-medium">
                    <Eye className="size-5"/>
                    {isProcessing ? 'Loading…' : 'Preview pipeline (50 rows)'}
                    {totalConflicts > 0 && !isProcessing && (
                      <span className="ml-1 px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded-full text-xs font-bold">
                        {totalConflicts}⚠
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => totalConflicts > 0 ? setConflictConfirmMode('apply') : handleApply()}
                    disabled={isProcessing}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                    <Play className="size-5"/>
                    {isProcessing ? 'Running…' : 'Run & Save'}
                  </button>
                </div>
              )
            )}
          </div>

          {/* ── Quality Score (feature 11) ── */}
          {qualityMetrics && qualityMetrics.before && qualityMetrics.after && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="size-5 text-indigo-500"/>
                <h3 className="font-bold text-gray-900">Quality Score</h3>
                <span className="text-xs text-gray-400">before → after transformation</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {/* Completeness */}
                {(() => {
                  const delta = qualityMetrics.after.completePct - qualityMetrics.before.completePct;
                  const up = delta >= 0;
                  return (
                    <div className="text-center p-4 rounded-xl border border-gray-100 bg-gray-50">
                      <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Completeness</p>
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-lg font-bold text-gray-400">{qualityMetrics.before.completePct}%</span>
                        <span className="text-gray-300">→</span>
                        <span className={`text-2xl font-black ${up ? 'text-green-600' : 'text-red-500'}`}>{qualityMetrics.after.completePct}%</span>
                      </div>
                      <p className={`text-xs mt-1 font-semibold ${up ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                        {delta > 0 ? `+${delta}pp` : delta < 0 ? `${delta}pp` : 'no change'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">non-null cells</p>
                    </div>
                  );
                })()}
                {/* Duplicates */}
                {(() => {
                  const delta = qualityMetrics.after.dupRate - qualityMetrics.before.dupRate;
                  const up = delta <= 0;
                  return (
                    <div className="text-center p-4 rounded-xl border border-gray-100 bg-gray-50">
                      <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Duplicate Rate</p>
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-lg font-bold text-gray-400">{qualityMetrics.before.dupRate}%</span>
                        <span className="text-gray-300">→</span>
                        <span className={`text-2xl font-black ${up ? 'text-green-600' : 'text-red-500'}`}>{qualityMetrics.after.dupRate}%</span>
                      </div>
                      <p className={`text-xs mt-1 font-semibold ${up && delta < 0 ? 'text-green-600' : delta > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                        {delta < 0 ? `${delta}pp` : delta > 0 ? `+${delta}pp` : 'no change'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">duplicate rows</p>
                    </div>
                  );
                })()}
                {/* Row count */}
                {(() => {
                  const delta = qualityMetrics.after.rowCount - qualityMetrics.before.rowCount;
                  const pct   = qualityMetrics.before.rowCount > 0
                    ? Math.round((delta / qualityMetrics.before.rowCount) * 100) : 0;
                  return (
                    <div className="text-center p-4 rounded-xl border border-gray-100 bg-gray-50">
                      <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Row Count</p>
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-lg font-bold text-gray-400">{qualityMetrics.before.rowCount}</span>
                        <span className="text-gray-300">→</span>
                        <span className="text-2xl font-black text-indigo-600">{qualityMetrics.after.rowCount}</span>
                      </div>
                      <p className={`text-xs mt-1 font-semibold ${delta < 0 ? 'text-amber-500' : delta > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                        {delta > 0 ? `+${delta} rows` : delta < 0 ? `${delta} rows (${pct}%)` : 'unchanged'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">sample of 50</p>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Before/After preview */}
          {showPreview && (previewBefore.length>0||previewAfter.length>0) && (
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 shrink-0">
                  <ArrowRightLeft className="size-5 text-blue-600"/>
                  <h2 className="text-lg font-bold text-gray-900">Pipeline Preview</h2>
                </div>
                <div className="flex items-center gap-2">
                  {/* Feature 4: Download CSV */}
                  {previewAfter.length > 0 && (
                    <button
                      onClick={() => downloadCSV(previewAfter, `${selectedTable}_preview.csv`)}
                      className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-green-300 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 font-medium">
                      <Download className="size-4"/> Download CSV
                    </button>
                  )}
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                    <button onClick={()=>setPreviewTab('before')} className={`px-4 py-1.5 font-medium ${previewTab==='before'?'bg-gray-800 text-white':'bg-white text-gray-600 hover:bg-gray-50'}`}>
                      Before ({previewBefore.length})
                    </button>
                    <button onClick={()=>setPreviewTab('after')} className={`px-4 py-1.5 font-medium ${previewTab==='after'?'bg-blue-600 text-white':'bg-white text-gray-600 hover:bg-gray-50'}`}>
                      After ({previewAfter.length})
                    </button>
                  </div>
                </div>
              </div>
              {/* ── Run Stats Bar ── */}
              {runStats && (
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                  {/* Engine badge */}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold
                    ${runStats.engine==='sql'     ? 'bg-blue-100 text-blue-700' :
                      runStats.engine==='hybrid'  ? 'bg-purple-100 text-purple-700' :
                                                    'bg-amber-100 text-amber-700'}`}>
                    {runStats.engine==='sql' ? '⚡ SQL' : runStats.engine==='hybrid' ? '⚡ Hybrid' : '🐼 Pandas'}
                  </span>
                  <span className="text-gray-500">
                    <span className="font-medium text-gray-700">{runStats.sql_ops}</span> SQL op{runStats.sql_ops!==1?'s':''}
                  </span>
                  {runStats.pandas_ops > 0 && (
                    <span className="text-gray-500">
                      <span className="font-medium text-gray-700">{runStats.pandas_ops}</span> Pandas op{runStats.pandas_ops!==1?'s':''}
                    </span>
                  )}
                  {runStats.cte_count > 0 && (
                    <span className="text-gray-500">
                      <span className="font-medium text-gray-700">{runStats.cte_count}</span> CTE step{runStats.cte_count!==1?'s':''}
                    </span>
                  )}
                  <span className="text-gray-500">
                    <span className="font-medium text-gray-700">{runStats.rows_before.toLocaleString()}</span> → <span className="font-medium text-gray-700">{runStats.rows_after.toLocaleString()}</span> rows
                  </span>
                  <span className="ml-auto text-gray-400 font-mono">{runStats.total_time_ms}ms</span>
                </div>
              )}

              <div className="overflow-x-auto">
                {previewData.length>0 ? (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>{Object.keys(previewData[0]).map(k=><th key={k} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{k}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {previewData.map((row,idx)=>(
                        <tr key={idx} className="hover:bg-gray-50">
                          {Object.values(row).map((val:any,i)=>(
                            <td key={i} className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap max-w-xs truncate">
                              {val===null||val===undefined?<span className="text-gray-400 italic">null</span>:String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="p-6 text-sm text-gray-500 text-center">No rows to show.</p>}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Operation Library ── */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Add Operations</h3>
            {categories.map(category=>(
              <div key={category} className="mb-5">
                <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-widest">{category}</h4>
                <div className="space-y-1.5">
                  {operationTypes.filter(op=>op.category===category).map(op=>(
                    <button key={op.value} onClick={()=>addOperation(op.value)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors text-left">
                      <Plus className="size-4 text-blue-600 shrink-0"/><span>{op.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-blue-600 mt-0.5 shrink-0"/>
              <div>
                <h4 className="font-medium text-blue-900 mb-2">Tips</h4>
                <ul className="space-y-1 text-sm text-blue-800">
                  <li>• Drag <GripVertical className="size-3 inline"/> to reorder operations</li>
                  <li>• Preview runs on a 50-row sample before you commit</li>
                  <li>• <AlertTriangle className="size-3 inline text-amber-500"/> badges warn of operation conflicts</li>
                  <li>• <BookOpen className="size-3 inline text-purple-500"/> Explain generates a plain-English summary</li>
                  <li>• Quality Score shows completeness / duplicates before → after</li>
                  <li>• <Clock className="size-3 inline"/> schedules a pipeline hourly / daily / weekly / monthly</li>
                  <li>• <Layers className="size-3 inline"/> runs the same pipeline on multiple tables at once</li>
                  <li>• Original table is never modified</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Batch Apply Modal (feature 8) ── */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg"><Layers className="size-5 text-blue-600"/></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Run on Multiple Tables</h2>
                  <p className="text-sm text-gray-500">Select tables to apply the same pipeline to each</p>
                </div>
              </div>
              <button onClick={()=>setShowBatchModal(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <X className="size-5"/>
              </button>
            </div>

            {/* Table checklist */}
            {!batchResults ? (
              <>
                <div className="p-4 border-b border-gray-100 shrink-0 flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500 font-medium">{batchSelected.size} of {tables.length} selected</p>
                  <div className="flex gap-2">
                    <button onClick={()=>setBatchSelected(new Set(tables))} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600">Select all</button>
                    <button onClick={()=>setBatchSelected(new Set())} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600">Clear</button>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 px-4 py-2">
                  {tables.map(t => {
                    const checked = batchSelected.has(t);
                    return (
                      <label key={t} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-gray-50 ${checked ? 'bg-blue-50' : ''}`}>
                        <div onClick={()=>toggleBatchTable(t)} className={`size-4 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer ${checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                          {checked && <svg className="size-2.5 text-white" fill="currentColor" viewBox="0 0 12 12"><path d="M10 3L5 8.5 2 5.5"/><path stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" d="M10 3L5 8.5 2 5.5"/></svg>}
                        </div>
                        <span className={`font-mono text-sm ${checked ? 'text-blue-900 font-semibold' : 'text-gray-700'}`}>{t}</span>
                        {t === selectedTable && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded ml-auto">current</span>}
                      </label>
                    );
                  })}
                </div>
                <div className="p-4 border-t border-gray-200 shrink-0 flex gap-3">
                  <button onClick={()=>setShowBatchModal(false)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button onClick={handleBatchRun} disabled={isBatching || batchSelected.size === 0}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {isBatching
                      ? <><RefreshCw className="size-4 animate-spin"/> Running…</>
                      : <><Play className="size-4"/> Run on {batchSelected.size} table{batchSelected.size !== 1 ? 's' : ''}</>}
                  </button>
                </div>
              </>
            ) : (
              /* Results view */
              <>
                <div className="p-5 border-b border-gray-100 shrink-0">
                  <div className="flex items-center gap-4">
                    {(() => {
                      const ok  = batchResults.filter(r=>r.status==='success').length;
                      const err = batchResults.filter(r=>r.status==='error').length;
                      const skp = batchResults.filter(r=>r.status==='skipped').length;
                      return <>
                        <div className="text-center"><p className="text-2xl font-bold text-green-600">{ok}</p><p className="text-xs text-gray-500">succeeded</p></div>
                        {err > 0 && <div className="text-center"><p className="text-2xl font-bold text-red-500">{err}</p><p className="text-xs text-gray-500">failed</p></div>}
                        {skp > 0 && <div className="text-center"><p className="text-2xl font-bold text-gray-400">{skp}</p><p className="text-xs text-gray-500">skipped</p></div>}
                      </>;
                    })()}
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 px-4 py-2">
                  {batchResults.map(r => (
                    <div key={r.table} className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
                      <div className={`mt-0.5 size-5 rounded-full flex items-center justify-center shrink-0 ${r.status==='success'?'bg-green-100':r.status==='skipped'?'bg-gray-100':'bg-red-100'}`}>
                        {r.status==='success'
                          ? <CheckCircle className="size-3.5 text-green-600"/>
                          : r.status==='skipped'
                          ? <span className="text-gray-400 text-xs">–</span>
                          : <AlertCircle className="size-3.5 text-red-500"/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-medium text-gray-900">{r.table}</p>
                        {r.status==='success' && <p className="text-xs text-gray-500">{r.rows?.toLocaleString()} rows → <span className="font-mono">{r.target}</span></p>}
                        {r.message && <p className="text-xs text-red-600">{r.message}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-4 border-t border-gray-200 shrink-0 flex gap-3">
                  <button onClick={()=>setBatchResults(null)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
                    Run again
                  </button>
                  <button onClick={()=>setShowBatchModal(false)} className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
