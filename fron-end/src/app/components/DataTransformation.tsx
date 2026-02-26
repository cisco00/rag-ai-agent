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

  useEffect(() => {
    fetchTables();
  }, []);

  const fetchTables = async () => {
    try {
      const resp = await api.get<{ tables: { name: string }[] }>('/tables');
      if (resp.tables) {
        const tableNames = resp.tables.map((t) => t.name);
        setTables(tableNames);
        if (tableNames.length > 0) {
          setSelectedTable(tableNames[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch tables:', err);
    }
  };

  const operationTypes = [
    { value: 'drop_duplicates', label: 'Drop Duplicates', category: 'Cleaning' },
    { value: 'clean_text', label: 'Clean Text', category: 'Cleaning' },
    { value: 'remove_outliers', label: 'Remove Outliers', category: 'Cleaning' },
    { value: 'filter', label: 'Filter Rows', category: 'Transform' },
    { value: 'rename_col', label: 'Rename Column', category: 'Transform' },
    { value: 'drop_col', label: 'Drop Column', category: 'Transform' },
    { value: 'change_type', label: 'Change Type', category: 'Transform' },
    { value: 'fill_na', label: 'Fill Missing Values', category: 'Transform' },
    { value: 'normalize', label: 'Normalize', category: 'Advanced' },
    { value: 'encode', label: 'Encode', category: 'Advanced' },
    { value: 'feature_engineering', label: 'Feature Engineering', category: 'Advanced' },
    { value: 'text_feature', label: 'Text Features', category: 'Advanced' },
    { value: 'groupby', label: 'Group By', category: 'Aggregation' },
    { value: 'resample', label: 'Resample Time Series', category: 'Aggregation' },
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
      drop_duplicates: { subset: [] },
      clean_text: { column: '', operation: 'lower' },
      remove_outliers: { column: '', method: 'zscore', threshold: 3 },
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
        operations: operations.map(op => ({
          type: op.type,
          ...op.params
        }))
      };

      await api.post('/transform', payload);

      setSuccess(true);
      await handlePreview(); // auto-refresh preview from backend

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

  const renderOperationForm = (op: Operation) => {
    switch (op.type) {
      case 'clean_text':
        return (
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Column name"
              value={op.params.column || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateOperationParam(op.id, 'column', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            />
            <select
              value={op.params.operation || 'lower'}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateOperationParam(op.id, 'operation', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value="lower">Lowercase</option>
              <option value="upper">Uppercase</option>
              <option value="trim">Trim</option>
            </select>
          </div>
        );

      case 'filter':
        return (
          <div className="grid grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Column"
              value={op.params.column || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateOperationParam(op.id, 'column', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            />
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

      case 'fill_na':
        return (
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Column name"
              value={op.params.column || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateOperationParam(op.id, 'column', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            />
            <select
              value={op.params.strategy || 'mean'}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateOperationParam(op.id, 'strategy', e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value="mean">Mean</option>
              <option value="median">Median</option>
              <option value="mode">Mode</option>
              <option value="constant">Constant</option>
            </select>
          </div>
        );

      case 'normalize':
        return (
          <div className="grid grid-cols-2 gap-3">
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
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            />
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
          <h1 className="text-3xl font-bold text-gray-900">Data Transformation</h1>
        </div>
        <p className="text-gray-600">
          Apply advanced transformations to your data with instant preview.
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

          {/* Operations Pipeline */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Transformation Pipeline</h2>
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
                          {operationTypes.find((t) => t.value === op.type)?.label}
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
                  Apply Transformations
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
