import { useState } from 'react';
import { Sparkles, X, Plus, Loader2, AlertCircle, BarChart2, LineChart as LineChartIcon, Table2 } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '../../lib/api';

interface Dashboard { id: number; name: string }

interface AiChartBuilderModalProps {
  dashboards: Dashboard[];
  onClose: () => void;
  onCardAdded: (dashboardId: number) => void;
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

type ChartType = 'bar' | 'line' | 'table';

export function AiChartBuilderModal({ dashboards, onClose, onCardAdded }: AiChartBuilderModalProps) {
  const [prompt, setPrompt]           = useState('');
  const [tableHint, setTableHint]     = useState('');
  const [tables, setTables]           = useState<string[]>([]);
  const [tablesLoaded, setTablesLoaded] = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [result, setResult]           = useState<any>(null);
  const [error, setError]             = useState('');
  const [chartType, setChartType]     = useState<ChartType>('bar');
  const [selectedDash, setSelectedDash] = useState<number>(dashboards[0]?.id ?? 0);
  const [pinning, setPinning]         = useState(false);
  const [pinned, setPinned]           = useState(false);

  // Lazy-load tables when the hint dropdown is opened
  const loadTables = async () => {
    if (tablesLoaded) return;
    try {
      const r = await api.get<{ tables: string[] }>('/tables');
      setTables(r.tables ?? []);
      setTablesLoaded(true);
    } catch { setTablesLoaded(true); }
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError('');
    setResult(null);
    setPinned(false);
    try {
      const r = await api.post<any>('/analytics/ai-chart-builder', {
        prompt: prompt.trim(),
        table_hint: tableHint || undefined,
      });
      setResult(r);
      // Pick chart type from visualization hint
      const vizType = r.visualization?.type?.toLowerCase() ?? '';
      if (vizType.includes('line')) setChartType('line');
      else if (vizType.includes('table')) setChartType('table');
      else setChartType('bar');
    } catch (e: any) {
      setError(e?.message ?? 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const pinToBoard = async () => {
    if (!result || !selectedDash) return;
    setPinning(true);
    try {
      await api.post(`/dashboards/${selectedDash}/cards`, {
        title:         result.title,
        query_text:    prompt,
        response_text: result.response_text ?? '',
        sql_query:     result.sql_query ?? '',
        visualization: result.visualization ?? null,
        card_type:     'query',
        layout_w:      6,
        layout_h:      4,
      });
      setPinned(true);
      onCardAdded(selectedDash);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add card');
    } finally {
      setPinning(false);
    }
  };

  // Determine x and y keys from result data
  const dataKeys = result?.columns ?? [];
  const xKey = dataKeys[0] ?? 'x';
  const yKeys = dataKeys.slice(1).length ? dataKeys.slice(1) : [dataKeys[0]];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Sparkles className="size-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">AI Chart Builder</h2>
              <p className="text-xs text-gray-400">Describe a chart — AI writes the SQL and renders a preview</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <X className="size-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {/* Prompt */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">What do you want to see?</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
              placeholder="e.g. Monthly revenue trend for the last 12 months&#10;e.g. Top 10 products by total sales&#10;e.g. Daily active users over the past 30 days"
              rows={3}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>

          {/* Table hint + Generate */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Focus on table (optional)</label>
              <select
                value={tableHint}
                onFocus={loadTables}
                onChange={e => setTableHint(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              >
                <option value="">Any table</option>
                {tables.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={generate}
                disabled={!prompt.trim() || generating}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl font-semibold text-sm hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {generating
                  ? <><Loader2 className="size-4 animate-spin" /> Generating…</>
                  : <><Sparkles className="size-4" /> Generate</>}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-4">
              {/* SQL pill */}
              {result.sql_query && (
                <details className="group">
                  <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700 select-none">
                    View generated SQL ▾
                  </summary>
                  <pre className="mt-2 p-3 bg-gray-900 text-green-400 rounded-xl text-xs overflow-x-auto leading-relaxed">
                    {result.sql_query}
                  </pre>
                </details>
              )}

              {/* Chart type toggle */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500 mr-1">Preview as:</span>
                {([['bar', <BarChart2 className="size-3.5" />], ['line', <LineChartIcon className="size-3.5" />], ['table', <Table2 className="size-3.5" />]] as [ChartType, React.ReactNode][]).map(([t, icon]) => (
                  <button key={t} onClick={() => setChartType(t)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                      chartType === t ? 'bg-violet-100 text-violet-700 border border-violet-200' : 'text-gray-500 hover:bg-gray-100'
                    }`}>
                    {icon} {t}
                  </button>
                ))}
              </div>

              {/* Chart preview */}
              <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
                <p className="text-sm font-semibold text-gray-800 mb-3">{result.title}</p>
                {result.data?.length > 0 ? (
                  chartType === 'table' ? (
                    <div className="overflow-x-auto max-h-56">
                      <table className="w-full text-xs">
                        <thead className="bg-white border-b border-gray-200">
                          <tr>{dataKeys.map((k: string) => (
                            <th key={k} className="px-3 py-2 text-left font-semibold text-gray-600 uppercase">{k}</th>
                          ))}</tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {result.data.slice(0, 20).map((row: any, i: number) => (
                            <tr key={i} className="hover:bg-white">
                              {dataKeys.map((k: string) => (
                                <td key={k} className="px-3 py-1.5 text-gray-700">
                                  {row[k] === null || row[k] === undefined ? '—' : String(row[k])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      {chartType === 'line' ? (
                        <LineChart data={result.data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 12 }} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          {yKeys.map((k: string, i: number) => (
                            <Line key={k} type="monotone" dataKey={k}
                              stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2}
                              dot={false} isAnimationActive={false} />
                          ))}
                        </LineChart>
                      ) : (
                        <BarChart data={result.data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 12 }} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          {yKeys.map((k: string, i: number) => (
                            <Bar key={k} dataKey={k} fill={CHART_COLORS[i % CHART_COLORS.length]}
                              isAnimationActive={false} />
                          ))}
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  )
                ) : (
                  <p className="text-sm text-gray-400 text-center py-8">No data returned</p>
                )}
              </div>

              {/* Pin to dashboard */}
              {result.data?.length > 0 && dashboards.length > 0 && (
                <div className="flex items-center gap-3 p-4 bg-violet-50 border border-violet-100 rounded-xl">
                  <select value={selectedDash} onChange={e => setSelectedDash(+e.target.value)}
                    className="flex-1 px-3 py-2 border border-violet-200 rounded-lg text-sm bg-white">
                    {dashboards.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <button onClick={pinToBoard} disabled={pinning || pinned}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                      pinned
                        ? 'bg-green-100 text-green-700 border border-green-200'
                        : 'bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50'
                    }`}>
                    {pinning ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    {pinned ? '✓ Added!' : 'Add to dashboard'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
