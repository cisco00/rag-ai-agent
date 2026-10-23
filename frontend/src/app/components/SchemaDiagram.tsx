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
  CheckSquare, Square, Play, Key, Link2, Info
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

export function SchemaDiagram({ onRunQuery }: SchemaDiagramProps) {
  const [data, setData] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, TablePos>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredTable, setHoveredTable] = useState<string | null>(null);

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
        style={{ cursor: 'grab' }}
        onMouseDown={e => onTableMouseDown(e, table)}
        onMouseEnter={() => setHoveredTable(table)}
        onMouseLeave={() => setHoveredTable(null)}
      >
        {/* Shadow */}
        <rect x={3} y={3} width={TABLE_W} height={h} rx={8} fill="rgba(0,0,0,0.1)" />

        {/* Body */}
        <rect
          width={TABLE_W}
          height={h}
          rx={8}
          fill="white"
          stroke={isSelected ? '#6366f1' : isHovered ? '#94a3b8' : '#e2e8f0'}
          strokeWidth={isSelected ? 2 : 1}
        />

        {/* Header */}
        <rect
          width={TABLE_W}
          height={HEADER_H}
          rx={8}
          fill={isSelected ? '#6366f1' : '#1e293b'}
          style={{ clipPath: 'inset(0 0 -8px 0)' }}
        />
        <rect width={TABLE_W} height={8} y={HEADER_H - 8} fill={isSelected ? '#6366f1' : '#1e293b'} />

        {/* Selection checkbox */}
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

          {/* Use selected in query */}
          {onRunQuery && (
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
        <span className="flex items-center gap-1"><span className="text-amber-500">🔑</span> Primary Key</span>
        <span className="flex items-center gap-1"><span className="text-indigo-500">🔗</span> Foreign Key</span>
        <span className="flex items-center gap-1"><span className="inline-block w-6 h-px bg-slate-400 border-dashed border" /></span><span>Inferred relationship</span>
        <span className="ml-auto flex items-center gap-1 text-gray-400"><Info size={12} /> Drag tables · Scroll to zoom · Click checkbox to select</span>
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
      </div>
    </div>
  );
}
