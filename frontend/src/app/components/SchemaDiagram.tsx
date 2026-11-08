/**
 * SchemaDiagram — Feature #4: Cross-Table Schema Diagram
 *
 * Interactive ERD built on pure SVG + CSS transforms:
 *  - Draggable table nodes
 *  - Inferred FK relationship lines with crow-foot notation
 *  - Table selection for "Use in Query" — prepends context to the query
 *  - Zoom / pan via wheel + drag on canvas background
 *  - Column type badges (PK/FK/DATE/NUM/TEXT)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Network, RefreshCw, ZoomIn, ZoomOut, Maximize2,
  CheckSquare, Square, Play, Key, Link2, Info,
  GitMerge, Eye, ArrowRight, ChevronDown, Loader2, ExternalLink,
  X, Code2,
} from 'lucide-react';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Column {
  name: string;
  type: string;
}

interface Relationship {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
}

interface DiagramData {
  tables: string[];
  columns: Record<string, Column[]>;
  relationships: Relationship[];
}

interface TablePos {
  x: number;
  y: number;
}

interface SchemaDiagramProps {
  onRunQuery?: (query: string) => void;
  onSendToTransform?: (pipeline: { leftTable: string; rightTable: string; leftKey: string; rightKey: string; joinType: string }) => void;
}

// ── Join explorer types ───────────────────────────────────────────────────────

interface ForeignKey {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  source: 'declared' | 'inferred';
}

interface JoinConfig {
  leftTable: string;
  rightTable: string;
  leftKey: string;
  rightKey: string;
  joinType: 'inner' | 'left' | 'right' | 'full';
  limit: number;
}

interface JoinPreviewResult {
  rows: Record<string, any>[];
  columns: string[];
  total_rows: number;
  sql: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TABLE_W = 200;
const HEADER_H = 36;
const ROW_H = 26;
const TABLE_PADDING = 16;

function tableHeight(cols: Column[]) {
  return HEADER_H + cols.length * ROW_H + TABLE_PADDING;
}

function colTypeBadge(type: string) {
  const t = type.toLowerCase();
  if (t.includes('int') || t.includes('num') || t.includes('float') || t.includes('real') || t.includes('double') || t.includes('decimal'))
    return { label: 'NUM', cls: 'bg-blue-100 text-blue-700' };
  if (t.includes('date') || t.includes('time') || t.includes('timestamp'))
    return { label: 'DATE', cls: 'bg-purple-100 text-purple-700' };
  if (t.includes('bool'))
    return { label: 'BOOL', cls: 'bg-orange-100 text-orange-700' };
  return { label: 'TEXT', cls: 'bg-gray-100 text-gray-500' };
}

function autoLayout(tables: string[], columns: Record<string, Column[]>): Record<string, TablePos> {
  const COLS = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const H_GAP = 260;
  const V_GAP = 60;
  const pos: Record<string, TablePos> = {};
  tables.forEach((t, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const prevH = row > 0
      ? tables.slice(0, row * COLS).reduce((acc, t2) => {
          const h = tableHeight(columns[t2] || []);
          const r = Math.floor(tables.indexOf(t2) / COLS);
          return r === row - 1 ? Math.max(acc, h) : acc;
        }, 0)
      : 0;
    pos[t] = { x: 40 + col * H_GAP, y: 40 + row * (prevH + V_GAP) };
  });
  return pos;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SchemaDiagram({ onRunQuery, onSendToTransform }: SchemaDiagramProps) {
  const [data, setData] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, TablePos>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredTable, setHoveredTable] = useState<string | null>(null);

  // ── Join Explorer state ───────────────────────────────────────────────────
  const [joinMode, setJoinMode] = useState(false);
  const [joinStep, setJoinStep] = useState<'pick-left' | 'pick-right' | 'configure'>('pick-left');
  const [foreignKeys, setForeignKeys] = useState<ForeignKey[]>([]);
  const [joinConfig, setJoinConfig] = useState<JoinConfig>({
    leftTable: '', rightTable: '', leftKey: '', rightKey: '',
    joinType: 'inner', limit: 50,
  });
  const [joinPreview, setJoinPreview] = useState<JoinPreviewResult | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);

  const dragTable = useRef<{ table: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const dragCanvas = useRef<{ startX: number; startY: number; origPan: { x: number; y: number } } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<DiagramData>('/schema/diagram');
      setData(res);
      setPositions(autoLayout(res.tables, res.columns));
      setSelected(new Set(res.tables)); // select all by default
    } catch (e: any) {
      setError(e.message || 'Failed to load schema');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Mouse handlers ──────────────────────────────────────────────────────────

  const onTableMouseDown = (e: React.MouseEvent, table: string) => {
    e.stopPropagation();
    const pos = positions[table];
    dragTable.current = { table, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target !== svgRef.current) return;
    dragCanvas.current = { startX: e.clientX, startY: e.clientY, origPan: { ...pan } };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (dragTable.current) {
      const { table, startX, startY, origX, origY } = dragTable.current;
      const dx = (e.clientX - startX) / zoom;
      const dy = (e.clientY - startY) / zoom;
      setPositions(prev => ({ ...prev, [table]: { x: origX + dx, y: origY + dy } }));
    } else if (dragCanvas.current) {
      const dx = e.clientX - dragCanvas.current.startX;
      const dy = e.clientY - dragCanvas.current.startY;
      setPan({ x: dragCanvas.current.origPan.x + dx, y: dragCanvas.current.origPan.y + dy });
    }
  };

  const onMouseUp = () => {
    dragTable.current = null;
    dragCanvas.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(3, Math.max(0.3, z - e.deltaY * 0.001)));
  };

  // ── Selection ───────────────────────────────────────────────────────────────

  const toggleTable = (t: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  const handleRunWithSelected = () => {
    if (!onRunQuery || selected.size === 0) return;
    const tables = [...selected].join(', ');
    onRunQuery(`Analyze the data across these tables: ${tables}. Show me key relationships and insights.`);
  };

  // ── Join Mode logic ─────────────────────────────────────────────────────────

  const enterJoinMode = useCallback(() => {
    setJoinMode(true);
    setJoinStep('pick-left');
    setJoinConfig({ leftTable: '', rightTable: '', leftKey: '', rightKey: '', joinType: 'inner', limit: 50 });
    setJoinPreview(null);
    setJoinError(null);
    // Load FK metadata
    api.get<{ foreign_keys: ForeignKey[] }>('/schema/foreign-keys')
      .then(r => setForeignKeys(r?.foreign_keys ?? []))
      .catch(() => setForeignKeys([]));
  }, []);

  const exitJoinMode = useCallback(() => {
    setJoinMode(false);
    setJoinStep('pick-left');
    setJoinPreview(null);
    setJoinError(null);
  }, []);

  // Suggest keys between two tables based on FK metadata
  const suggestKeys = useCallback((left: string, right: string): { leftKey: string; rightKey: string } | null => {
    // Look for a FK in either direction
    const fk = foreignKeys.find(
      f => (f.from_table === left && f.to_table === right) ||
           (f.from_table === right && f.to_table === left)
    );
    if (fk) {
      if (fk.from_table === left) return { leftKey: fk.from_column, rightKey: fk.to_column };
      return { leftKey: fk.to_column, rightKey: fk.from_column };
    }
    return null;
  }, [foreignKeys]);

  const handleTableClickInJoinMode = useCallback((table: string) => {
    if (joinStep === 'pick-left') {
      setJoinConfig(c => ({ ...c, leftTable: table, leftKey: '', rightKey: '' }));
      setJoinStep('pick-right');
    } else if (joinStep === 'pick-right' && table !== joinConfig.leftTable) {
      const suggestion = suggestKeys(joinConfig.leftTable, table);
      setJoinConfig(c => ({
        ...c,
        rightTable: table,
        leftKey:  suggestion?.leftKey  ?? '',
        rightKey: suggestion?.rightKey ?? '',
      }));
      setJoinStep('configure');
      setJoinPreview(null);
    }
  }, [joinStep, joinConfig.leftTable, suggestKeys]);

  const runJoinPreview = useCallback(async () => {
    setJoinLoading(true);
    setJoinError(null);
    setJoinPreview(null);
    try {
      const result = await api.post<JoinPreviewResult>('/schema/join-preview', {
        left_table:  joinConfig.leftTable,
        right_table: joinConfig.rightTable,
        left_key:    joinConfig.leftKey,
        right_key:   joinConfig.rightKey,
        join_type:   joinConfig.joinType,
        limit:       joinConfig.limit,
      });
      setJoinPreview(result);
    } catch (e: any) {
      setJoinError(e?.message ?? 'Join failed');
    } finally {
      setJoinLoading(false);
    }
  }, [joinConfig]);

  const sendToTransform = useCallback(() => {
    if (!onSendToTransform) return;
    onSendToTransform({
      leftTable:  joinConfig.leftTable,
      rightTable: joinConfig.rightTable,
      leftKey:    joinConfig.leftKey,
      rightKey:   joinConfig.rightKey,
      joinType:   joinConfig.joinType,
    });
  }, [joinConfig, onSendToTransform]);

  const fitView = () => {
    if (!data || !Object.keys(positions).length) return;
    const xs = data.tables.map(t => positions[t]?.x ?? 0);
    const ys = data.tables.map(t => positions[t]?.y ?? 0);
    const maxX = Math.max(...xs) + TABLE_W + 40;
    const maxY = Math.max(...ys) + 300;
    const svgW = svgRef.current?.clientWidth ?? 800;
    const svgH = svgRef.current?.clientHeight ?? 600;
    const newZoom = Math.min(svgW / maxX, svgH / maxY, 1);
    setZoom(newZoom);
    setPan({ x: 0, y: 0 });
  };

  // ── Relationship lines ──────────────────────────────────────────────────────

  const renderRelationships = () => {
    if (!data) return null;
    return data.relationships.map((rel, i) => {
      const from = positions[rel.from_table];
      const to = positions[rel.to_table];
      if (!from || !to) return null;

      const fromCols = data.columns[rel.from_table] || [];
      const colIdx = fromCols.findIndex(c => c.name === rel.from_column);
      const fy = from.y + HEADER_H + (colIdx >= 0 ? colIdx * ROW_H + ROW_H / 2 : ROW_H / 2);
      const fx = from.x + TABLE_W;
      const ty = to.y + HEADER_H / 2;
      const tx = to.x;

      const isActive = hoveredTable === rel.from_table || hoveredTable === rel.to_table;

      // Bezier curve
      const cx1 = fx + (tx - fx) * 0.6;
      const cx2 = tx - (tx - fx) * 0.6;

      return (
        <g key={i}>
          <path
            d={`M ${fx} ${fy} C ${cx1} ${fy}, ${cx2} ${ty}, ${tx} ${ty}`}
            stroke={isActive ? '#6366f1' : '#94a3b8'}
            strokeWidth={isActive ? 2 : 1.5}
            strokeDasharray={isActive ? undefined : '5,3'}
            fill="none"
            opacity={isActive ? 1 : 0.5}
          />
          {/* Arrow at target */}
          <circle cx={tx} cy={ty} r={4} fill={isActive ? '#6366f1' : '#94a3b8'} opacity={isActive ? 1 : 0.6} />
          {/* Dot at source */}
          <circle cx={fx} cy={fy} r={3} fill={isActive ? '#6366f1' : '#94a3b8'} opacity={isActive ? 1 : 0.6} />
        </g>
      );
    });
  };

  // ── Table nodes ─────────────────────────────────────────────────────────────

  const renderTable = (table: string) => {
    const pos = positions[table];
    if (!pos) return null;
    const cols = data?.columns[table] ?? [];
    const h = tableHeight(cols);
    const isSelected = selected.has(table);
    const isHovered = hoveredTable === table;

    // ── Join mode visual states ─────────────────────────────────────────────
    const isJoinLeft  = joinMode && joinConfig.leftTable  === table;
    const isJoinRight = joinMode && joinConfig.rightTable === table;
    const isJoinSelectable = joinMode && joinStep === 'pick-right' && table !== joinConfig.leftTable;
    const headerFill = isJoinLeft  ? '#0369a1'   // sky-700 — left table
                     : isJoinRight ? '#7c3aed'   // violet-700 — right table
                     : isSelected  ? '#6366f1'
                     : '#1e293b';
    const borderColor = isJoinLeft  ? '#0ea5e9'
                      : isJoinRight ? '#8b5cf6'
                      : isSelected  ? '#6366f1'
                      : isHovered   ? '#94a3b8'
                      : '#e2e8f0';

    // Which columns are FK sources?
    const fkCols = new Set(
      (data?.relationships ?? [])
        .filter(r => r.from_table === table)
        .map(r => r.from_column)
    );

    return (
      <g
        key={table}
        transform={`translate(${pos.x}, ${pos.y})`}
        style={{ cursor: joinMode && joinStep !== 'configure' ? (isJoinSelectable || joinStep === 'pick-left' ? 'pointer' : 'default') : 'grab' }}
        onMouseDown={e => { if (!joinMode) onTableMouseDown(e, table); }}
        onClick={() => { if (joinMode && joinStep !== 'configure') handleTableClickInJoinMode(table); }}
        onMouseEnter={() => setHoveredTable(table)}
        onMouseLeave={() => setHoveredTable(null)}
      >
        {/* Shadow */}
        <rect x={3} y={3} width={TABLE_W} height={h} rx={8} fill="rgba(0,0,0,0.1)" />

        {/* Join-mode hover glow */}
        {joinMode && isJoinSelectable && isHovered && (
          <rect width={TABLE_W + 4} height={h + 4} x={-2} y={-2} rx={10} fill="none" stroke="#8b5cf6" strokeWidth={3} opacity={0.6} />
        )}

        {/* Body */}
        <rect
          width={TABLE_W}
          height={h}
          rx={8}
          fill="white"
          stroke={borderColor}
          strokeWidth={isJoinLeft || isJoinRight || isSelected ? 2.5 : 1}
        />

        {/* Header */}
        <rect
          width={TABLE_W}
          height={HEADER_H}
          rx={8}
          fill={headerFill}
          style={{ clipPath: 'inset(0 0 -8px 0)' }}
        />
        <rect width={TABLE_W} height={8} y={HEADER_H - 8} fill={headerFill} />

        {/* Join-mode role badge (LEFT / RIGHT) */}
        {(isJoinLeft || isJoinRight) && (
          <foreignObject x={6} y={9} width={40} height={18}>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.9)', background: 'rgba(255,255,255,0.2)', padding: '1px 4px', borderRadius: 3, fontFamily: 'monospace' }}>
              {isJoinLeft ? 'LEFT' : 'RIGHT'}
            </span>
          </foreignObject>
        )}

        {/* Selection checkbox (normal mode only) */}
        {!joinMode && (
        <foreignObject x={8} y={9} width={18} height={18}>
          <button
            onClick={e => { e.stopPropagation(); toggleTable(table); }}
            className="w-4 h-4 flex items-center justify-center rounded text-white opacity-70 hover:opacity-100"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {isSelected
              ? <CheckSquare size={14} className="text-white" />
              : <Square size={14} className="text-white" />
            }
          </button>
        </foreignObject>
        )}

        {/* Table name */}
        <text
          x={TABLE_W / 2}
          y={HEADER_H / 2 + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize={13}
          fontWeight={700}
          fontFamily="system-ui, sans-serif"
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {table.length > 18 ? table.slice(0, 17) + '…' : table}
        </text>

        {/* Columns */}
        {cols.map((col, i) => {
          const badge = colTypeBadge(col.type);
          const isFk = fkCols.has(col.name);
          const isId = col.name.toLowerCase() === 'id';
          return (
            <g key={col.name} transform={`translate(0, ${HEADER_H + i * ROW_H})`}>
              <rect
                width={TABLE_W}
                height={ROW_H}
                fill={i % 2 === 0 ? '#f8fafc' : 'white'}
                style={{ pointerEvents: 'none' }}
              />
              {/* Key icon */}
              {(isId || isFk) && (
                <text x={10} y={ROW_H / 2 + 1} dominantBaseline="middle" fontSize={10} fill={isId ? '#f59e0b' : '#6366f1'} style={{ userSelect: 'none', pointerEvents: 'none' }}>
                  {isId ? '🔑' : '🔗'}
                </text>
              )}
              {/* Column name */}
              <text
                x={isId || isFk ? 26 : 12}
                y={ROW_H / 2 + 1}
                dominantBaseline="middle"
                fill="#374151"
                fontSize={11}
                fontFamily="system-ui, sans-serif"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {col.name.length > 18 ? col.name.slice(0, 17) + '…' : col.name}
              </text>
              {/* Type badge */}
              <foreignObject x={TABLE_W - 42} y={ROW_H / 2 - 8} width={38} height={16}>
                <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${badge.cls}`}>
                  {badge.label}
                </span>
              </foreignObject>
            </g>
          );
        })}

        {/* Bottom border radius */}
        <rect
          x={0}
          y={h - 8}
          width={TABLE_W}
          height={8}
          rx={0}
          fill="white"
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="size-12 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto">
            <Network className="size-6 text-indigo-600 animate-pulse" />
          </div>
          <p className="text-sm text-gray-500">Building schema diagram…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="text-center space-y-3 max-w-sm">
          <p className="text-red-500 font-medium">Failed to load schema</p>
          <p className="text-xs text-gray-400">{error}</p>
          <button onClick={load} className="mt-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">Retry</button>
        </div>
      </div>
    );
  }

  if (!data || data.tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="text-center space-y-3">
          <Network className="size-12 text-gray-300 mx-auto" />
          <p className="text-gray-500">No tables found. Connect a database first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 bg-white shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <Network className="size-5 text-indigo-600" />
          <h1 className="font-bold text-gray-900">Schema Diagram</h1>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {data.tables.length} tables · {data.relationships.length} relationships
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Zoom controls */}
          <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
            <ZoomIn size={15} />
          </button>
          <span className="text-xs text-gray-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
            <ZoomOut size={15} />
          </button>
          <button onClick={fitView} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600" title="Fit view">
            <Maximize2 size={15} />
          </button>

          <div className="w-px h-6 bg-gray-200 mx-1" />

          <button onClick={load} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600" title="Refresh">
            <RefreshCw size={15} />
          </button>

          {/* Join Explorer toggle */}
          <button
            onClick={joinMode ? exitJoinMode : enterJoinMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors border ${
              joinMode
                ? 'bg-violet-600 text-white border-violet-600 hover:bg-violet-700'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-300'
            }`}
            title="Visual join builder"
          >
            <GitMerge size={13} />
            {joinMode ? 'Exit Join Mode' : 'Join Explorer'}
          </button>

          {/* Use selected in query */}
          {onRunQuery && !joinMode && (
            <button
              onClick={handleRunWithSelected}
              disabled={selected.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              <Play size={13} />
              Query {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-5 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 shrink-0">
        {!joinMode ? (
          <>
            <span className="flex items-center gap-1"><span className="text-amber-500">🔑</span> Primary Key</span>
            <span className="flex items-center gap-1"><span className="text-indigo-500">🔗</span> Foreign Key</span>
            <span className="flex items-center gap-1"><span className="inline-block w-6 h-px bg-slate-400 border-dashed border" /></span><span>Inferred relationship</span>
            <span className="ml-auto flex items-center gap-1 text-gray-400"><Info size={12} /> Drag tables · Scroll to zoom · Click checkbox to select</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-sky-500" /> Left table (source)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-violet-500" /> Right table
            </span>
            <span className="ml-auto flex items-center gap-1 text-violet-600 font-medium">
              <GitMerge size={12} />
              {joinStep === 'pick-left' ? 'Click a table to set as LEFT' :
               joinStep === 'pick-right' ? 'Click another table to set as RIGHT' :
               'Configure join below'}
            </span>
          </>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="flex-1 overflow-hidden bg-slate-50 relative" style={{ backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
        <svg
          ref={svgRef}
          className="w-full h-full"
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
          style={{ cursor: dragCanvas.current ? 'grabbing' : 'default' }}
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Relationship lines (behind tables) */}
            {renderRelationships()}
            {/* Table nodes */}
            {data.tables.map(t => renderTable(t))}
          </g>
        </svg>

        {/* ── Join Explorer panel ──────────────────────────────────────────── */}
        {joinMode && joinStep === 'configure' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-30">
            <div className="bg-white rounded-2xl shadow-2xl border border-violet-200 overflow-hidden">
              {/* Panel header */}
              <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <GitMerge size={15} />
                  Join Explorer
                  <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">
                    {joinConfig.leftTable} ↔ {joinConfig.rightTable}
                  </span>
                </div>
                <button onClick={exitJoinMode} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                  <X size={15} />
                </button>
              </div>

              {/* Config row */}
              <div className="grid grid-cols-5 gap-3 px-5 py-4 items-end bg-violet-50/50">
                {/* Left key */}
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-sky-700 mb-1">
                    <span className="inline-block w-2 h-2 rounded-sm bg-sky-500 mr-1" />
                    {joinConfig.leftTable} key
                  </label>
                  <select
                    value={joinConfig.leftKey}
                    onChange={e => setJoinConfig(c => ({ ...c, leftKey: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  >
                    <option value="">— select column —</option>
                    {(data?.columns[joinConfig.leftTable] ?? []).map(col => (
                      <option key={col.name} value={col.name}>{col.name}</option>
                    ))}
                  </select>
                </div>

                {/* Join type */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Join type</label>
                  <select
                    value={joinConfig.joinType}
                    onChange={e => setJoinConfig(c => ({ ...c, joinType: e.target.value as JoinConfig['joinType'] }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  >
                    <option value="inner">INNER</option>
                    <option value="left">LEFT</option>
                    <option value="right">RIGHT</option>
                    <option value="full">FULL OUTER</option>
                  </select>
                </div>

                {/* Right key */}
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-violet-700 mb-1">
                    <span className="inline-block w-2 h-2 rounded-sm bg-violet-500 mr-1" />
                    {joinConfig.rightTable} key
                  </label>
                  <select
                    value={joinConfig.rightKey}
                    onChange={e => setJoinConfig(c => ({ ...c, rightKey: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  >
                    <option value="">— select column —</option>
                    {(data?.columns[joinConfig.rightTable] ?? []).map(col => (
                      <option key={col.name} value={col.name}>{col.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-3 px-5 py-3 border-t border-gray-100 bg-white">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Rows preview</label>
                  <select
                    value={joinConfig.limit}
                    onChange={e => setJoinConfig(c => ({ ...c, limit: Number(e.target.value) }))}
                    className="text-xs border border-gray-200 rounded px-1 py-0.5"
                  >
                    {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                {/* SQL toggle */}
                {joinPreview && (
                  <button
                    onClick={() => setShowSql(v => !v)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 ml-2"
                  >
                    <Code2 size={12} />
                    {showSql ? 'Hide SQL' : 'Show SQL'}
                  </button>
                )}

                <div className="ml-auto flex items-center gap-2">
                  {/* Reset tables */}
                  <button
                    onClick={() => { setJoinStep('pick-left'); setJoinConfig(c => ({ ...c, leftTable: '', rightTable: '', leftKey: '', rightKey: '' })); setJoinPreview(null); }}
                    className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Reset
                  </button>

                  {/* Preview */}
                  <button
                    onClick={runJoinPreview}
                    disabled={!joinConfig.leftKey || !joinConfig.rightKey || joinLoading}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-40 transition-colors"
                  >
                    {joinLoading ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                    Preview Join
                  </button>

                  {/* Send to Transform */}
                  {onSendToTransform && joinPreview && (
                    <button
                      onClick={sendToTransform}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      <ArrowRight size={12} />
                      Send to Transform
                    </button>
                  )}
                </div>
              </div>

              {/* Error */}
              {joinError && (
                <div className="px-5 py-2 bg-red-50 text-red-600 text-xs border-t border-red-100">
                  {joinError}
                </div>
              )}

              {/* SQL viewer */}
              {showSql && joinPreview?.sql && (
                <div className="px-5 py-3 bg-gray-900 text-green-400 text-xs font-mono overflow-x-auto border-t border-gray-700">
                  {joinPreview.sql}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Join Preview Results table ──────────────────────────────────── */}
        {joinMode && joinPreview && joinPreview.rows.length > 0 && (
          <div className="absolute top-2 right-2 w-80 max-h-64 bg-white rounded-xl shadow-xl border border-violet-200 overflow-hidden z-20 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 bg-violet-50 border-b border-violet-100 shrink-0">
              <span className="text-xs font-semibold text-violet-700 flex items-center gap-1.5">
                <Eye size={11} /> Preview — {joinPreview.total_rows} rows · {joinPreview.columns.length} cols
              </span>
              <button onClick={() => setJoinPreview(null)} className="text-gray-400 hover:text-gray-600">
                <X size={12} />
              </button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="text-xs w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {joinPreview.columns.slice(0, 6).map(c => (
                      <th key={c} className="px-2 py-1 text-left font-medium text-gray-500 whitespace-nowrap border-b border-gray-100">
                        {c.length > 10 ? c.slice(0, 9) + '…' : c}
                      </th>
                    ))}
                    {joinPreview.columns.length > 6 && (
                      <th className="px-2 py-1 text-gray-400 border-b border-gray-100">+{joinPreview.columns.length - 6}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {joinPreview.rows.slice(0, 8).map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      {joinPreview.columns.slice(0, 6).map(c => (
                        <td key={c} className="px-2 py-1 text-gray-700 whitespace-nowrap max-w-[80px] overflow-hidden text-ellipsis border-b border-gray-50">
                          {row[c] == null ? <span className="text-gray-300">null</span> : String(row[c]).slice(0, 12)}
                        </td>
                      ))}
                      {joinPreview.columns.length > 6 && <td className="px-2 py-1 text-gray-300 border-b border-gray-50">…</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
