/**
 * NotebookView — multi-cell SQL + markdown explorer
 *
 * Improvements over v1:
 *   1. AI SQL generation  — "Ask AI" inside each SQL cell
 *   2. Export CSV         — download results with one click
 *   3. Pin to Dashboard   — send a cell result to any dashboard card
 *   4. Collapse results   — fold away result panels to keep things tidy
 *   5. Duplicate cell     — clone any cell
 *   6. Notebook search    — filter sidebar when you have many notebooks
 *   7. Last modified      — relative timestamps in the sidebar list
 */

import {
  useState, useEffect, useRef, useCallback, KeyboardEvent,
} from 'react';
import {
  BookOpen, Plus, Trash2, Play, ChevronDown, ChevronUp, Loader2,
  X, CheckCircle2, AlertCircle, FileText, Code2, BarChart2,
  Table2, Save, PenLine, Eye, Pencil, Copy, Check,
  Download, Pin, Sparkles, ChevronsUpDown, Search, LayoutGrid,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type CellType = 'sql' | 'markdown';

interface CellResult {
  columns: string[];
  data: Record<string, any>[];
  row_count: number;
  visualization?: { type: 'bar' | 'line'; x: string; ys: string[] } | null;
  error?: string;
}

interface Cell {
  id: string;
  type: CellType;
  content: string;
  result?: CellResult | null;
  running?: boolean;
  showChart?: boolean;
  chartType?: 'bar' | 'line';
  viewMode?: 'edit' | 'preview';
  collapsed?: boolean;        // ← new: fold results
  aiPrompt?: string;          // ← new: AI SQL prompt text
  aiLoading?: boolean;        // ← new: AI generation in flight
}

interface Notebook {
  id: number;
  title: string;
  cells: Omit<Cell, 'result' | 'running' | 'showChart' | 'viewMode' | 'collapsed' | 'aiPrompt' | 'aiLoading'>[];
  created_at: string;
  updated_at: string;
}

interface Dashboard { id: number; name: string; }

// ── Constants ─────────────────────────────────────────────────────────────────

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];
const SAVE_DEBOUNCE_MS = 1500;

function uid() { return Math.random().toString(36).slice(2, 10); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

function exportCsv(columns: string[], data: Record<string, any>[], filename = 'results.csv') {
  const rows = [columns.join(','), ...data.map(r => columns.map(c => {
    const v = r[c] == null ? '' : String(r[c]);
    return v.includes(',') || v.includes('"') || v.includes('\n')
      ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','))];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Minimal Markdown renderer ─────────────────────────────────────────────────

function renderMarkdown(src: string): string {
  let h = src
    .replace(/```[\s\S]*?```/g, m => {
      const code = m.slice(3, m.lastIndexOf('```')).replace(/^[^\n]*\n/, '');
      return `<pre class="bg-gray-900 text-green-300 rounded-lg p-3 text-xs overflow-x-auto my-2 leading-relaxed">${escHtml(code)}</pre>`;
    })
    .replace(/`([^`]+)`/g, (_, c) => `<code class="bg-gray-100 text-pink-600 px-1 rounded text-sm font-mono">${escHtml(c)}</code>`)
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-bold text-gray-800 mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-gray-900 mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-gray-900 mt-6 mb-2">$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc text-gray-700">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-gray-700">$1</li>')
    .replace(/^---$/gm, '<hr class="border-gray-200 my-4" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline">$1</a>')
    .replace(/\n\n/g, '</p><p class="text-gray-700 leading-relaxed mb-2">')
    .replace(/\n/g, '<br/>');
  return `<p class="text-gray-700 leading-relaxed mb-2">${h}</p>`;
}
function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Pin-to-Dashboard modal ────────────────────────────────────────────────────

function PinModal({
  cell,
  dashboards,
  onPin,
  onClose,
}: {
  cell: Cell;
  dashboards: Dashboard[];
  onPin: (dashId: number) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(dashboards[0]?.id ?? null);
  const [pinning, setPinning] = useState(false);

  const handlePin = async () => {
    if (!selected) return;
    setPinning(true);
    await onPin(selected);
    setPinning(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pin className="size-5 text-indigo-500" />
            <h3 className="font-bold text-gray-900">Pin to Dashboard</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
            <X className="size-4" />
          </button>
        </div>
        {dashboards.length === 0 ? (
          <p className="text-sm text-gray-500">No dashboards found. Create one first.</p>
        ) : (
          <>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {dashboards.map(d => (
                <label key={d.id} className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="dash"
                    value={d.id}
                    checked={selected === d.id}
                    onChange={() => setSelected(d.id)}
                    className="accent-indigo-600"
                  />
                  <LayoutGrid className="size-4 text-gray-400" />
                  <span className="text-sm text-gray-700">{d.name}</span>
                </label>
              ))}
            </div>
            <button
              onClick={handlePin}
              disabled={pinning || !selected}
              className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {pinning ? 'Pinning…' : 'Pin to Dashboard'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── SQL Cell ──────────────────────────────────────────────────────────────────

function SqlCell({
  cell, onRun, onChange, onDelete, onMoveUp, onMoveDown,
  onDuplicate, onToggleCollapse, onAiPromptChange, onGenerateSql, onExportCsv, onPinClick,
  isFirst, isLast,
}: {
  cell: Cell;
  onRun: () => void;
  onChange: (content: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onToggleCollapse: () => void;
  onAiPromptChange: (v: string) => void;
  onGenerateSql: () => void;
  onExportCsv: () => void;
  onPinClick: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [showAi, setShowAi] = useState(false);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); onRun(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      onChange(ta.value.substring(0, start) + '  ' + ta.value.substring(end));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
    }
  };

  const copySQL = () => {
    navigator.clipboard.writeText(cell.content).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    });
  };

  const r = cell.result;
  const hasChart = r && !r.error && r.visualization;
  const chartType = cell.chartType ?? r?.visualization?.type ?? 'bar';
  const hasResult = r && !r.error;

  return (
    <div className="group border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
        <Code2 className="size-3.5 text-blue-500 shrink-0" />
        <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">SQL</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onMoveUp} disabled={isFirst} title="Move up" className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
            <ChevronUp className="size-3.5" />
          </button>
          <button onClick={onMoveDown} disabled={isLast} title="Move down" className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
            <ChevronDown className="size-3.5" />
          </button>
          <button onClick={onDuplicate} title="Duplicate cell" className="p-1 text-gray-400 hover:text-gray-600">
            <Copy className="size-3.5" />
          </button>
          <button onClick={copySQL} title="Copy SQL" className="p-1 text-gray-400 hover:text-gray-600">
            {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
          </button>
          {hasResult && (
            <>
              <button onClick={onExportCsv} title="Export CSV" className="p-1 text-gray-400 hover:text-emerald-600">
                <Download className="size-3.5" />
              </button>
              <button onClick={onPinClick} title="Pin to dashboard" className="p-1 text-gray-400 hover:text-indigo-600">
                <Pin className="size-3.5" />
              </button>
              <button onClick={onToggleCollapse} title={cell.collapsed ? 'Expand results' : 'Collapse results'} className="p-1 text-gray-400 hover:text-gray-600">
                <ChevronsUpDown className="size-3.5" />
              </button>
            </>
          )}
          <button onClick={() => setShowAi(v => !v)} title="Ask AI to write SQL" className={`p-1 rounded transition-colors ${showAi ? 'text-violet-600 bg-violet-50' : 'text-gray-400 hover:text-violet-600'}`}>
            <Sparkles className="size-3.5" />
          </button>
          <button onClick={onDelete} title="Delete cell" className="p-1 text-gray-400 hover:text-red-500">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* AI prompt bar */}
      {showAi && (
        <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 border-b border-violet-100">
          <Sparkles className="size-3.5 text-violet-500 shrink-0" />
          <input
            autoFocus
            value={cell.aiPrompt ?? ''}
            onChange={e => onAiPromptChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { onGenerateSql(); setShowAi(false); } if (e.key === 'Escape') setShowAi(false); }}
            placeholder="Describe what you want to query… (Enter to generate)"
            className="flex-1 text-xs bg-transparent border-none focus:outline-none text-violet-800 placeholder:text-violet-300"
          />
          <button
            onClick={() => { onGenerateSql(); setShowAi(false); }}
            disabled={cell.aiLoading || !cell.aiPrompt?.trim()}
            className="px-2.5 py-1 bg-violet-600 text-white rounded-lg text-xs font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {cell.aiLoading ? <Loader2 className="size-3 animate-spin" /> : 'Generate'}
          </button>
        </div>
      )}

      {/* Editor */}
      <div className="relative">
        {cell.aiLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10 rounded">
            <div className="flex items-center gap-2 text-violet-600 text-xs font-medium">
              <Loader2 className="size-4 animate-spin" /> Generating SQL…
            </div>
          </div>
        )}
        <textarea
          value={cell.content}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          rows={Math.max(3, cell.content.split('\n').length + 1)}
          placeholder="SELECT * FROM ..."
          className="w-full px-4 py-3 font-mono text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-0 leading-relaxed placeholder:text-gray-300"
        />
        <div className="absolute bottom-2 right-3 flex items-center gap-2">
          <span className="text-[10px] text-gray-300 hidden group-hover:inline">Shift+Enter to run</span>
          <button
            onClick={onRun}
            disabled={cell.running}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {cell.running ? <><Loader2 className="size-3 animate-spin" />Running…</> : <><Play className="size-3" />Run</>}
          </button>
        </div>
      </div>

      {/* Results */}
      {r && !cell.collapsed && (
        <div className="border-t border-gray-100">
          {r.error ? (
            <div className="flex items-start gap-2 p-3 bg-red-50 text-red-700 text-sm">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap font-mono text-xs">{r.error}</pre>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-100">
                <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                <span className="text-xs text-gray-500">
                  {r.row_count} row{r.row_count !== 1 ? 's' : ''} · {r.columns.length} col{r.columns.length !== 1 ? 's' : ''}
                  {r.row_count >= 500 && <span className="text-amber-500 ml-1">(capped at 500)</span>}
                </span>
                {hasChart && (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${!cell.showChart ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:bg-gray-50'}`}
                      data-action="show-table"
                    >
                      <Table2 className="size-3" /> Table
                    </button>
                    <button
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${cell.showChart ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:bg-gray-50'}`}
                      data-action="show-chart"
                    >
                      <BarChart2 className="size-3" /> Chart
                    </button>
                    {cell.showChart && (
                      <>
                        <span className="text-gray-200 mx-1">|</span>
                        {(['bar', 'line'] as const).map(t => (
                          <button key={t} className={`px-2 py-1 rounded text-xs font-medium capitalize transition-colors ${chartType === t ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-50'}`} data-chart-type={t}>
                            {t}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {cell.showChart && r.visualization ? (
                <div className="p-3">
                  <ResponsiveContainer width="100%" height={220}>
                    {chartType === 'line' ? (
                      <LineChart data={r.data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey={r.visualization.x} tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {r.visualization.ys.map((y, i) => (
                          <Line key={y} type="monotone" dataKey={y} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
                        ))}
                      </LineChart>
                    ) : (
                      <BarChart data={r.data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey={r.visualization.x} tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {r.visualization.ys.map((y, i) => (
                          <Bar key={y} dataKey={y} fill={CHART_COLORS[i % CHART_COLORS.length]} isAnimationActive={false} />
                        ))}
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                      <tr>
                        {r.columns.map(c => (
                          <th key={c} className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {r.data.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          {r.columns.map(c => (
                            <td key={c} className="px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-xs truncate">
                              {row[c] === null || row[c] === undefined
                                ? <span className="text-gray-300 italic">null</span>
                                : String(row[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Collapsed result badge */}
      {r && !r.error && cell.collapsed && (
        <div
          onClick={onToggleCollapse}
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-t border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors"
        >
          <CheckCircle2 className="size-3 text-emerald-400" />
          <span className="text-xs text-gray-400">{r.row_count} rows — click to expand</span>
        </div>
      )}
    </div>
  );
}

// ── Markdown Cell ─────────────────────────────────────────────────────────────

function MarkdownCell({
  cell, onChange, onDelete, onMoveUp, onMoveDown, onDuplicate, onToggleView, isFirst, isLast,
}: {
  cell: Cell;
  onChange: (content: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onToggleView: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const isPreview = cell.viewMode === 'preview';
  return (
    <div className="group border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-100">
        <FileText className="size-3.5 text-amber-500 shrink-0" />
        <span className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Note</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onMoveUp} disabled={isFirst} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
          <button onClick={onMoveDown} disabled={isLast} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
          <button onClick={onDuplicate} title="Duplicate" className="p-1 text-gray-400 hover:text-gray-600"><Copy className="size-3.5" /></button>
          <button onClick={onToggleView} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-amber-600 hover:bg-amber-100 transition-colors">
            {isPreview ? <><Pencil className="size-3" />Edit</> : <><Eye className="size-3" />Preview</>}
          </button>
          <button onClick={onDelete} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="size-3.5" /></button>
        </div>
      </div>
      {isPreview ? (
        <div
          className="px-5 py-4 min-h-10 prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(cell.content || '*Empty — click Edit to add content*') }}
          onClick={onToggleView}
        />
      ) : (
        <textarea
          value={cell.content}
          onChange={e => onChange(e.target.value)}
          rows={Math.max(4, cell.content.split('\n').length + 2)}
          placeholder="# My analysis&#10;&#10;Explain what you're looking at here. Supports **bold**, *italic*, `code`, headers and lists."
          className="w-full px-4 py-3 text-sm text-gray-800 bg-white resize-none focus:outline-none leading-relaxed placeholder:text-gray-300 font-mono"
        />
      )}
    </div>
  );
}

// ── Add-cell bar ──────────────────────────────────────────────────────────────

function AddCellBar({ onAdd }: { onAdd: (type: CellType) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div className="relative flex items-center justify-center py-1 group/add" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className={`absolute inset-x-0 top-1/2 h-px transition-colors ${hover ? 'bg-blue-200' : 'bg-gray-100'}`} />
      {hover && (
        <div className="relative z-10 flex items-center gap-1 bg-white border border-gray-200 rounded-full px-2 py-1 shadow-sm">
          <button onClick={() => onAdd('sql')} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-colors">
            <Code2 className="size-3" /> SQL
          </button>
          <div className="w-px h-3 bg-gray-200" />
          <button onClick={() => onAdd('markdown')} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-amber-600 hover:bg-amber-50 transition-colors">
            <FileText className="size-3" /> Note
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function NotebookView({ apiKey: _apiKey }: { apiKey: string }) {
  const [notebooks, setNotebooks]       = useState<Notebook[]>([]);
  const [activeId, setActiveId]         = useState<number | null>(null);
  const [title, setTitle]               = useState('Untitled Notebook');
  const [cells, setCells]               = useState<Cell[]>([]);
  const [creating, setCreating]         = useState(false);
  const [newTitle, setNewTitle]         = useState('');
  const [saveStatus, setSaveStatus]     = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [loadingNb, setLoadingNb]       = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [nbSearch, setNbSearch]         = useState('');      // ← #6 search
  const [dashboards, setDashboards]     = useState<Dashboard[]>([]);
  const [pinCell, setPinCell]           = useState<Cell | null>(null); // ← #3 pin modal

  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCellsRef  = useRef(cells);
  activeCellsRef.current = cells;

  // Load dashboards for pin modal
  useEffect(() => {
    api.get<{ dashboards: Dashboard[] }>('/dashboards')
      .then(r => setDashboards(r.dashboards ?? []))
      .catch(() => {});
  }, []);

  // ── Notebook list ──────────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    try {
      const r = await api.get<{ notebooks: Notebook[] }>('/notebooks');
      setNotebooks(r.notebooks ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadList(); }, []);

  // ── Load a notebook ────────────────────────────────────────────────────────

  const openNotebook = useCallback(async (id: number) => {
    setLoadingNb(true);
    try {
      const nb = await api.get<Notebook>(`/notebooks/${id}`);
      setActiveId(nb.id);
      setTitle(nb.title);
      setCells((nb.cells || []).map((c: any) => ({
        ...c,
        result: null, running: false, showChart: false,
        viewMode: 'edit' as const, collapsed: false, aiPrompt: '', aiLoading: false,
      })));
      setSaveStatus('saved');
    } catch (e: any) {
      alert(e?.message ?? 'Failed to open notebook');
    } finally {
      setLoadingNb(false);
    }
  }, []);

  // ── Auto-save ──────────────────────────────────────────────────────────────

  const scheduleSave = useCallback(() => {
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!activeId) return;
      setSaveStatus('saving');
      try {
        const persistCells = activeCellsRef.current.map(({ id, type, content }) => ({ id, type, content }));
        await api.put(`/notebooks/${activeId}`, { cells: persistCells });
        setSaveStatus('saved');
      } catch {
        setSaveStatus('unsaved');
      }
    }, SAVE_DEBOUNCE_MS);
  }, [activeId]);

  const saveTitleNow = useCallback(async (newT: string) => {
    if (!activeId) return;
    setTitle(newT);
    setNotebooks(prev => prev.map(n => n.id === activeId ? { ...n, title: newT } : n));
    try { await api.put(`/notebooks/${activeId}`, { title: newT }); setSaveStatus('saved'); } catch { /* ignore */ }
  }, [activeId]);

  // ── Cell helpers ───────────────────────────────────────────────────────────

  const updateCell = useCallback((id: string, patch: Partial<Cell>) => {
    setCells(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }, []);

  const updateContent = useCallback((id: string, content: string) => {
    updateCell(id, { content });
    scheduleSave();
  }, [updateCell, scheduleSave]);

  const addCell = useCallback((type: CellType, afterId?: string) => {
    const newCell: Cell = { id: uid(), type, content: '', result: null, running: false, showChart: false, viewMode: 'edit', collapsed: false, aiPrompt: '', aiLoading: false };
    setCells(prev => {
      if (!afterId) return [...prev, newCell];
      const idx = prev.findIndex(c => c.id === afterId);
      const next = [...prev];
      next.splice(idx + 1, 0, newCell);
      return next;
    });
    scheduleSave();
  }, [scheduleSave]);

  const deleteCell = useCallback((id: string) => {
    setCells(prev => prev.filter(c => c.id !== id));
    scheduleSave();
  }, [scheduleSave]);

  // ── #5 Duplicate cell ──────────────────────────────────────────────────────

  const duplicateCell = useCallback((id: string) => {
    setCells(prev => {
      const idx = prev.findIndex(c => c.id === id);
      if (idx < 0) return prev;
      const src = prev[idx];
      const clone: Cell = { ...src, id: uid(), result: null, running: false, collapsed: false };
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
    scheduleSave();
  }, [scheduleSave]);

  const moveCell = useCallback((id: string, dir: -1 | 1) => {
    setCells(prev => {
      const idx = prev.findIndex(c => c.id === id);
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
    scheduleSave();
  }, [scheduleSave]);

  // ── #1 AI SQL generation ───────────────────────────────────────────────────

  const generateSql = useCallback(async (id: string) => {
    const cell = activeCellsRef.current.find(c => c.id === id);
    if (!cell?.aiPrompt?.trim()) return;
    updateCell(id, { aiLoading: true });
    try {
      const r = await api.post<{ sql: string }>('/notebooks/generate-sql', {
        prompt: cell.aiPrompt,
      });
      updateCell(id, { content: r.sql, aiLoading: false });
      scheduleSave();
    } catch (e: any) {
      updateCell(id, { aiLoading: false });
      alert(e?.message ?? 'AI generation failed');
    }
  }, [updateCell, scheduleSave]);

  const runCell = useCallback(async (id: string) => {
    const cell = activeCellsRef.current.find(c => c.id === id);
    if (!cell || cell.type !== 'sql') return;
    updateCell(id, { running: true, result: null, collapsed: false });
    try {
      const r = await api.post<CellResult>('/notebooks/run-cell', { sql: cell.content });
      const hasViz = !!r.visualization;
      updateCell(id, { running: false, result: r, showChart: hasViz, chartType: r.visualization?.type ?? 'bar' });
    } catch (e: any) {
      updateCell(id, { running: false, result: { columns: [], data: [], row_count: 0, error: e?.message ?? 'Query failed' } });
    }
  }, [updateCell]);

  // ── #3 Pin to dashboard ────────────────────────────────────────────────────

  const handlePin = useCallback(async (cell: Cell, dashId: number) => {
    if (!cell.result || cell.result.error) return;
    await api.post(`/dashboards/${dashId}/cards`, {
      title: cell.content.split('\n')[0].slice(0, 80) || 'Notebook result',
      query_text: cell.content,
      response_text: `${cell.result.row_count} rows`,
      visualization: cell.result.visualization ?? null,
      card_type: 'query',
    });
  }, []);

  const handleCellClick = useCallback((e: React.MouseEvent, cellId: string) => {
    const target = e.target as HTMLElement;
    const action = target.closest('[data-action]')?.getAttribute('data-action');
    const chartType = target.closest('[data-chart-type]')?.getAttribute('data-chart-type') as 'bar' | 'line' | null;
    if (action === 'show-table') updateCell(cellId, { showChart: false });
    if (action === 'show-chart') updateCell(cellId, { showChart: true });
    if (chartType) updateCell(cellId, { chartType });
  }, [updateCell]);

  // ── Create / delete notebook ───────────────────────────────────────────────

  const createNotebook = async () => {
    if (!newTitle.trim()) return;
    try {
      const nb = await api.post<Notebook>('/notebooks', {
        title: newTitle.trim(),
        cells: [{ id: uid(), type: 'sql', content: '' }],
      });
      setNotebooks(prev => [nb, ...prev]);
      setNewTitle(''); setCreating(false);
      openNotebook(nb.id);
    } catch (e: any) { alert(e?.message ?? 'Failed to create notebook'); }
  };

  const deleteNotebook = async (id: number) => {
    if (!confirm('Delete this notebook?')) return;
    try {
      await api.delete(`/notebooks/${id}`);
      setNotebooks(prev => prev.filter(n => n.id !== id));
      if (activeId === id) { setActiveId(null); setCells([]); }
    } catch { /* ignore */ }
  };

  const runAll = async () => {
    for (const cell of activeCellsRef.current) {
      if (cell.type === 'sql' && cell.content.trim()) await runCell(cell.id);
    }
  };

  // ── Filtered notebook list (#6) ────────────────────────────────────────────

  const filteredNotebooks = notebooks.filter(nb =>
    !nbSearch.trim() || nb.title.toLowerCase().includes(nbSearch.toLowerCase())
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* Pin modal */}
      {pinCell && (
        <PinModal
          cell={pinCell}
          dashboards={dashboards}
          onPin={(dashId) => handlePin(pinCell, dashId)}
          onClose={() => setPinCell(null)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="size-5 text-indigo-500" />
            <h2 className="font-semibold text-gray-900">Notebooks</h2>
          </div>
          <button onClick={() => setCreating(c => !c)} className="p-1.5 text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors" title="New notebook">
            <Plus className="size-4" />
          </button>
        </div>

        {/* #6 Search */}
        {notebooks.length > 3 && (
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-gray-400" />
              <input
                value={nbSearch}
                onChange={e => setNbSearch(e.target.value)}
                placeholder="Search notebooks…"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>
        )}

        {creating && (
          <div className="p-3 border-b border-gray-100 bg-indigo-50 space-y-2">
            <input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createNotebook(); if (e.key === 'Escape') setCreating(false); }}
              placeholder="Notebook name…"
              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <div className="flex gap-2">
              <button onClick={createNotebook} className="flex-1 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700">Create</button>
              <button onClick={() => setCreating(false)} className="px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-xs">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-2">
          {filteredNotebooks.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8 px-4">
              {nbSearch ? 'No matches' : 'No notebooks yet — create one with +'}
            </p>
          )}
          {filteredNotebooks.map(nb => (
            <div
              key={nb.id}
              className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                activeId === nb.id ? 'bg-indigo-50 border-r-2 border-indigo-500' : 'hover:bg-gray-50'
              }`}
              onClick={() => openNotebook(nb.id)}
            >
              <BookOpen className={`size-4 shrink-0 mt-0.5 ${activeId === nb.id ? 'text-indigo-500' : 'text-gray-400'}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${activeId === nb.id ? 'text-indigo-700 font-medium' : 'text-gray-700'}`}>{nb.title}</p>
                {/* #7 last modified */}
                <p className="text-[10px] text-gray-400 mt-0.5">{formatRelative(nb.updated_at)}</p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); deleteNotebook(nb.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-all shrink-0"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!activeId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="size-16 mx-auto rounded-2xl bg-indigo-50 flex items-center justify-center">
                <BookOpen className="size-8 text-indigo-300" />
              </div>
              <div>
                <h3 className="text-gray-500 font-medium">No notebook open</h3>
                <p className="text-sm text-gray-400 mt-1">Select one from the sidebar or create a new one</p>
              </div>
              <button onClick={() => setCreating(true)} className="flex items-center gap-2 mx-auto px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700">
                <Plus className="size-4" /> New Notebook
              </button>
            </div>
          </div>
        ) : loadingNb ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="size-8 animate-spin text-indigo-400" />
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-white">
              {editingTitle ? (
                <input
                  autoFocus
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onBlur={() => { setEditingTitle(false); saveTitleNow(title); }}
                  onKeyDown={e => { if (e.key === 'Enter') { setEditingTitle(false); saveTitleNow(title); } }}
                  className="font-bold text-gray-900 text-lg border-b-2 border-indigo-400 focus:outline-none bg-transparent flex-1 max-w-md"
                />
              ) : (
                <button onClick={() => setEditingTitle(true)} className="flex items-center gap-2 group/title">
                  <h1 className="font-bold text-gray-900 text-lg group-hover/title:text-indigo-600 transition-colors">{title}</h1>
                  <PenLine className="size-3.5 text-gray-300 group-hover/title:text-indigo-400 transition-colors" />
                </button>
              )}
              <div className="flex-1" />
              <div className="flex items-center gap-1.5 text-xs">
                {saveStatus === 'saving'  && <><Loader2 className="size-3 animate-spin text-gray-400" /><span className="text-gray-400">Saving…</span></>}
                {saveStatus === 'saved'   && <><Save className="size-3 text-emerald-400" /><span className="text-emerald-500">Saved</span></>}
                {saveStatus === 'unsaved' && <span className="text-amber-500">Unsaved</span>}
              </div>
              <button onClick={runAll} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                <Play className="size-3.5" /> Run All
              </button>
            </div>

            {/* Cells */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
              {cells.length === 0 && (
                <div className="text-center py-16 text-gray-400">
                  <p className="text-sm">Empty notebook — add a cell below</p>
                </div>
              )}

              <AddCellBar onAdd={(type) => {
                const newCell: Cell = { id: uid(), type, content: '', result: null, running: false, showChart: false, viewMode: 'edit', collapsed: false, aiPrompt: '', aiLoading: false };
                setCells(prev => [newCell, ...prev]);
                scheduleSave();
              }} />

              {cells.map((cell, idx) => (
                <div key={cell.id} onClick={e => handleCellClick(e, cell.id)}>
                  {cell.type === 'sql' ? (
                    <SqlCell
                      cell={cell}
                      onRun={() => runCell(cell.id)}
                      onChange={content => updateContent(cell.id, content)}
                      onDelete={() => deleteCell(cell.id)}
                      onMoveUp={() => moveCell(cell.id, -1)}
                      onMoveDown={() => moveCell(cell.id, 1)}
                      onDuplicate={() => duplicateCell(cell.id)}
                      onToggleCollapse={() => updateCell(cell.id, { collapsed: !cell.collapsed })}
                      onAiPromptChange={v => updateCell(cell.id, { aiPrompt: v })}
                      onGenerateSql={() => generateSql(cell.id)}
                      onExportCsv={() => { if (cell.result && !cell.result.error) exportCsv(cell.result.columns, cell.result.data); }}
                      onPinClick={() => setPinCell(cell)}
                      isFirst={idx === 0}
                      isLast={idx === cells.length - 1}
                    />
                  ) : (
                    <MarkdownCell
                      cell={cell}
                      onChange={content => updateContent(cell.id, content)}
                      onDelete={() => deleteCell(cell.id)}
                      onMoveUp={() => moveCell(cell.id, -1)}
                      onMoveDown={() => moveCell(cell.id, 1)}
                      onDuplicate={() => duplicateCell(cell.id)}
                      onToggleView={() => updateCell(cell.id, { viewMode: cell.viewMode === 'preview' ? 'edit' : 'preview' })}
                      isFirst={idx === 0}
                      isLast={idx === cells.length - 1}
                    />
                  )}
                  <AddCellBar onAdd={(type) => addCell(type, cell.id)} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
