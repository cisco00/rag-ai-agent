import { useState, useEffect } from 'react';
import { Wrench, Plus, Play, Eye, AlertCircle, CheckCircle } from 'lucide-react';
import { api } from '../../lib/api';

interface DataTransformationProps {
  apiKey: string;
}

interface Operation {
  id: string;
  type: string;
  params: Record<string, any>;
}

export function DataTransformation({ }: DataTransformationProps) {
  const [selectedTable, setSelectedTable] = useState('customers');
  const [operations, setOperations] = useState<Operation[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [missingSummary, setMissingSummary] = useState<Array<{column: string; missing: number; pct: number; suggested: string}>>([]);

  useEffect(() => {
    fetchTables();
  }, []);

  const fetchTables = async () => {
    try {
      const resp = await api.get<{ tables: string[] }>('/tables');
      if (resp.tables) {
        setTables(resp.tables);
        if (resp.tables.length > 0) {
          setSelectedTable(resp.tables[0]);
        }
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
        if (data && data.columns) {
          setColumns(data.columns.map((c: any) => c.name));
        }
      } catch (err) {
        console.error('Failed to fetch columns for table:', err);
      }
    };
    fetchColumns();
  }, [selectedTable]);

  useEffect(() => {
    const fetchMissingSummary = async () => {
      if (!selectedTable) return;
      try {
        const data = await api.get<any>(`/tables/${selectedTable}/preview?limit=500`);
        if (data && data.rows && data.columns) {
          const colNames: string[] = data.columns.map((c: any) => c.name);
          const rows: any[] = data.rows;
          const total = rows.length;
          if (total === 0) return;
          const summary = colNames.map(col => {
            const missing = rows.filter((r: any) => r[col] === null || r[col] === '' || r[col] === undefined).length;
            const pct = Math.round((missing / total) * 100);
            const colType = (data.columns.find((c: any) => c.name === col)?.type || '').toLowerCase();
            const isNumeric = ['int','float','number','numeric','bigint','double','decimal'].some(t => colType.includes(t));
            const suggested = isNumeric ? 'mean' : 'mode';
            return { column: col, missing, pct, suggested };
          }).filter(s => s.missing > 0);
          setMissingSummary(summary);
        }
      } catch { /* silently ignore */ }
    };
    fetchMissingSummary();
  }, [selectedTable]);

  const operationTypes = [
    { value: 'drop_duplicates', label: 'Drop Duplicates', category: 'Cleaning' },
    { value: 'clean_text', label: 'Clean Text', category: 'Cleaning' },
    { value: 'remove_outliers', label: 'Remove Outliers', category: 'Cleaning' },
    { value: 'filter', label: 'Filter Rows', category: 'Select' },
    { value: 'rename_col', label: 'Rename Column', category: 'Select' },
    { value: 'drop_col', label: 'Drop Column', category: 'Select' },
    { value: 'change_type', label: 'Change Type', category: 'Select' },
    { value: 'fill_na', label: 'Fill Missing Values', category: 'Select' },
    { value: 'normalize', label: 'Normalize', category: 'Smart Prep' },
    { value: 'encode', label: 'Encode', category: 'Smart Prep' },
    { value: 'feature_engineering', label: 'Feature Engineering', category: 'Smart Prep' },
    { value: 'text_feature', label: 'Text Features', category: 'Smart Prep' },
    { value: 'groupby', label: 'Summarize', category: 'Summarize' },
    { value: 'resample', label: 'Time Series Summary', category: 'Summarize' },
  ];

  const addOperation = (type: string) => {
    const newOp: Operation = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      params: getDefaultParams(type),
    };
    setOperations([...operations, newOp]);
  };

  const getDefaultParams = (type: string): Record<string, any> => {
    const defaults: Record<string, any> = {
      drop_duplicates: { subset: '' },
      clean_text: { column: '', operation: 'lower' },
      remove_outliers: { column: '', outlier_method: 'z-score', threshold: 3 },
      filter: { column: '', operator: '>', value: '' },
      rename_col: { old_name: '', new_name: '' },
      drop_col: { column: '' },
      change_type: { column: '', new_type: 'int' },
      fill_na: { column: '', strategy: 'mean' },
      normalize: { columns: [], method: 'minmax' },
      encode: { column: '', method: 'onehot' },
      feature_engineering: { type: 'interaction', columns: [] },
      text_feature: { column: '', feature: 'length' },
      groupby: { columns: [], aggregations: {} },
      resample: { time_column: '', frequency: 'D' },
    };
    return defaults[type] || {};
  };

  const removeOperation = (id: string) => {
    setOperations(operations.filter((op) => op.id !== id));
  };

  const updateOperationParam = (id: string, param: string, value: any) => {
    setOperations(
      operations.map((op) =>
        op.id === id ? { ...op, params: { ...op.params, [param]: value } } : op
      )
    );
  };

  const handlePreview = async () => {
    if (!selectedTable) return;
    setIsProcessing(true);
    try {
      const data = await api.get<any[]>(`/tables/${selectedTable}/preview?limit=10`);
      setPreviewData(data);
      setShowPreview(true);
    } catch (err) {
      console.error('Failed to prepare preview:', err);
      alert('Failed to load table preview. Make sure the table exists.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApply = async () => {
    if (!selectedTable || operations.length === 0) return;
    setIsProcessing(true);

    try {
      const payload = {
        table_name: selectedTable,
        operations: operations.map(op => {
          let type = op.type;
          let params = { ...op.params };
          if (type === 'drop_duplicates') {
            type = 'clean';
            params.method = 'drop_duplicates';
          } else if (type === 'remove_outliers') {
            type = 'clean';
            params.method = 'remove_outliers';
          }
          return { type, ...params };
        })
      };

      const response = await api.post<any>('/transform', payload);

      setSuccess(true);
      
      // Fix Preview: Update focused table and set preview data from response
      if (response && response.target_table) {
          // Add the new table to the list if not there
          if (!tables.includes(response.target_table)) {
              setTables([...tables, response.target_table]);
          }
          setSelectedTable(response.target_table);
      }
      
      if (response && response.preview) {
          setPreviewData(response.preview);
          setShowPreview(true);
      } else {
          await handlePreview(); 
      }

      setTimeout(() => {
        setSuccess(false);
        setOperations([]);
      }, 3000);
    } catch (err: any) {
      console.error(err);
      alert(`Transformation failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateAI = async () => {
    if (!aiPrompt.trim() || !selectedTable) return;
    setIsGenerating(true);
    
    try {
      const response = await api.post<{ status: string; operations: Operation[] }>('/transform/suggest', {
        table_name: selectedTable,
        prompt: aiPrompt
      });
      
      if (response && response.operations) {
        // Hydrate the generated operations with unique IDs
        const newOps = response.operations.map(op => {
          let type = op.type;
          let params = { ...op };
          if (type === 'clean') {
            type = params.method === 'remove_outliers' ? 'remove_outliers' : 'drop_duplicates';
          }
          return {
            id: Math.random().toString(36).substr(2, 9),
            type,
            params: {
                ...params,
                friendly_description: op.friendly_description
            }
          };
        });
        setOperations([...operations, ...newOps]);
        setAiPrompt('');
      }
    } catch (err: any) {
      console.error('AI Generation failed:', err);
      alert(`AI Generation failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const renderOperationForm = (op: Operation) => {
    const columnSelector = (paramName: string, placeholder: string = "Select column") => (
      <select
        value={op.params[paramName] || ''}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateOperationParam(op.id, paramName, e.target.value)}
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
            {columnSelector('column')}
            <select
              value={op.params.operation || 'lower'}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateOperationParam(op.id, 'operation', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value="lower">Lowercase</option>
              <option value="upper">Uppercase</option>
              <option value="trim">Trim</option>
              <option value="title">Title Case</option>
              <option value="remove_special">Remove Special</option>
            </select>
          </div>
        );

      case 'filter':
        return (
          <div className="grid grid-cols-3 gap-3">
            {columnSelector('column')}
            <select
              value={op.params.operator || '>'}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateOperationParam(op.id, 'operator', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value=">">{'>'}</option>
              <option value="<">{'<'}</option>
              <option value="==">==</option>
              <option value="!=">!=</option>
              <option value=">=">{'>='}</option>
              <option value="<=">{'<='}</option>
            </select>
            <input
              type="text"
              placeholder="Value"
              value={op.params.value || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateOperationParam(op.id, 'value', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
        );

      case 'rename_col':
        return (
          <div className="grid grid-cols-2 gap-3">
            {columnSelector('column', 'Old Column')}
            <input
              type="text"
              placeholder="New name"
              value={op.params.new_name || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateOperationParam(op.id, 'new_name', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
        );

      case 'drop_col':
        return (
          <div className="grid grid-cols-1 gap-3">
            {columnSelector('column')}
          </div>
        );

      case 'change_type':
        return (
          <div className="grid grid-cols-2 gap-3">
            {columnSelector('column')}
            <select
              value={op.params.new_type || 'int'}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateOperationParam(op.id, 'new_type', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            >
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
                        <th className="text-left py-1">Apply</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missingSummary.map(s => (
                        <tr key={s.column} className="border-b border-amber-100">
                          <td className="py-1 pr-3 font-mono text-gray-700">{s.column}</td>
                          <td className="py-1 pr-3 text-right text-gray-600">{s.missing}</td>
                          <td className={`py-1 pr-3 text-right font-semibold ${s.pct > 20 ? 'text-red-600' : 'text-amber-700'}`}>{s.pct}%</td>
                          <td className="py-1 pr-3">
                            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">{s.suggested}</span>
                          </td>
                          <td className="py-1">
                            <button
                              onClick={() => {
                                updateOperationParam(op.id, 'column', s.column);
                                updateOperationParam(op.id, 'method', s.suggested);
                              }}
                              className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                            >Use</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              {columnSelector('column')}
              <select
                value={op.params.method || 'mean'}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateOperationParam(op.id, 'method', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded text-sm"
              >
                <option value="value">Specific Value</option>
                <option value="mean">Mean</option>
                <option value="median">Median</option>
                <option value="mode">Mode</option>
              </select>
              <input
                type="text"
                placeholder="Value (if specific)"
                value={op.params.value || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateOperationParam(op.id, 'value', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
        );

      case 'drop_duplicates':
        return (
          <div className="grid grid-cols-1 gap-3">
            {columnSelector('subset', 'Select column to check for duplicates (optional)')}
          </div>
        );

      case 'remove_outliers':
        return (
          <div className="grid grid-cols-2 gap-3">
            {columnSelector('column')}
            <input
              type="number"
              step="0.1"
              placeholder="Threshold (Z-Score)"
              value={op.params.threshold || 3.0}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateOperationParam(op.id, 'threshold', parseFloat(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
        );

      case 'normalize':
        return (
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
               {/* Normalization works on multiple columns, keeping it explicit as a text array or mapping */}
              <input
                type="text"
                placeholder="Columns (comma-separated)"
                value={op.params.columns?.join(',') || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateOperationParam(
                    op.id,
                    'columns',
                    e.target.value.split(',').map((c: string) => c.trim())
                  )
                }
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              />
            </div>
            <select
              value={op.params.method || 'minmax'}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateOperationParam(op.id, 'method', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value="minmax">Min-Max</option>
              <option value="zscore">Z-Score</option>
              <option value="log">Log</option>
            </select>
          </div>
        );

      default:
        return (
          <input
            type="text"
            placeholder="Configuration (JSON)"
            value={JSON.stringify(op.params)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              try {
                updateOperationParam(op.id, 'params', JSON.parse(e.target.value));
              } catch { }
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
          />
        );
    }
  };

  const categories = [...new Set(operationTypes.map((op) => op.category))];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Wrench className="size-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Data Prep</h1>
        </div>
        <p className="text-gray-600">
          Prepare and refine your data with AI-powered suggestions and instant preview.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Operations */}
        <div className="lg:col-span-2 space-y-6">
          {/* Table Selection */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Table
            </label>
            <select
              value={selectedTable}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedTable(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {tables.map((table) => (
                <option key={table} value={table}>
                  {table}
                </option>
              ))}
            </select>
          </div>

          {/* AI Transformation Wizard */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100 p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-600 rounded-lg shrink-0">
                <Wrench className="size-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-blue-900 mb-1">AI Data Prep Wizard</h3>
                <p className="text-blue-800 text-sm mb-4">
                  Describe how you want to prepare your data, and I'll handle the technical bits for you!
                </p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. 'Remove empty rows and drop the zip_code column'"
                    className="flex-1 px-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleGenerateAI();
                    }}
                  />
                  <button
                    onClick={handleGenerateAI}
                    disabled={isGenerating || !aiPrompt.trim()}
                    className="whitespace-nowrap px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {isGenerating ? 'Generating...' : 'Generate with AI'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Operations Pipeline */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Data Prep Pipeline</h2>
              <p className="text-sm text-gray-600 mt-1">
                {operations.length} operation(s) configured
              </p>
            </div>

            <div className="p-6 space-y-4">
              {operations.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Wrench className="size-12 mx-auto mb-3 text-gray-300" />
                  <p>No operations added yet.</p>
                  <p className="text-sm">Add operations from the panel on the right.</p>
                </div>
              ) : (
                operations.map((op, index) => (
                  <div
                    key={op.id}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-300 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold">
                          #{index + 1}
                        </span>
                        <h3 className="font-bold text-gray-900">
                          {op.params.friendly_description || operationTypes.find((t) => t.value === op.type)?.label}
                        </h3>
                      </div>
                      <button
                        onClick={() => removeOperation(op.id)}
                        className="text-red-600 hover:bg-red-50 p-1 rounded transition-colors"
                      >
                        ×
                      </button>
                    </div>
                    {renderOperationForm(op)}
                  </div>
                ))
              )}
            </div>

            {operations.length > 0 && (
              <div className="p-6 border-t border-gray-200 flex gap-3">
                <button
                  onClick={handlePreview}
                  disabled={isProcessing}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 disabled:opacity-50 transition-colors font-medium"
                >
                  <Eye className="size-5" />
                  Preview (10 rows)
                </button>
                <button
                  onClick={handleApply}
                  disabled={isProcessing}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                >
                  <Play className="size-5" />
                  Run Data Prep
                </button>
              </div>
            )}
          </div>

          {/* Preview */}
          {showPreview && previewData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <Eye className="size-5 text-blue-600" />
                  <h2 className="text-xl font-bold text-gray-900">Preview Results</h2>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {Object.keys(previewData[0] || {}).map((key) => (
                        <th
                          key={key}
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {previewData.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        {Object.values(row).map((val: any, i) => (
                          <td key={i} className="px-6 py-4 text-sm text-gray-900">
                            {String(val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6 flex items-center gap-3">
              <CheckCircle className="size-6 text-green-600" />
              <div>
                <h3 className="font-bold text-green-900">Transformations Applied!</h3>
                <p className="text-sm text-green-700">
                  Your data has been successfully transformed.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Operation Library */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Add Operations</h3>

            {categories.map((category) => (
              <div key={category} className="mb-6">
                <h4 className="text-sm font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  {category}
                </h4>
                <div className="space-y-2">
                  {operationTypes
                    .filter((op) => op.category === category)
                    .map((op) => (
                      <button
                        key={op.value}
                        onClick={() => addOperation(op.value)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors text-left"
                      >
                        <Plus className="size-4 text-blue-600" />
                        <span>{op.label}</span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>

          {/* Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-900 mb-2">💡 Tips</h4>
                <ul className="space-y-1 text-sm text-blue-800">
                  <li>• Operations are applied in sequence</li>
                  <li>• Preview shows first 10 rows</li>
                  <li>• Original table is preserved</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
