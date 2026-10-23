/**
 * SaveTemplateModal — lightweight modal to save the current AI query as a template.
 *
 * Auto-detects {param} placeholders; user names the template and confirms.
 */
import { useState, useEffect } from 'react';
import { BookMarked, X, Check, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';

interface TemplateParam {
  name: string;
  label: string;
  type: string;
  default: string;
}

interface SaveTemplateModalProps {
  initialQuery: string;
  onClose: () => void;
}

export function SaveTemplateModal({ initialQuery, onClose }: SaveTemplateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [queryText, setQueryText] = useState(initialQuery);
  const [tags, setTags] = useState('');
  const [params, setParams] = useState<TemplateParam[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Detect params whenever query text changes
  useEffect(() => {
    const names = [...new Set(Array.from(queryText.matchAll(/\{(\w+)\}/g)).map(m => m[1]))];
    setParams(prev => names.map(n => {
      const existing = prev.find(p => p.name === n);
      return existing ?? { name: n, label: n.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), type: 'text', default: '' };
    }));
  }, [queryText]);

  // Auto-suggest name from query
  useEffect(() => {
    if (!name && initialQuery) {
      // Trim to ~50 chars, remove trailing punctuation
      const suggested = initialQuery.replace(/[?.!]+$/, '').slice(0, 60);
      setName(suggested);
    }
  }, []);

  const handleSave = async () => {
    if (!name.trim() || !queryText.trim()) return;
    setSaving(true);
    try {
      await api.post('/query-templates', {
        name: name.trim(),
        description: description.trim(),
        query_text: queryText.trim(),
        parameters: params,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      setSaved(true);
      setTimeout(onClose, 1200);
    } catch (e: any) {
      alert(e.message || 'Failed to save template');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <BookMarked className="size-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-gray-900">Save as Template</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
            <X className="size-4" />
          </button>
        </div>

        {saved ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="size-12 bg-green-100 rounded-full flex items-center justify-center">
              <Check className="size-6 text-green-600" />
            </div>
            <p className="font-semibold text-gray-800">Template saved!</p>
            <p className="text-sm text-gray-500">Find it in the Query Templates library.</p>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4">
              {/* Template name */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Template Name *</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Top customers by region"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  autoFocus
                />
              </div>

              {/* Query preview / edit */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Query</label>
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <Sparkles className="size-3" />
                    Add {'{param}'} for parameters
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={queryText}
                  onChange={e => setQueryText(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none font-mono"
                />
              </div>

              {/* Auto-detected params */}
              {params.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-700">Detected parameters</p>
                  {params.map((p, i) => (
                    <div key={p.name} className="flex items-center gap-2">
                      <span className="font-mono text-xs text-amber-700 w-24 shrink-0">{`{${p.name}}`}</span>
                      <input
                        value={p.label}
                        onChange={e => {
                          const updated = [...params]; updated[i] = { ...p, label: e.target.value };
                          setParams(updated);
                        }}
                        placeholder="Label"
                        className="flex-1 border border-amber-200 rounded px-2 py-1 text-xs bg-white outline-none"
                      />
                      <input
                        value={p.default}
                        onChange={e => {
                          const updated = [...params]; updated[i] = { ...p, default: e.target.value };
                          setParams(updated);
                        }}
                        placeholder="Default"
                        className="w-28 border border-amber-200 rounded px-2 py-1 text-xs bg-white outline-none"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Description + Tags */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</label>
                  <input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Optional"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Tags</label>
                  <input
                    value={tags}
                    onChange={e => setTags(e.target.value)}
                    placeholder="sales, monthly"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <button
                onClick={handleSave}
                disabled={saving || !name.trim() || !queryText.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                <BookMarked className="size-4" />
                {saving ? 'Saving…' : 'Save Template'}
              </button>
              <button onClick={onClose} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
