/**
 * QueryHistoryBrowser — paginated, searchable view of past queries.
 *
 * Uses GET /analytics/history?page=&per_page=&search=&saved_only=
 * Lets users re-run any past query, view its response, or filter to bookmarks.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  History, Search, X, ChevronLeft, ChevronRight,
  Bookmark, BookmarkCheck, RefreshCw, Clock,
  BarChart2, Code2, ChevronDown, ChevronUp, BookMarked,
} from 'lucide-react';
import { api } from '../../lib/api';
import { ChartDisplay } from './ChartDisplay';
import { SaveTemplateModal } from './SaveTemplateModal';

interface HistoryEntry {
  id: number;
  query: string;
  response: string;
  visualization?: any;
  sql_query?: string;
  created_at: string;
  is_saved: boolean;
  saved_title?: string;
}

interface HistoryPage {
  total: number;
  page: number;
  per_page: number;
  pages: number;
  history: HistoryEntry[];
}

interface QueryHistoryBrowserProps {
  apiKey?: string;
  onRerun?: (query: string) => void;
  onRerunQuery?: (query: string) => void;  // alias used in App.tsx
}

function relTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
  } catch { return ''; }
}

export function QueryHistoryBrowser({ onRerun, onRerunQuery }: QueryHistoryBrowserProps) {
  const rerun = onRerun || onRerunQuery;
  const [data, setData] = useState<HistoryPage | null>(null);
  const [saveTemplateQuery, setSaveTemplateQuery] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (p: number, q: string, so: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        per_page: '20',
        ...(q ? { search: q } : {}),
        ...(so ? { saved_only: 'true' } : {}),
      });
      const res = await api.get<HistoryPage>(`/analytics/history?${params}`);
      setData(res);
    } catch (err) {
      console.error('Failed to load history', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1, '', false); }, [load]);

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(1, val, savedOnly), 350);
  };

  const handleSavedOnly = (val: boolean) => {
    setSavedOnly(val);
    setPage(1);
    load(1, search, val);
  };

  const goPage = (p: number) => {
    setPage(p);
    load(p, search, savedOnly);
    setExpanded(null);
  };

  const handleRerun = (q: string) => {
    if (rerun) rerun(q);
  };

  return (
    <>
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <History className="size-6 text-blue-600" />
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Query History</h1>
        </div>
        <p className="text-sm text-gray-500">Browse, search and re-run your past analytics queries.</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search past queries…"
            className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          {search && (
            <button onClick={() => handleSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="size-4" />
            </button>
          )}
        </div>

        <button
          onClick={() => handleSavedOnly(!savedOnly)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
            savedOnly
              ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          {savedOnly ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
          Saved only
        </button>

        <button
          onClick={() => load(page, search, savedOnly)}
          disabled={loading}
          className="p-2 text-gray-500 hover:text-blue-600 transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`size-5 ${loading ? 'animate-spin' : ''}`} />
        </button>

        {data && (
          <span className="text-xs text-gray-400 ml-auto">
            {data.total.toLocaleString()} result{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* List */}
      {loading && !data && (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      )}

      {data && data.history.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <History className="size-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{search ? 'No queries match your search.' : 'No query history yet.'}</p>
        </div>
      )}

      {data && data.history.length > 0 && (
        <div className="space-y-3">
          {data.history.map(item => (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
            >
              {/* Row header */}
              <div className="flex items-start gap-3 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.query}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock className="size-3" />
                      {relTime(item.created_at)}
                    </span>
                    {item.is_saved && (
                      <span className="flex items-center gap-1 text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">
                        <BookmarkCheck className="size-3" />
                        {item.saved_title || 'Saved'}
                      </span>
                    )}
                    {item.visualization && (
                      <span className="flex items-center gap-1 text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                        <BarChart2 className="size-3" />
                        chart
                      </span>
                    )}
                    {item.sql_query && (
                      <span className="flex items-center gap-1 text-xs text-purple-500 bg-purple-50 px-2 py-0.5 rounded-full">
                        <Code2 className="size-3" />
                        SQL
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {rerun && (
                    <button
                      onClick={() => handleRerun(item.query)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      <RefreshCw className="size-3.5" />
                      Re-run
                    </button>
                  )}
                  <button
                    onClick={() => setSaveTemplateQuery(item.query)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
                    title="Save as Template"
                  >
                    <BookMarked className="size-3.5" />
                    Template
                  </button>
                  <button
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                    className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                    title={expanded === item.id ? 'Collapse' : 'Expand'}
                  >
                    {expanded === item.id ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {expanded === item.id && (
                <div className="border-t border-gray-100 px-5 py-4 space-y-4 bg-gray-50/50">
                  {/* Chart */}
                  {item.visualization && (
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                      <ChartDisplay visualization={item.visualization} />
                    </div>
                  )}

                  {/* Response text */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Response</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed line-clamp-6">
                      {item.response}
                    </p>
                  </div>

                  {/* SQL */}
                  {item.sql_query && (
                    <details className="group">
                      <summary className="text-xs font-semibold uppercase tracking-wide text-gray-400 cursor-pointer select-none hover:text-gray-600 flex items-center gap-1">
                        <Code2 className="size-3.5" /> SQL used
                      </summary>
                      <pre className="mt-2 text-xs bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                        {item.sql_query}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => goPage(page - 1)}
            disabled={page <= 1}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>

          {Array.from({ length: Math.min(data.pages, 7) }, (_, i) => {
            // Show pages around current, always show 1 and last
            const p = data.pages <= 7
              ? i + 1
              : i === 0 ? 1
              : i === 6 ? data.pages
              : Math.max(2, Math.min(page - 2, data.pages - 5)) + i;
            return (
              <button
                key={p}
                onClick={() => goPage(p)}
                className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                  p === page
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {p}
              </button>
            );
          })}

          <button
            onClick={() => goPage(page + 1)}
            disabled={page >= data.pages}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>

    {/* Save as Template modal */}
    {saveTemplateQuery && (
      <SaveTemplateModal
        initialQuery={saveTemplateQuery}
        onClose={() => setSaveTemplateQuery(null)}
      />
    )}
    </>
  );
}
