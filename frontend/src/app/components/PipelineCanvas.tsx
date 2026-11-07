/**
 * PipelineCanvas.tsx
 * Visual drag-and-drop pipeline builder built on @xyflow/react (React Flow v12).
 *
 * Node types
 * ----------
 *   source-node     — pick a source DB table
 *   transform-node  — one operation; two output handles: success (green) + error (red)
 *   sink-node       — write result to a named DB table
 *   error-sink-node — capture bad rows from error handles
 *
 * Branching: any node's success/error handle can connect to any transform/sink.
 * Merging:   multiple success edges can feed the same downstream node (rows concat'd).
 */

import {
  useCallback, useState, useRef, useEffect,
} from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Database, Table2, AlertTriangle, CheckCircle2, Play,
  Plus, Trash2, ChevronDown, ChevronUp, Loader2,
  ArrowDownToLine, Zap, GitBranch, Download,
} from 'lucide-react';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PipelineCanvasProps {
  apiKey: string;
}

type OpType =
  | 'filter' | 'drop_col' | 'rename_col' | 'change_type' | 'fill_na'
  | 'clean_text' | 'drop_duplicates' | 'normalize' | 'encode'
  | 'feature_engineering' | 'text_feature' | 'groupby'
  | 'sample' | 'join' | 'union' | 'pivot' | 'unpivot'
  | 'formula_col' | 'regex_extract';

interface SourceNodeData  { table: string; label?: string }
interface SinkNodeData    { table: string; label?: string }
interface TransformNodeData {
  opType: OpType;
  params: Record<string, any>;
  label?: string;
}

type NodeData = SourceNodeData | SinkNodeData | TransformNodeData;

// ── Shared input style ────────────────────────────────────────────────────────
const inp = "px-2 py-1.5 border border-gray-300 rounded text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-400";
const sel_cls = `${inp} bg-white`;

// ── Source Node ───────────────────────────────────────────────────────────────
function SourceNode({ id, data }: NodeProps) {
  const d = data as SourceNodeData;
  const [tables, setTables] = useState<string[]>([]);
  useEffect(() => {
    api.get<any>('/tables').then(r => setTables(r?.tables ?? r ?? [])).catch(() => {});
  }, []);

  return (
    <div className="bg-white border-2 border-blue-500 rounded-xl shadow-lg min-w-[180px]">
      <div className="bg-blue-500 text-white px-3 py-2 rounded-t-xl flex items-center gap-2">
        <Database className="size-4 shrink-0" />
        <span className="text-xs font-bold tracking-wide uppercase">Source Table</span>
      </div>
      <div className="p-3">
        <select
          value={d.table || ''}
          onChange={e => {
            d.table = e.target.value;
            // force re-render via noop state; actual update happens in parent via onNodesChange
          }}
          className={sel_cls}
        >
          <option value="">— select table —</option>
          {tables.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {d.table && <p className="text-xs text-blue-600 mt-1 font-mono truncate">{d.table}</p>}
      </div>
      <Handle type="source" position={Position.Bottom} id="success"
        style={{ background: '#22c55e', width: 10, height: 10, bottom: -5 }} />
    </div>
  );
}

// ── Sink Node ─────────────────────────────────────────────────────────────────
function SinkNode({ data }: NodeProps) {
  const d = data as SinkNodeData;
  return (
    <div className="bg-white border-2 border-emerald-500 rounded-xl shadow-lg min-w-[180px]">
      <Handle type="target" position={Position.Top} id="input"
        style={{ background: '#6b7280', width: 10, height: 10, top: -5 }} />
      <div className="bg-emerald-500 text-white px-3 py-2 rounded-t-xl flex items-center gap-2">
        <ArrowDownToLine className="size-4 shrink-0" />
        <span className="text-xs font-bold tracking-wide uppercase">Output</span>
      </div>
      <div className="p-3">
        <input value={d.table || ''} onChange={e => { d.table = e.target.value; }}
          placeholder="Table name" className={inp} />
        {d.table && <p className="text-xs text-emerald-600 mt-1 font-mono truncate">→ {d.table}</p>}
      </div>
    </div>
  );
}

// ── Error Sink Node ───────────────────────────────────────────────────────────
function ErrorSinkNode({ data }: NodeProps) {
  const d = data as SinkNodeData;
  return (
    <div className="bg-white border-2 border-red-500 rounded-xl shadow-lg min-w-[180px]">
      <Handle type="target" position={Position.Top} id="input"
        style={{ background: '#ef4444', width: 10, height: 10, top: -5 }} />
      <div className="bg-red-500 text-white px-3 py-2 rounded-t-xl flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="text-xs font-bold tracking-wide uppercase">Error Sink</span>
      </div>
      <div className="p-3">
        <input value={d.table || ''} onChange={e => { d.table = e.target.value; }}
          placeholder="Error table name" className={inp} />
        <p className="text-xs text-red-500 mt-1">Receives bad rows from error ports</p>
      </div>
    </div>
  );
}

// ── Transform Node ────────────────────────────────────────────────────────────
const OP_LABELS: Record<string, string> = {
  filter: 'Filter Rows', drop_col: 'Drop Column', rename_col: 'Rename Column',
  change_type: 'Change Type', fill_na: 'Fill Missing', clean_text: 'Clean Text',
  drop_duplicates: 'Drop Duplicates', normalize: 'Normalize', encode: 'Encode',
  feature_engineering: 'Feature Engineering', text_feature: 'Text Feature',
  groupby: 'Group By', sample: 'Sample Rows', join: 'Join Tables',
  union: 'Union / Append', pivot: 'Pivot', unpivot: 'Unpivot',
  formula_col: 'Formula Column', regex_extract: 'Regex Extract',
};

const OP_COLORS: Record<string, string> = {
  filter: 'purple', drop_col: 'gray', rename_col: 'gray', change_type: 'indigo',
  fill_na: 'amber', clean_text: 'teal', drop_duplicates: 'teal',
  normalize: 'blue', encode: 'blue', feature_engineering: 'violet',
  text_feature: 'violet', groupby: 'orange', sample: 'cyan',
  join: 'rose', union: 'rose', pivot: 'pink', unpivot: 'pink',
  formula_col: 'lime', regex_extract: 'lime',
};

const COLOR_MAP: Record<string, { border: string; header: string; dot: string }> = {
  purple:  { border: 'border-purple-500',  header: 'bg-purple-500',  dot: '#a855f7' },
  gray:    { border: 'border-gray-500',    header: 'bg-gray-500',    dot: '#6b7280' },
  indigo:  { border: 'border-indigo-500',  header: 'bg-indigo-500',  dot: '#6366f1' },
  amber:   { border: 'border-amber-500',   header: 'bg-amber-500',   dot: '#f59e0b' },
  teal:    { border: 'border-teal-500',    header: 'bg-teal-500',    dot: '#14b8a6' },
  blue:    { border: 'border-blue-500',    header: 'bg-blue-500',    dot: '#3b82f6' },
  violet:  { border: 'border-violet-500',  header: 'bg-violet-500',  dot: '#8b5cf6' },
  orange:  { border: 'border-orange-500',  header: 'bg-orange-500',  dot: '#f97316' },
  cyan:    { border: 'border-cyan-500',    header: 'bg-cyan-500',    dot: '#06b6d4' },
  rose:    { border: 'border-rose-500',    header: 'bg-rose-500',    dot: '#f43f5e' },
  pink:    { border: 'border-pink-500',    header: 'bg-pink-500',    dot: '#ec4899' },
  lime:    { border: 'border-lime-500',    header: 'bg-lime-500',    dot: '#84cc16' },
};

function TransformNode({ id, data }: NodeProps) {
  const d       = data as TransformNodeData;
  const [open, setOpen] = useState(false);
  const color   = COLOR_MAP[OP_COLORS[d.opType] ?? 'gray'] ?? COLOR_MAP.gray;
  const label   = OP_LABELS[d.opType] ?? d.opType;

  return (
    <div className={`bg-white border-2 ${color.border} rounded-xl shadow-lg min-w-[220px] max-w-[300px]`}>
      <Handle type="target" position={Position.Top} id="input"
        style={{ background: '#6b7280', width: 10, height: 10, top: -5 }} />

      {/* Header */}
      <div className={`${color.header} text-white px-3 py-2 rounded-t-xl flex items-center justify-between`}>
        <span className="text-xs font-bold tracking-wide uppercase truncate">{label}</span>
        <button onClick={() => setOpen(o => !o)} className="ml-2 opacity-80 hover:opacity-100">
          {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {/* Params summary (collapsed) */}
      {!open && (
        <div className="px-3 py-2">
          <p className="text-xs text-gray-500 truncate">{_paramSummary(d.opType, d.params)}</p>
        </div>
      )}

      {/* Inline form (expanded) */}
      {open && (
        <div className="p-3 space-y-2 nodrag">
          <TransformForm opType={d.opType} params={d.params}
            onChange={(k, v) => { d.params = { ...d.params, [k]: v }; }} />
        </div>
      )}

      {/* Output handles */}
      <div className="flex justify-between px-3 pb-2 mt-1">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-[10px] text-gray-500">success</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500">error</span>
          <div className="w-2 h-2 rounded-full bg-red-500" />
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="success"
        style={{ background: '#22c55e', width: 10, height: 10, bottom: -5, left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="error"
        style={{ background: '#ef4444', width: 10, height: 10, bottom: -5, left: '70%' }} />
    </div>
  );
}

function _paramSummary(opType: string, params: Record<string, any>): string {
  const p = params;
  switch (opType) {
    case 'filter':    return `${p.column || '?'} ${p.operator || '>'} ${p.value ?? ''}`;
    case 'drop_col':  return p.column || 'column not set';
    case 'rename_col':return `${p.column || '?'} → ${p.new_name || '?'}`;
    case 'change_type': return `${p.column || '?'} → ${p.new_type || 'str'}`;
    case 'fill_na':   return `${p.column || '?'} fill with ${p.method || 'mean'}`;
    case 'clean_text':return `${p.column || '?'} ${p.operation || 'lower'}`;
    case 'normalize': return `${p.method || 'minmax'}`;
    case 'sample':    return p.method === 'pct' ? `${p.pct || 10}%` : `${p.n || 100} rows`;
    case 'join':      return `${p.how || 'inner'} on ${p.left_key || '?'}`;
    case 'formula_col': return p.formula || 'formula not set';
    case 'regex_extract': return `${p.column || '?'} → ${p.pattern || '?'}`;
    default: return '';
  }
}

// ── Inline transform form (mini version inside node) ─────────────────────────
function TransformForm({
  opType, params, onChange,
}: {
  opType: OpType;
  params: Record<string, any>;
  onChange: (key: string, value: any) => void;
}) {
  const [cols, setCols] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);

  useEffect(() => {
    api.get<any>('/tables').then(r => {
      const tList: string[] = r?.tables ?? r ?? [];
      setTables(tList);
    }).catch(() => {});
  }, []);

  const field = (key: string, placeholder: string, type = 'text') => (
    <input type={type} placeholder={placeholder} value={params[key] ?? ''} className={inp}
      onChange={e => onChange(key, e.target.value)} />
  );

  const colSel = (key: string, placeholder = 'Column') => (
    <input type="text" placeholder={placeholder} value={params[key] ?? ''} className={inp}
      onChange={e => onChange(key, e.target.value)} />
  );

  const optSel = (key: string, options: [string, string][], def = '') => (
    <select value={params[key] ?? def} className={sel_cls} onChange={e => onChange(key, e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  switch (opType) {
    case 'filter': return <>
      {colSel('column', 'Column')}
      {optSel('operator', [['>', '> greater'], ['<', '< less'], ['==', '== equals'], ['!=', '!= not equal'], ['>=', '>= ≥'], ['<=', '<= ≤']], '>')}
      {field('value', 'Value')}
    </>;
    case 'drop_col': return colSel('column', 'Column to drop');
    case 'rename_col': return <>{colSel('column', 'Old name')}{field('new_name', 'New name')}</>;
    case 'change_type': return <>
      {colSel('column', 'Column')}
      {optSel('new_type', [['str','String'],['int','Integer'],['float','Float'],['datetime','DateTime'],['bool','Boolean']], 'str')}
    </>;
    case 'fill_na': return <>
      {colSel('column', 'Column')}
      {optSel('method', [['mean','Mean'],['median','Median'],['mode','Mode'],['value','Fixed value']], 'mean')}
      {field('value', 'Value (if fixed)')}
    </>;
    case 'clean_text': return <>
      {colSel('column', 'Column')}
      {optSel('operation', [['lower','Lowercase'],['upper','Uppercase'],['trim','Trim'],['title','Title Case']], 'lower')}
    </>;
    case 'drop_duplicates': return colSel('subset', 'Subset column (optional)');
    case 'normalize': return <>
      {field('columns', 'Columns (comma-separated)')}
      {optSel('method', [['minmax','Min-Max'],['zscore','Z-Score'],['log','Log']], 'minmax')}
    </>;
    case 'encode': return <>
      {colSel('column', 'Column')}
      {optSel('method', [['onehot','One-Hot'],['label','Label'],['binary','Binary']], 'onehot')}
    </>;
    case 'sample': return <>
      {optSel('method', [['n','N rows'],['pct','Percentage']], 'n')}
      {params.method === 'pct'
        ? field('pct', '% (1-100)', 'number')
        : field('n', 'Number of rows', 'number')}
    </>;
    case 'join': return <>
      <select value={params.right_table ?? ''} className={sel_cls}
        onChange={e => onChange('right_table', e.target.value)}>
        <option value="">— right table —</option>
        {tables.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {optSel('how', [['inner','Inner'],['left','Left'],['right','Right'],['outer','Full outer']], 'inner')}
      {field('left_key', 'Left key')}
      {field('right_key', 'Right key (blank = same)')}
    </>;
    case 'union': return <>
      <select value={params.right_table ?? ''} className={sel_cls}
        onChange={e => onChange('right_table', e.target.value)}>
        <option value="">— second table —</option>
        {tables.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {optSel('mode', [['all','ALL (keep dups)'],['distinct','DISTINCT']], 'all')}
    </>;
    case 'pivot': return <>
      {field('index_col', 'Index column')}
      {field('columns_col', 'Spread column')}
      {field('values_col', 'Values column')}
      {optSel('agg_func', [['mean','Mean'],['sum','Sum'],['count','Count'],['min','Min'],['max','Max']], 'mean')}
    </>;
    case 'unpivot': return <>
      {field('id_vars', 'ID columns (comma-sep)')}
      {field('value_vars', 'Value columns (comma-sep)')}
      {field('var_name', 'Variable col name')}
      {field('value_name', 'Value col name')}
    </>;
    case 'formula_col': return <>
      {field('col_name', 'New column name')}
      {field('formula', 'e.g.  price * qty')}
    </>;
    case 'regex_extract': return <>
      {colSel('column', 'Source column')}
      {field('pattern', 'Regex pattern')}
      {field('new_col', 'New column name')}
    </>;
    case 'groupby': return <>
      {field('group_cols', 'Group columns (comma-sep)')}
      {field('aggregations', '{"col":["sum","mean"]}')}
    </>;
    case 'text_feature': return <>
      {colSel('column', 'Column')}
      {optSel('feature', [['len','Length'],['word_count','Word count'],['tfidf','TF-IDF']], 'len')}
    </>;
    case 'feature_engineering': return <>
      {field('column1', 'Column A')}
      {optSel('operation', [['*','×'],['/','/'],['+',' +'],['−',' −']], '*')}
      {field('column2', 'Column B')}
    </>;
    default: return <p className="text-xs text-gray-400">No config needed</p>;
  }
}

// ── Node type registry ────────────────────────────────────────────────────────
const NODE_TYPES = {
  'source-node':     SourceNode,
  'sink-node':       SinkNode,
  'error-sink-node': ErrorSinkNode,
  'transform-node':  TransformNode,
};

// ── Palette ───────────────────────────────────────────────────────────────────
const PALETTE_SECTIONS = [
  { label: 'I/O', items: [
    { label: 'Source Table', type: 'source-node',     icon: '🗄️', defaultData: { table: '' } },
    { label: 'Output Sink',  type: 'sink-node',       icon: '📥', defaultData: { table: 'output' } },
    { label: 'Error Sink',   type: 'error-sink-node', icon: '🚨', defaultData: { table: 'pipeline_errors' } },
  ]},
  { label: 'Clean', items: [
    { label: 'Filter Rows',    type: 'transform-node', icon: '🔍', defaultData: { opType: 'filter',          params: { column: '', operator: '>', value: '' } } },
    { label: 'Drop Column',    type: 'transform-node', icon: '🗑️', defaultData: { opType: 'drop_col',        params: { column: '' } } },
    { label: 'Rename Column',  type: 'transform-node', icon: '✏️', defaultData: { opType: 'rename_col',      params: { column: '', new_name: '' } } },
    { label: 'Fill Missing',   type: 'transform-node', icon: '🔧', defaultData: { opType: 'fill_na',         params: { column: '', method: 'mean' } } },
    { label: 'Drop Dupes',     type: 'transform-node', icon: '🧹', defaultData: { opType: 'drop_duplicates', params: { subset: '' } } },
    { label: 'Clean Text',     type: 'transform-node', icon: '🔤', defaultData: { opType: 'clean_text',      params: { column: '', operation: 'lower' } } },
  ]},
  { label: 'Transform', items: [
    { label: 'Change Type',    type: 'transform-node', icon: '🔄', defaultData: { opType: 'change_type',     params: { column: '', new_type: 'str' } } },
    { label: 'Normalize',      type: 'transform-node', icon: '📊', defaultData: { opType: 'normalize',       params: { columns: '', method: 'minmax' } } },
    { label: 'Encode',         type: 'transform-node', icon: '🏷️', defaultData: { opType: 'encode',          params: { column: '', method: 'onehot' } } },
    { label: 'Formula Col',    type: 'transform-node', icon: '🧮', defaultData: { opType: 'formula_col',     params: { col_name: 'new_col', formula: '' } } },
    { label: 'Regex Extract',  type: 'transform-node', icon: '🔎', defaultData: { opType: 'regex_extract',   params: { column: '', pattern: '', new_col: '' } } },
    { label: 'Sample Rows',    type: 'transform-node', icon: '🎲', defaultData: { opType: 'sample',          params: { method: 'n', n: 100 } } },
  ]},
  { label: 'Reshape', items: [
    { label: 'Group By',       type: 'transform-node', icon: '📦', defaultData: { opType: 'groupby',         params: { group_cols: '', aggregations: '{}' } } },
    { label: 'Pivot',          type: 'transform-node', icon: '↔️', defaultData: { opType: 'pivot',           params: { index_col: '', columns_col: '', values_col: '', agg_func: 'mean' } } },
    { label: 'Unpivot',        type: 'transform-node', icon: '↕️', defaultData: { opType: 'unpivot',         params: { id_vars: '', value_vars: '', var_name: 'variable', value_name: 'value' } } },
  ]},
  { label: 'Combine', items: [
    { label: 'Join Tables',    type: 'transform-node', icon: '🔗', defaultData: { opType: 'join',            params: { right_table: '', left_key: '', right_key: '', how: 'inner' } } },
    { label: 'Union / Append', type: 'transform-node', icon: '📎', defaultData: { opType: 'union',           params: { right_table: '', mode: 'all' } } },
  ]},
];

// ── Map canvas transform-node data → backend op ───────────────────────────────
function nodeDataToOp(d: TransformNodeData): Record<string, any> {
  const p = d.params;
  switch (d.opType) {
    case 'filter':          return { type: 'filter', column: p.column, op: p.operator || '>', value: p.value };
    case 'drop_col':        return { type: 'drop_col', column: p.column };
    case 'rename_col':      return { type: 'rename_col', column: p.column, new_name: p.new_name };
    case 'change_type':     return { type: 'change_type', column: p.column, new_type: p.new_type || 'str' };
    case 'fill_na':         return { type: 'fill_na', column: p.column, method: p.method || 'mean', value: p.value };
    case 'clean_text':      return { type: 'clean', method: 'clean_text', column: p.column, clean_type: p.operation || 'lower' };
    case 'drop_duplicates': return { type: 'clean', method: 'drop_duplicates', subset: p.subset };
    case 'normalize':       return { type: 'normalize', columns: (p.columns || '').split(',').map((c:string)=>c.trim()).filter(Boolean), method: p.method || 'minmax' };
    case 'encode':          return { type: 'encode', column: p.column, method: p.method || 'onehot' };
    case 'sample':          return { type: 'sample', method: p.method || 'n', n: Number(p.n) || 100, pct: Number(p.pct) || 10 };
    case 'join':            return { type: 'join', right_table: p.right_table, left_key: p.left_key, right_key: p.right_key || p.left_key, how: p.how || 'inner' };
    case 'union':           return { type: 'union', right_table: p.right_table, mode: p.mode || 'all', column_strategy: 'intersect' };
    case 'pivot':           return { type: 'pivot', index_col: p.index_col, columns_col: p.columns_col, values_col: p.values_col, agg_func: p.agg_func || 'mean' };
    case 'unpivot':         return { type: 'unpivot', id_vars: p.id_vars, value_vars: p.value_vars, var_name: p.var_name || 'variable', value_name: p.value_name || 'value' };
    case 'formula_col':     return { type: 'formula_col', col_name: p.col_name || 'new_col', formula: p.formula };
    case 'regex_extract':   return { type: 'regex_extract', column: p.column, pattern: p.pattern, new_col: p.new_col };
    case 'groupby':         return { type: 'aggregate', method: 'groupby', group_cols: (p.group_cols || '').split(',').map((c:string)=>c.trim()).filter(Boolean), aggregations: (() => { try { return JSON.parse(p.aggregations || '{}'); } catch { return {}; } })() };
    case 'text_feature':    return { type: 'text_feature', column: p.column, method: p.feature || 'len' };
    case 'feature_engineering': return { type: 'feature_engineering', feature_type: 'interaction', column1: p.column1, column2: p.column2, operation: p.operation || '*' };
    default:                return { type: d.opType, ...p };
  }
}

// ── Results panel ─────────────────────────────────────────────────────────────
function ResultsPanel({ result, onClose }: {
  result: any;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'outputs' | 'errors' | 'stats'>('outputs');
  const outputs      = result?.outputs      ?? {};
  const errorOutputs = result?.error_outputs ?? {};
  const stats        = result?.stats        ?? {};
  const nodeStats    = result?.node_stats   ?? {};
  const errors       = result?.errors       ?? [];

  const renderTable = (preview: any[]) => {
    if (!preview?.length) return <p className="text-xs text-gray-400 p-3">No rows.</p>;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-100">
            <tr>{Object.keys(preview[0]).map(k => <th key={k} className="px-3 py-1.5 text-left font-medium text-gray-600 whitespace-nowrap">{k}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {preview.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {Object.values(row).map((v: any, j) => (
                  <td key={j} className="px-3 py-1.5 text-gray-800 whitespace-nowrap max-w-[160px] truncate">
                    {v === null || v === undefined ? <span className="text-gray-400 italic">null</span> : String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="bg-white border-t border-gray-200 h-72 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-sm text-gray-800">Pipeline Results</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${result?.status === 'ok' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {result?.status ?? '—'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          {(['outputs', 'errors', 'stats'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded font-medium ${tab === t ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {t === 'outputs' ? `📥 Outputs (${Object.keys(outputs).length})` :
               t === 'errors'  ? `🚨 Errors (${Object.keys(errorOutputs).length})` :
                                 '📈 Stats'}
            </button>
          ))}
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'outputs' && (
          Object.keys(outputs).length === 0
            ? <p className="p-4 text-sm text-gray-400">No output sinks ran.</p>
            : Object.entries(outputs).map(([table, info]: any) => (
                <div key={table} className="border-b border-gray-100">
                  <div className="px-4 py-2 bg-emerald-50 flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    <span className="text-sm font-medium text-emerald-700">{table}</span>
                    <span className="text-xs text-emerald-500">{info.rows?.toLocaleString()} rows · {info.columns?.length} cols</span>
                  </div>
                  {renderTable(info.preview)}
                </div>
              ))
        )}
        {tab === 'errors' && (
          <>
            {errors.length > 0 && (
              <div className="p-3 bg-red-50 border-b border-red-100">
                {errors.map((e: string, i: number) => (
                  <p key={i} className="text-xs text-red-600">⚠ {e}</p>
                ))}
              </div>
            )}
            {Object.keys(errorOutputs).length === 0
              ? <p className="p-4 text-sm text-gray-400">No error rows captured.</p>
              : Object.entries(errorOutputs).map(([table, info]: any) => (
                  <div key={table} className="border-b border-gray-100">
                    <div className="px-4 py-2 bg-red-50 flex items-center gap-2">
                      <AlertTriangle className="size-4 text-red-600" />
                      <span className="text-sm font-medium text-red-700">{table}</span>
                      <span className="text-xs text-red-500">{info.rows?.toLocaleString()} bad rows</span>
                    </div>
                    {renderTable(info.preview)}
                  </div>
                ))
            }
          </>
        )}
        {tab === 'stats' && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Total time',    `${stats.total_time_ms ?? '—'} ms`],
                ['Nodes run',     stats.nodes_executed ?? '—'],
                ['Error rows',    stats.error_rows_total ?? 0],
              ].map(([label, val]) => (
                <div key={label as string} className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-gray-800">{val as any}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{label as string}</div>
                </div>
              ))}
            </div>
            <table className="w-full text-xs mt-2">
              <thead className="bg-gray-100">
                <tr>
                  {['Node', 'Time (ms)', 'Rows in', 'Rows out', 'Error rows'].map(h =>
                    <th key={h} className="px-3 py-1.5 text-left font-medium text-gray-600">{h}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Object.entries(nodeStats).map(([nid, s]: any) => (
                  <tr key={nid} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-mono text-gray-500">{nid.slice(0, 8)}</td>
                    <td className="px-3 py-1.5">{s.time_ms}</td>
                    <td className="px-3 py-1.5">{s.rows_in?.toLocaleString()}</td>
                    <td className="px-3 py-1.5">{s.rows_out?.toLocaleString()}</td>
                    <td className={`px-3 py-1.5 ${s.error_rows > 0 ? 'text-red-600 font-medium' : ''}`}>{s.error_rows?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Canvas Component ─────────────────────────────────────────────────────
let _nodeIdCtr = 100;
const newNid = () => `n${++_nodeIdCtr}`;

const INITIAL_NODES: Node[] = [
  { id: 'n1', type: 'source-node', position: { x: 260, y: 60 },
    data: { table: '' } },
  { id: 'n2', type: 'transform-node', position: { x: 220, y: 220 },
    data: { opType: 'filter', params: { column: '', operator: '>', value: '' } } },
  { id: 'n3', type: 'sink-node', position: { x: 60, y: 420 },
    data: { table: 'output' } },
  { id: 'n4', type: 'error-sink-node', position: { x: 400, y: 420 },
    data: { table: 'pipeline_errors' } },
];

const INITIAL_EDGES: Edge[] = [
  { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'success', targetHandle: 'input',
    animated: true, style: { stroke: '#22c55e' } },
  { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'success', targetHandle: 'input',
    animated: true, style: { stroke: '#22c55e' } },
  { id: 'e3', source: 'n2', target: 'n4', sourceHandle: 'error', targetHandle: 'input',
    animated: true, style: { stroke: '#ef4444', strokeDasharray: '5 5' } },
];

export function PipelineCanvas({ apiKey }: PipelineCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [running,    setRunning]    = useState(false);
  const [result,     setResult]     = useState<any>(null);
  const [showResult, setShowResult] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const onConnect = useCallback((connection: Connection) => {
    const isError = connection.sourceHandle === 'error';
    setEdges(eds => addEdge({
      ...connection,
      animated: true,
      style: { stroke: isError ? '#ef4444' : '#22c55e', strokeDasharray: isError ? '5 5' : undefined },
    }, eds));
  }, [setEdges]);

  // Add a new node from the palette
  const addNode = useCallback((item: typeof PALETTE_SECTIONS[0]['items'][0]) => {
    const id = newNid();
    const offset = Math.random() * 60 - 30;
    const newNode: Node = {
      id,
      type: item.type,
      position: { x: 200 + offset, y: 200 + offset },
      data: { ...item.defaultData },
    };
    setNodes(nds => [...nds, newNode]);
  }, [setNodes]);

  const deleteSelected = useCallback(() => {
    setNodes(nds => nds.filter(n => !n.selected));
    setEdges(eds => eds.filter(e => !e.selected));
  }, [setNodes, setEdges]);

  // Serialize and execute the DAG
  const handleRun = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      // Build serializable node list with backend op in data
      const serialNodes = nodes.map(n => {
        const d: any = { ...n.data };
        if (n.type === 'transform-node') {
          d.operation = nodeDataToOp(d as TransformNodeData);
        }
        return { id: n.id, type: n.type, data: d };
      });
      const serialEdges = edges.map(e => ({
        id: e.id, source: e.source, target: e.target,
        sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
      }));
      const res = await api.post<any>('/transform/dag', {
        nodes: serialNodes, edges: serialEdges,
      });
      setResult(res);
      setShowResult(true);
    } catch (err: any) {
      setResult({ status: 'error', errors: [err.message ?? 'Unknown error'], outputs: {}, error_outputs: {}, stats: {}, node_stats: {} });
      setShowResult(true);
    } finally {
      setRunning(false);
    }
  }, [nodes, edges]);

  // Export pipeline as JSON
  const exportPipeline = () => {
    const json = JSON.stringify({ nodes, edges }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'pipeline.json'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 'calc(100vh - 120px)' }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch className="size-5 text-blue-600" />
          <span className="font-bold text-gray-900">Pipeline Canvas</span>
          <span className="text-xs text-gray-400 ml-2">Drag nodes · connect handles · run</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={deleteSelected}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200">
            <Trash2 className="size-4" /> Delete selected
          </button>
          <button onClick={exportPipeline}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
            <Download className="size-4" /> Export JSON
          </button>
          <button onClick={handleRun} disabled={running}
            className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? 'Running…' : 'Run Pipeline'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left palette */}
        <div className="w-48 bg-gray-50 border-r border-gray-200 overflow-y-auto shrink-0">
          <div className="p-2 space-y-3">
            {PALETTE_SECTIONS.map(section => (
              <div key={section.label}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1 mb-1">{section.label}</p>
                <div className="space-y-1">
                  {section.items.map(item => (
                    <button key={item.label} onClick={() => addNode(item)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 text-left">
                      <span>{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                      <Plus className="size-3 ml-auto text-gray-400 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas + results */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden" ref={reactFlowWrapper}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={NODE_TYPES}
              fitView
              deleteKeyCode="Delete"
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e5e7eb" />
              <Controls />
              <MiniMap nodeColor={n => {
                if (n.type === 'source-node') return '#3b82f6';
                if (n.type === 'sink-node')   return '#22c55e';
                if (n.type === 'error-sink-node') return '#ef4444';
                return '#8b5cf6';
              }} style={{ bottom: 60, right: 10 }} />
              <Panel position="top-right" className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> success</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 border-dashed inline-block" style={{ borderTop: '2px dashed #ef4444', height: 0, width: 12 }} /> error</span>
                </div>
              </Panel>
            </ReactFlow>
          </div>

          {/* Results panel */}
          {showResult && result && (
            <ResultsPanel result={result} onClose={() => setShowResult(false)} />
          )}
        </div>
      </div>
    </div>
  );
}
