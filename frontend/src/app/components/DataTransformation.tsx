import { useState, useEffect } from 'react';
import { Wrench, Plus, Play, Eye, AlertCircle, CheckCircle, Trash2, ArrowRightLeft } from 'lucide-react';
import { api } from '../../lib/api';

interface DataTransformationProps {
  apiKey?: string;
}

interface Operation {
  id: string;
  type: string;
  params: Record<string, any>;
}

/** Map frontend operation objects to the shape the backend DataTransformer expects. */
function mapOpForBackend(op: Operation): Record<string, any> {
  const p = op.params;
  switch (op.type) {
    case 'drop_duplicates':
      return { type: 'clean', method: 'drop_duplicates', subset: p.subset || undefined };
    case 'clean_text':
      return { type: 'clean', method: 'clean_text', column: p.column, clean_type: p.operation || 'lower' };
    case 'remove_outliers':
      return { type: 'clean', method: 'remove_outliers', column: p.column, outlier_method: 'z-score', threshold: p.threshold ?? 3 };
    case 'filter':
      return { type: 'filter', column: p.column, op: p.operator || '>', value: p.value };
    case 'rename_col':
      return { type: 'rename_col', column: p.column, new_name: p.new_name };
    case 'drop_col':
      return { type: 'drop_col', column: p.column };
    case 'change_type':
      return { type: 'change_type', column: p.column, new_type: p.new_type || 'str' };
    case 'fill_na':
      return { type: 'fill_na', column: p.column, method: p.method || 'mean', value: p.value };
    case 'normalize':
      return { type: 'normalize', columns: p.columns || [], method: p.method || 'minmax' };
    case 'encode':
      return { type: 'encode', column: p.column, method: p.method || 'onehot' };
    case 'feature_engineering':
      return { type: 'feature_engineering', feature_type: p.feat_type || 'interaction', ...p };
    case 'text_feature':
      return { type: 'text_feature', column: p.column, method: p.feature || 'len' };
    case 'groupby':
      return {
        type: 'aggregate', method: 'groupby',
        group_cols: (p.group_cols || '').split(',').map((c: string) => c.trim()).filter(Boolean),
        aggregations: (() => { try { return JSON.parse(p.aggregations || '{}'); } catch { return {}; } })(),
      };
    case 'resample':
      return {
        type: 'aggregate', method: 'resample',
        date_col: p.time_column,
        freq: p.frequency || 'D',
        aggregations: (() => { try { return JSON.parse(p.agg_json || '{}'); } catch { return {}; } })(),
      };
    default:
      return { type: op.type, ...p };
  }
}

export function DataTransformation({ }: DataTransformationProps) {
  const [selectedTable, setSelectedTable] = useState('');
  const [operations, setOperations] = useState<Operation[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewBefore, setPreviewBefore] = useState<any[]>([]);
  const [previewAfter, setPreviewAfter] = useState<any[]>([]);
  const [previewTab, setPreviewTab] = useState<'before' | 'after'>('after');
  const [isProcessing, setIsProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [missingSummary, setMissingSummary] = useState<Array<{column: string; missing: number; pct: number; suggested: string}>>([]);

  useEffect(() => { fetchTables(); }, []);

  const fetchTables = async () => {
    try {
      const resp = await api.get<{ tables: string[] }>('/tables');
      if (resp.tables) {
        setTables(resp.tables);
        if (resp.tables.length > 0) setSelectedTable(resp.tables[0]);
      }
    } catch (err) {
      console.error('Failed to fetch tables:', err);
    }
  };

  useEffect(() => {
    const fetchColumns = async () => {
      if (!selectedTable) return;
      try {
        const data = await api.get<any>(`/tables/${selectedTable}/preview?limit=1`);
        if (data?.columns) setColumns(data.columns.map((c: any) => c.name));
      } catch (err) {
        console.error('Failed to fetch columns:', err);
      }
    };
    fetchColumns();
  }, [selectedTable]);

  useEffect(() => {
    const fetchMissingSummary = async () => {
      if (!selectedTable) return;
      try {
        const data = await api.get<any>(`/tables/${selectedTable}/preview?limit=500`);
        if (data?.rows && data?.columns) {
          const colNames: string[] = data.columns.map((c: any) => c.name);
          const rows: any[] = data.rows;
          const total = rows.length;
          if (total === 0) return;
          const summary = colNames.map(col => {
            const missing = rows.filter((r: any) => r[col] === null || r[col] === '' || r[col] === undefined).length;
            const pct = Math.round((missing / total) * 100);
            const colType = (data.columns.find((c: any) => c.name === col)?.type || '').toLowerCase();
            const isNumeric = ['int','float','number','numeric','bigint','double','decimal'].some(t => colType.includes(t));
            return { column: col, missing, pct, suggested: isNumeric ? 'mean' : 'mode' };
          }).filter(s => s.missing > 0);
          setMissingSummary(summary);
        }
      } catch { /* silently ignore */ }
    };
    fetchMissingSummary();
  }, [selectedTable]);

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

  const addOperation = (type: string) => {
    setOperations([...operations, { id: Math.random().toString(36).substr(2, 9), type, params: getDefaultParams(type) }]);
  };

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

  const removeOperation = (id: string) => setOperations(operations.filter(op => op.id !== id));

  const updateParam = (id: string, param: string, value: any) =>
    setOperations(operations.map(op => op.id === id ? { ...op, params: { ...op.params, [param]: value } } : op));

  // ── Preview: run pipeline on 50-row sample, show before/after ──
  const handlePreview = async () => {
    if (!selectedTable) return;
    setIsProcessing(true);
    setError(null);
    try {
      if (operations.length === 0) {
        // No ops — just show raw table
        const data = await api.get<any>(`/tables/${selectedTable}/preview?limit=10`);
        const rows = data?.rows ?? data ?? [];
        setPreviewBefore(rows);
        setPreviewAfter(rows);
        setPreviewTab('before');
        setShowPreview(true);
        return;
      }
      const payload = {
        table_name: selectedTable,
        operations: operations.map(mapOpForBackend),
      };
      const result = await api.post<any>('/transform/preview', payload);
      setPreviewBefore(result.before ?? []);
      setPreviewAfter(result.after ?? []);
      setPreviewTab('after');
      setShowPreview(true);
    } catch (err: any) {
      setError(`Preview failed: ${err.message ?? 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Apply: run pipeline and save to transformed_{table} ──
  const handleApply = async () => {
    if (!selectedTable || operations.length === 0) return;
    setIsProcessing(true);
    setError(null);
    setSuccess(false);
    try {
      const payload = {
        table_name: selectedTable,
        operations: operations.map(mapOpForBackend),
      };
      const response = await api.post<any>('/transform', payload);
      setSuccess(true);
      if (response?.target_table && !tables.includes(response.target_table)) {
        setTables([...tables, response.target_table]);
      }
      if (response?.preview) {
        setPreviewAfter(response.preview);
        setPreviewBefore([]);
        setPreviewTab('after');
        setShowPreview(true);
      }
      // Pipeline is intentionally NOT cleared — user can run again on new data
    } catch (err: any) {
      setError(`Transformation failed: ${err.message ?? 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateAI = async () => {
    if (!aiPrompt.trim() || !selectedTable) return;
    setIsGenerating(true);
    setError(null);
    try {
      const response = await api.post<{ status: string; operations: any[] }>('/transform/suggest', {
        table_name: selectedTable,
        prompt: aiPrompt,
      });
      if (response?.operations) {
        const newOps = response.operations.map((op: any) => {
          // Backend returns canonical type names — reverse-map clean sub-types for the UI
          let type = op.type;
          if (type === 'clean') {
            type = op.method === 'remove_outliers' ? 'remove_outliers'
                 : op.method === 'clean_text' ? 'clean_text'
                 : 'drop_duplicates';
          }
          if (type === 'aggregate') {
            type = op.method === 'resample' ? 'resample' : 'groupby';
          }
          return { id: Math.random().toString(36).substr(2, 9), type, params: { ...op, friendly_description: op.friendly_description } };
        });
        setOperations([...operations, ...newOps]);
        setAiPrompt('');
      }
    } catch (err: any) {
      setError(`AI generation failed: ${err.message ?? 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Per-operation forms ──
  const renderOperationForm = (op: Operation) => {
    const sel = (paramName: string, placeholder = 'Select column') => (
      <select
        value={op.params[paramName] || ''}
        onChange={(e) => updateParam(op.id, paramName, e.target.value)}
        className="px-3 py-2 border border-blue-200 bg-blue-50 rounded text-sm text-blue-900"
      >
        <option value="" disabled>{placeholder}</option>
        {columns.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    );

    switch (op.type) {
      case 'clean_text':
        return (
          <div className="grid grid-cols-2 gap-3">
            {sel('column')}
            <select value={op.params.operation || 'lower'} onChange={e => updateParam(op.id, 'operation', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="lower">Lowercase</option>
              <option value="upper">Uppercase</option>
              <option value="trim">Trim whitespace</option>
              <option value="title">Title Case</option>
              <option value="remove_special">Remove special chars</option>
            </select>
          </div>
        );

      case 'filter':
        return (
          <div className="grid grid-cols-3 gap-3">
            {sel('column')}
            <select value={op.params.operator || '>'} onChange={e => updateParam(op.id, 'operator', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value=">">{'>'} greater than</option>
              <option value="<">{'<'} less than</option>
              <option value="==">== equals</option>
              <option value="!=">!= not equal</option>
              <option value=">=">{'>='} ≥</option>
              <option value="<=">{'<='} ≤</option>
            </select>
            <input type="text" placeholder="Value" value={op.params.value || ''}
              onChange={e => updateParam(op.id, 'value', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm" />
          </div>
        );

      case 'rename_col':
        return (
          <div className="grid grid-cols-2 gap-3">
            {sel('column', 'Old column')}
            <input type="text" placeholder="New name" value={op.params.new_name || ''}
              onChange={e => updateParam(op.id, 'new_name', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm" />
          </div>
        );

      case 'drop_col':
        return <div className="grid grid-cols-1 gap-3">{sel('column')}</div>;

      case 'change_type':
        return (
          <div className="grid grid-cols-2 gap-3">
            {sel('column')}
            <select value={op.params.new_type || 'str'} onChange={e => updateParam(op.id, 'new_type', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="int">Integer</option>
              <option value="float">Float</option>
              <option value="str">String</option>
              <option value="datetime">Date/Time</option>
              <option value="bool">Boolean</option>
            </select>
          </div>
        );

      case 'fill_na':
        return (
          <div className="space-y-3">
            {missingSummary.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-amber-800 mb-2">📊 Missing Values in Table</p>
                <div className="overflow-auto max-h-36">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-amber-700 border-b border-amber-200">
                        <th className="text-left py-1 pr-3">Column</th>
                        <th className="text-right py-1 pr-3">Missing</th>
                        <th className="text-right py-1 pr-3">%</th>
                        <th className="text-left py-1 pr-3">Suggested</th>
                        <th className="text-left py-1">Use</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missingSummary.map(s => (
                        <tr key={s.column} className="border-b border-amber-100">
                          <td className="py-1 pr-3 font-mono text-gray-700">{s.column}</td>
                          <td className="py-1 pr-3 text-right text-gray-600">{s.missing}</td>
                          <td className={`py-1 pr-3 text-right font-semibold ${s.pct > 20 ? 'text-red-600' : 'text-amber-700'}`}>{s.pct}%</td>
                          <td className="py-1 pr-3"><span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">{s.suggested}</span></td>
                          <td className="py-1">
                            <button onClick={() => { updateParam(op.id, 'column', s.column); updateParam(op.id, 'method', s.suggested); }}
                              className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 text-xs">Use</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              {sel('column')}
              <select value={op.params.method || 'mean'} onChange={e => updateParam(op.id, 'method', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded text-sm">
                <option value="mean">Mean</option>
                <option value="median">Median</option>
                <option value="mode">Mode</option>
                <option value="value">Fixed value</option>
              </select>
              <input type="text" placeholder="Value (if fixed)" value={op.params.value || ''}
                onChange={e => updateParam(op.id, 'value', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded text-sm" />
            </div>
          </div>
        );

      case 'drop_duplicates':
        return <div className="grid grid-cols-1 gap-3">{sel('subset', 'Check column (optional — blank = all)')}</div>;

      case 'remove_outliers':
        return (
          <div className="grid grid-cols-2 gap-3">
            {sel('column')}
            <input type="number" step="0.1" placeholder="Z-score threshold (default 3)" value={op.params.threshold ?? 3}
              onChange={e => updateParam(op.id, 'threshold', parseFloat(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded text-sm" />
          </div>
        );

      case 'normalize':
        return (
          <div className="grid grid-cols-2 gap-3">
            <input type="text" placeholder="Columns (comma-separated)"
              value={Array.isArray(op.params.columns) ? op.params.columns.join(', ') : op.params.columns || ''}
              onChange={e => updateParam(op.id, 'columns', e.target.value.split(',').map((c: string) => c.trim()).filter(Boolean))}
              className="px-3 py-2 border border-gray-300 rounded text-sm" />
            <select value={op.params.method || 'minmax'} onChange={e => updateParam(op.id, 'method', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="minmax">Min-Max (0–1)</option>
              <option value="zscore">Z-Score (std)</option>
              <option value="log">Log transform</option>
            </select>
          </div>
        );

      case 'encode':
        return (
          <div className="grid grid-cols-2 gap-3">
            {sel('column')}
            <select value={op.params.method || 'onehot'} onChange={e => updateParam(op.id, 'method', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="onehot">One-Hot Encoding</option>
              <option value="label">Label Encoding (integers)</option>
              <option value="binary">Binary (Yes/No → 1/0)</option>
            </select>
          </div>
        );

      case 'text_feature':
        return (
          <div className="grid grid-cols-2 gap-3">
            {sel('column')}
            <select value={op.params.feature || 'len'} onChange={e => updateParam(op.id, 'feature', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="len">Character length</option>
              <option value="word_count">Word count</option>
              <option value="tfidf">TF-IDF features</option>
            </select>
          </div>
        );

      case 'feature_engineering': {
        const ft = op.params.feat_type || 'interaction';
        return (
          <div className="space-y-3">
            <select value={ft} onChange={e => updateParam(op.id, 'feat_type', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="interaction">Column interaction (multiply/add/etc.)</option>
              <option value="time_component">Extract time component</option>
            </select>
            {ft === 'interaction' && (
              <div className="grid grid-cols-3 gap-3">
                {sel('column1', 'Column A')}
                <select value={op.params.operation || '*'} onChange={e => updateParam(op.id, 'operation', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded text-sm">
                  <option value="*">× Multiply</option>
                  <option value="/">÷ Divide</option>
                  <option value="+">+ Add</option>
                  <option value="-">− Subtract</option>
                </select>
                {sel('column2', 'Column B')}
              </div>
            )}
            {ft === 'time_component' && (
              <div className="grid grid-cols-2 gap-3">
                {sel('column', 'Date column')}
                <select value={op.params.component || 'year'} onChange={e => updateParam(op.id, 'component', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded text-sm">
                  <option value="year">Year</option>
                  <option value="month">Month</option>
                  <option value="day">Day</option>
                  <option value="dow">Day of week</option>
                  <option value="quarter">Quarter</option>
                </select>
              </div>
            )}
          </div>
        );
      }

      case 'groupby':
        return (
          <div className="space-y-3">
            <input type="text" placeholder="Group by columns (comma-separated, e.g. region, category)"
              value={op.params.group_cols || ''}
              onChange={e => updateParam(op.id, 'group_cols', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
            <input type="text" placeholder={'Aggregations JSON, e.g. {"revenue": ["sum","mean"]}'}
              value={op.params.aggregations || '{}'}
              onChange={e => updateParam(op.id, 'aggregations', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono" />
          </div>
        );

      case 'resample':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {sel('time_column', 'Date/Time column')}
              <select value={op.params.frequency || 'D'} onChange={e => updateParam(op.id, 'frequency', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded text-sm">
                <option value="D">Daily</option>
                <option value="W">Weekly</option>
                <option value="ME">Monthly</option>
                <option value="QE">Quarterly</option>
                <option value="YE">Yearly</option>
              </select>
            </div>
            <input type="text" placeholder={'Aggregations JSON, e.g. {"revenue": "sum"}'}
              value={op.params.agg_json || '{}'}
              onChange={e => updateParam(op.id, 'agg_json', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono" />
          </div>
        );

      default:
        return (
          <textarea
            placeholder="Configuration (JSON)"
            value={JSON.stringify(op.params, null, 2)}
            onChange={e => {
              try { const parsed = JSON.parse(e.target.value); setOperations(operations.map(o => o.id === op.id ? { ...o, params: parsed } : o)); } catch { }
            }}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
          />
        );
    }
  };

  const categories = [...new Set(operationTypes.map(op => op.category))];
  const previewData = previewTab === 'before' ? previewBefore : previewAfter;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Wrench className="size-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Data Prep</h1>
        </div>
        <p className="text-gray-600">Prepare and refine your data with AI-powered suggestions and live pipeline preview.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* Error banner */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="size-5 text-red-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-red-800">{error}</p>
              </div>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
            </div>
          )}

          {/* Success banner */}
          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle className="size-5 text-green-600" />
              <div className="flex-1">
                <p className="font-medium text-green-900">Transformations applied!</p>
                <p className="text-sm text-green-700">Saved to <code className="font-mono">transformed_{selectedTable}</code></p>
              </div>
              <button onClick={() => { setSuccess(false); setOperations([]); }}
                className="text-xs px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200">Clear pipeline</button>
            </div>
          )}

          {/* Table Selection */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Source Table</label>
            <select value={selectedTable} onChange={e => setSelectedTable(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
              {tables.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* AI Wizard */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100 p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-600 rounded-lg shrink-0">
                <Wrench className="size-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-blue-900 mb-1">AI Data Prep Wizard</h3>
                <p className="text-blue-800 text-sm mb-4">Describe what you want — the AI will configure the operations for you.</p>
                <div className="flex gap-3">
                  <input type="text" value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                    placeholder="e.g. Remove empty rows, lowercase the email column, drop zip_code"
                    className="flex-1 px-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onKeyDown={e => { if (e.key === 'Enter') handleGenerateAI(); }} />
                  <button onClick={handleGenerateAI} disabled={isGenerating || !aiPrompt.trim()}
                    className="whitespace-nowrap px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {isGenerating ? 'Generating…' : 'Generate with AI'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Pipeline */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Data Prep Pipeline</h2>
                <p className="text-sm text-gray-600 mt-1">{operations.length} operation{operations.length !== 1 ? 's' : ''} configured</p>
              </div>
              {operations.length > 0 && (
                <button onClick={() => setOperations([])}
                  className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 px-3 py-1.5 rounded hover:bg-red-50">
                  <Trash2 className="size-4" /> Clear all
                </button>
              )}
            </div>

            <div className="p-6 space-y-4">
              {operations.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Wrench className="size-12 mx-auto mb-3 text-gray-300" />
                  <p>No operations added yet.</p>
                  <p className="text-sm">Add from the panel on the right, or use the AI wizard above.</p>
                </div>
              ) : (
                operations.map((op, index) => (
                  <div key={op.id} className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-300 transition-colors">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold">#{index + 1}</span>
                        <h3 className="font-bold text-gray-900">
                          {op.params.friendly_description || operationTypes.find(t => t.value === op.type)?.label || op.type}
                        </h3>
                      </div>
                      <button onClick={() => removeOperation(op.id)}
                        className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded transition-colors text-lg leading-none">×</button>
                    </div>
                    {renderOperationForm(op)}
                  </div>
                ))
              )}
            </div>

            {operations.length > 0 && (
              <div className="p-6 border-t border-gray-200 flex gap-3">
                <button onClick={handlePreview} disabled={isProcessing}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 disabled:opacity-50 transition-colors font-medium">
                  <Eye className="size-5" />
                  {isProcessing ? 'Loading…' : 'Preview pipeline (50 rows)'}
                </button>
                <button onClick={handleApply} disabled={isProcessing}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
                  <Play className="size-5" />
                  {isProcessing ? 'Running…' : 'Run & Save'}
                </button>
              </div>
            )}
          </div>

          {/* Before / After Preview */}
          {showPreview && (previewBefore.length > 0 || previewAfter.length > 0) && (
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="size-5 text-blue-600" />
                  <h2 className="text-lg font-bold text-gray-900">Pipeline Preview</h2>
                </div>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                  <button onClick={() => setPreviewTab('before')}
                    className={`px-4 py-1.5 font-medium transition-colors ${previewTab === 'before' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    Before ({previewBefore.length} rows)
                  </button>
                  <button onClick={() => setPreviewTab('after')}
                    className={`px-4 py-1.5 font-medium transition-colors ${previewTab === 'after' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    After ({previewAfter.length} rows)
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                {previewData.length > 0 ? (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {Object.keys(previewData[0]).map(key => (
                          <th key={key} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{key}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {previewData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          {Object.values(row).map((val: any, i) => (
                            <td key={i} className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap max-w-xs truncate">
                              {val === null || val === undefined ? <span className="text-gray-400 italic">null</span> : String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="p-6 text-sm text-gray-500 text-center">No rows to show.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel — Operation Library */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Add Operations</h3>
            {categories.map(category => (
              <div key={category} className="mb-6">
                <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-widest">{category}</h4>
                <div className="space-y-1.5">
                  {operationTypes.filter(op => op.category === category).map(op => (
                    <button key={op.value} onClick={() => addOperation(op.value)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors text-left">
                      <Plus className="size-4 text-blue-600 shrink-0" />
                      <span>{op.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-blue-600 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-medium text-blue-900 mb-2">Tips</h4>
                <ul className="space-y-1 text-sm text-blue-800">
                  <li>• Operations run in order — arrange carefully</li>
                  <li>• Preview runs on a 50-row sample before you commit</li>
                  <li>• Original table is never modified</li>
                  <li>• Output is saved as <code className="font-mono text-xs">transformed_&lt;table&gt;</code></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
