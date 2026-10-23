/**
 * QueryTemplatesLibrary — browse, search, create, and run saved query templates.
 *
 * Templates are NL queries that may contain {param} placeholders.
 * Before running the user fills in the parameter values; the filled query
 * is then submitted to the AI like any other question.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BookMarked, Plus, Search, X, Play, Edit2, Trash2,
  Tag, Clock, TrendingUp, ChevronDown, ChevronUp,
  Sparkles, Check, Copy, Info,
} from 'lucide-react';
import { api } from '../../lib/api';

interface TemplateParam {
  name: string;
  label: string;
  type: string;
  default: string;
}

interface QueryTemplate {
  id: number;
  name: string;
  description: string;
  query_text: string;
  parameters: TemplateParam[];
  tags: string[];
  use_count: number;
  created_at: string;
  updated_at: string;
}

interface QueryTemplatesLibraryProps {
  onRunQuery?: (query: string) => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string) {
  try {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 30) return `${d}d ago`;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
  } catch { return ''; }
}

function highlightParams(text: string) {
  const parts = text.split(/(\{[^}]+\})/g);
  return parts.map((p, i) =>
    p.startsWith('{') && p.endsWith('}')
      ? <mark key={i} className="bg-amber-100 text-amber-800 px-0.5 rounded font-mono text-xs">{p}</mark>
      : <span key={i}>{p}</span>
  );
}

// ── Run-template modal ────────────────────────────────────────────────────────

function RunModal({
  template,
  onRun,
  onClose,
}: {
  template: QueryTemplate;
  onRun: (query: string) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(template.parameters.map(p => [p.name, p.default]))
  );
  const [running, setRunning] = useState(false);

  const preview = template.parameters.reduce(
    (q, p) => q.replace(new RegExp(`\\{${p.name}\\}`, 'g'), values[p.name] || `{${p.name}}`),
    template.query_text
  );

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await api.post<{ query_text: string }>(`/query-templates/${template.id}/run`, {
        parameter_values: values,
      });
      onRun(res.query_text);
      onClose();
    } catch (e) { console.error(e); }
    setRunning(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Play className="size-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-900">{template.name}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {template.parameters.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Fill in parameters:</p>
              {template.parameters.map(p => (
                <div key={p.name}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    {p.label}
                  </label>
                  <input
                    type="text"
                    value={values[p.name] ?? ''}
                    onChange={e => setValues(v => ({ ...v, [p.name]: e.target.value }))}
                    placeholder={p.default || p.label}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No parameters — ready to run.</p>
          )}

          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Preview</p>
            <p className="text-sm text-gray-800 leading-relaxed">{highlightParams(preview)}</p>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={handleRun}
            disabled={running}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Play className="size-4" />
            {running ? 'Sending…' : 'Run Query'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm hover:bg-gray-50 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit / Create modal ───────────────────────────────────────────────────────

function EditModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: Partial<QueryTemplate>;
  onSave: (t: QueryTemplate) => void;
  onClose: () => void;
}) {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    query_text: initial?.query_text ?? '',
    tags: (initial?.tags ?? []).join(', '),
    parameters: initial?.parameters ?? [] as TemplateParam[],
  });
  const [saving, setSaving] = useState(false);
  const [paramsDirty, setParamsDirty] = useState(false);

  // Auto-detect parameters when query_text changes (unless user edited manually)
  useEffect(() => {
    if (paramsDirty) return;
    const detected = extractParams(form.query_text);
    // Merge: keep existing defaults, add new params, remove stale ones
    setForm(f => ({
      ...f,
      parameters: detected.map(d => {
        const existing = f.parameters.find(p => p.name === d.name);
        return existing ?? d;
      }),
    }));
  }, [form.query_text]);

  function extractParams(text: string): TemplateParam[] {
    const names = [...new Set(Array.from(text.matchAll(/\{(\w+)\}/g)).map(m => m[1]))];
    return names.map(n => ({ name: n, label: n.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), type: 'text', default: '' }));
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.query_text.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        query_text: form.query_text.trim(),
        parameters: form.parameters,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      };
      let result: QueryTemplate;
      if (isEdit) {
        const res = await api.put<{ template: QueryTemplate }>(`/query-templates/${initial!.id}`, payload);
        result = res.template;
      } else {
        const res = await api.post<{ template: QueryTemplate }>('/query-templates', payload);
        result = res.template;
      }
      onSave(result);
      onClose();
    } catch (e: any) { alert(e.message || 'Failed to save'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <BookMarked className="size-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-900">{isEdit ? 'Edit Template' : 'New Template'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X className="size-4" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Template Name *</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Top customers by region"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</label>
            <input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What does this query do?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Query *
              <span className="ml-2 text-amber-600 normal-case font-normal">Use {'{param}'} for parameters</span>
            </label>
            <textarea
              rows={3}
              value={form.query_text}
              onChange={e => setForm(f => ({ ...f, query_text: e.target.value }))}
              placeholder="Show me top 10 customers in {region} for {month}"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none font-mono"
            />
          </div>

          {form.parameters.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Detected Parameters
              </label>
              <div className="space-y-2">
                {form.parameters.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <span className="font-mono text-xs text-amber-700 w-24 shrink-0">{`{${p.name}}`}</span>
                    <input
                      value={p.label}
                      onChange={e => {
                        setParamsDirty(true);
                        const updated = [...form.parameters];
                        updated[i] = { ...p, label: e.target.value };
                        setForm(f => ({ ...f, parameters: updated }));
                      }}
                      placeholder="Label"
                      className="flex-1 border-0 bg-transparent text-sm outline-none text-gray-700"
                    />
                    <input
                      value={p.default}
                      onChange={e => {
                        setParamsDirty(true);
                        const updated = [...form.parameters];
                        updated[i] = { ...p, default: e.target.value };
                        setForm(f => ({ ...f, parameters: updated }));
                      }}
                      placeholder="Default value"
                      className="w-28 border border-amber-200 rounded px-2 py-0.5 text-xs bg-white outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Tags</label>
            <input
              value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              placeholder="sales, monthly, customers (comma-separated)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim() || !form.query_text.trim()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Check className="size-4" />
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Template'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm hover:bg-gray-50 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main library page ─────────────────────────────────────────────────────────

export function QueryTemplatesLibrary({ onRunQuery }: QueryTemplatesLibraryProps) {
  const [templates, setTemplates] = useState<QueryTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [runModal, setRunModal] = useState<QueryTemplate | null>(null);
  const [editModal, setEditModal] = useState<Partial<QueryTemplate> | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q = '', tag?: string | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('search', q);
      if (tag) params.set('tag', tag);
      const res = await api.get<{ templates: QueryTemplate[] }>(`/query-templates?${params}`);
      setTemplates(res.templates || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(val, activeTag), 300);
  };

  const handleTagFilter = (tag: string) => {
    const next = activeTag === tag ? null : tag;
    setActiveTag(next);
    load(search, next);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this template?')) return;
    try {
      await api.delete(`/query-templates/${id}`);
      setTemplates(ts => ts.filter(t => t.id !== id));
    } catch (e) { console.error(e); }
  };

  const handleCopy = (id: number, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  // Collect all unique tags across loaded templates
  const allTags = [...new Set(templates.flatMap(t => t.tags))].sort();

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <BookMarked className="size-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Query Templates</h1>
          </div>
          <p className="text-sm text-gray-500">Saved queries with reusable parameters. One click to run.</p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="size-4" />
          New Template
        </button>
      </div>

      {/* Search + tag filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search templates…"
            className="w-full pl-9 pr-8 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          {search && (
            <button onClick={() => handleSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="size-4" />
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => handleTagFilter(tag)}
                className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  activeTag === tag
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600'
                }`}
              >
                <Tag className="size-3" />
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && templates.length === 0 && (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      )}

      {/* Empty state */}
      {!loading && templates.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <BookMarked className="size-14 mx-auto mb-4 opacity-20" />
          <p className="font-semibold text-gray-500 mb-1">
            {search ? 'No templates match your search.' : 'No templates yet.'}
          </p>
          {!search && (
            <p className="text-sm">
              Create your first template, or save any query from the AI Query view.
            </p>
          )}
          {!search && (
            <button
              onClick={() => setShowNewModal(true)}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl mx-auto hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              <Plus className="size-4" /> Create Template
            </button>
          )}
        </div>
      )}

      {/* Template cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {templates.map(template => (
          <div key={template.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col">
            {/* Card header */}
            <div className="px-5 pt-5 pb-4 flex-1">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-semibold text-gray-900 leading-snug">{template.name}</h3>
                {template.use_count > 0 && (
                  <span className="flex items-center gap-1 text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full shrink-0">
                    <TrendingUp className="size-3" />
                    {template.use_count}×
                  </span>
                )}
              </div>

              {template.description && (
                <p className="text-sm text-gray-500 mb-3">{template.description}</p>
              )}

              <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100 text-sm text-gray-700 leading-relaxed font-mono">
                {highlightParams(template.query_text)}
              </div>

              {template.parameters.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {template.parameters.map(p => (
                    <span key={p.name} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                      {p.label}
                    </span>
                  ))}
                </div>
              )}

              {template.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {template.tags.map(tag => (
                    <span key={tag} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Card footer */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Clock className="size-3" />
                {relTime(template.updated_at)}
              </span>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleCopy(template.id, template.query_text)}
                  title="Copy query"
                  className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {copied === template.id ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
                </button>
                <button
                  onClick={() => setEditModal(template)}
                  title="Edit"
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  <Edit2 className="size-4" />
                </button>
                <button
                  onClick={() => handleDelete(template.id)}
                  title="Delete"
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="size-4" />
                </button>
                <button
                  onClick={() => {
                    if (template.parameters.length === 0 && onRunQuery) {
                      // No params — run immediately
                      api.post<{ query_text: string }>(`/query-templates/${template.id}/run`, { parameter_values: {} })
                        .then(res => onRunQuery(res.query_text))
                        .catch(console.error);
                    } else {
                      setRunModal(template);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors ml-1"
                >
                  <Play className="size-3.5" />
                  Run
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modals */}
      {runModal && (
        <RunModal
          template={runModal}
          onRun={q => onRunQuery?.(q)}
          onClose={() => setRunModal(null)}
        />
      )}

      {(showNewModal || editModal) && (
        <EditModal
          initial={editModal ?? undefined}
          onSave={saved => {
            setTemplates(ts => {
              const idx = ts.findIndex(t => t.id === saved.id);
              if (idx >= 0) { const n = [...ts]; n[idx] = saved; return n; }
              return [saved, ...ts];
            });
          }}
          onClose={() => { setShowNewModal(false); setEditModal(null); }}
        />
      )}
    </div>
  );
}
