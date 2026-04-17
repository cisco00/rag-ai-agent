import React, { useState, useMemo, useCallback } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, X, FileSpreadsheet, Search, ChevronRight, Server, Lightbulb, RotateCw, Loader2, Clock, Eye, Sparkles, Trash2, Settings2, ChevronDown, Plus, SlidersHorizontal } from 'lucide-react';
import { api } from '../../lib/api';

interface FileImportProps {
  apiKey: string;
  onConfigured: () => void;
  onQueryClick?: (query: string) => void;
}

interface ImportedFile {
  name: string;
  status: 'success' | 'error';
  rows?: number;
  tableName?: string;
  message?: string;
}

interface FileAnalysis {
  fileName: string;
  columns: string[];
  missingValues: Record<string, number>;
  totalRows: number;
  dataTypes: Record<string, string>;
}

export function FileImport({ onConfigured, onQueryClick }: FileImportProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [importMode, setImportMode] = useState<'single' | 'batch'>('single');
  const [ifExists, setIfExists] = useState('replace');
  const [importedFiles, setImportedFiles] = useState<ImportedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [fileAnalysis, setFileAnalysis] = useState<FileAnalysis | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisFiles, setAnalysisFiles] = useState<File[]>([]);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [suggestedQueries, setSuggestedQueries] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  // API Preview State
  const [apiPreviewData, setApiPreviewData] = useState<{
    row_count: number;
    columns: { name: string; type: string }[];
    preview_rows: Record<string, any>[];
    missing_values: Record<string, number>;
  } | null>(null);
  const [showApiPreview, setShowApiPreview] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [apiPreviewError, setApiPreviewError] = useState<string | null>(null);

  // Cleaning Config State
  const [autoDropNullRows, setAutoDropNullRows] = useState(false);
  const [autoDropNullCols, setAutoDropNullCols] = useState(false);
  const [autoDropDuplicates, setAutoDropDuplicates] = useState(false);
  const [typeConversions, setTypeConversions] = useState<Record<string, string>>({});
  const [formattingRules, setFormattingRules] = useState<{ column: string; action: string }[]>([]);
  const [validationRules, setValidationRules] = useState<{ column: string; rule: string; value: string }[]>([]);
  const [excludeColumns, setExcludeColumns] = useState<string[]>([]);
  const [rowFilters, setRowFilters] = useState<{ column: string; op: string; value: string }[]>([]);
  const [cleaningReport, setCleaningReport] = useState<string[]>([]);

  // Tabs and API Import State
  const [activeTab, setActiveTab] = useState<'file' | 'batch' | 'api'>('file');
  const [apiUrl, setApiUrl] = useState('');
  const [apiMethod, setApiMethod] = useState<'GET' | 'POST'>('GET');
  const [apiTargetTable, setApiTargetTable] = useState('');
  const [apiRefreshInterval, setApiRefreshInterval] = useState<number | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f: any) =>
      f.name.endsWith('.csv') || f.name.endsWith('.xlsx') || f.name.endsWith('.xls')
    );
    if (files.length > 0) analyzeAndPreviewFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      analyzeAndPreviewFiles(files);
      e.target.value = '';
    }
  };

  const handleAnalyzeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      analyzeAndPreviewFiles([e.target.files[0]]);
      e.target.value = '';
    }
  };

  const fetchSuggestions = useCallback(async (isRefresh = false) => {
    setIsLoadingSuggestions(true);
    try {
      const data = await api.get<{ queries: string[] }>(`/analytics/suggested-queries${isRefresh ? '?refresh=true' : ''}`);
      if (data && data.queries) {
        setSuggestedQueries(data.queries);
      }
    } catch (err) {
      console.error('Failed to fetch suggested queries:', err);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, []);

  const handleFiles = useCallback(async (files: File[]) => {
    setIsUploading(true);

    try {
      if (importMode === 'single' || files.length === 1) {
        const formData = new FormData();
        formData.append('file', files[0]);
        formData.append('if_exists', ifExists);

        // Append cleaning config if any rule is active
        const cleaning_config: any = {
          drop_null_rows: autoDropNullRows,
          drop_null_columns: autoDropNullCols,
          drop_duplicates: autoDropDuplicates,
        };
        if (Object.keys(typeConversions).length > 0) cleaning_config.type_conversions = typeConversions;
        if (formattingRules.length > 0) cleaning_config.formatting = formattingRules;
        if (validationRules.length > 0) cleaning_config.validation_rules = validationRules;
        if (excludeColumns.length > 0) cleaning_config.exclude_columns = excludeColumns;
        if (rowFilters.length > 0) cleaning_config.row_filters = rowFilters;

        if (cleaning_config.drop_null_rows || cleaning_config.drop_null_columns || cleaning_config.drop_duplicates || Object.keys(cleaning_config).length > 3) {
          formData.append('cleaning_config', JSON.stringify(cleaning_config));
        }

        const res = await api.post<any>('/import', formData);
        setImportedFiles(prev => [...prev, {
          name: files[0].name,
          status: 'success',
          rows: res.rows_imported,
          tableName: res.table_name,
        }]);
        // Notify parent that a DB might have been auto-provisioned
        onConfigured();
      } else {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f));
        formData.append('if_exists', ifExists);

        // Append cleaning config
        const cleaning_config: any = {
          drop_null_rows: autoDropNullRows,
          drop_null_columns: autoDropNullCols,
          drop_duplicates: autoDropDuplicates,
        };
        if (Object.keys(typeConversions).length > 0) cleaning_config.type_conversions = typeConversions;
        if (formattingRules.length > 0) cleaning_config.formatting = formattingRules;
        if (validationRules.length > 0) cleaning_config.validation_rules = validationRules;
        if (excludeColumns.length > 0) cleaning_config.exclude_columns = excludeColumns;
        if (rowFilters.length > 0) cleaning_config.row_filters = rowFilters;

        if (cleaning_config.drop_null_rows || cleaning_config.drop_null_columns || cleaning_config.drop_duplicates || Object.keys(cleaning_config).length > 3) {
          formData.append('cleaning_config', JSON.stringify(cleaning_config));
        }

        const res = await api.post<any>('/import/batch', formData);

        const results = res.files.map((r: any) => ({
          name: r.filename,
          status: r.status === 'success' ? 'success' : 'error',
          rows: r.rows_imported,
          tableName: r.table_name,
          message: r.error || r.status
        }));

        setImportedFiles(prev => [...prev, ...results]);
        // Notify parent that a DB might have been auto-provisioned
        if (results.some((r: any) => r.status === 'success')) {
          onConfigured();
        }
      }
      // Fetch suggested queries after successful import
      fetchSuggestions();
    } catch (err: any) {
      console.error(err);
      setImportedFiles(prev => [...prev, {
        name: files.length === 1 ? files[0].name : `${files.length} files`,
        status: 'error',
        message: err.message || 'Import failed'
      }]);
    } finally {
      setIsUploading(false);
    }
  }, [importMode, ifExists, autoDropNullRows, autoDropNullCols, autoDropDuplicates, typeConversions, formattingRules, validationRules, excludeColumns, rowFilters, onConfigured, fetchSuggestions]);

  const analyzeAndPreviewFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setAnalysisFiles(files);
    setIsUploading(true);
    setAnalysisError(null);

    try {
      const formData = new FormData();
      formData.append('file', files[0]);

      const res = await api.post<any>('/analyze-file', formData);

      const fileAnalysisData: FileAnalysis = {
        fileName: res.filename,
        columns: res.columns.map((c: any) => c.name),
        missingValues: res.missing_values || {},
        totalRows: res.row_count,
        dataTypes: res.columns.reduce((acc: any, c: any) => { acc[c.name] = c.type; return acc; }, {}),
      };

      setFileAnalysis(fileAnalysisData);
      setShowAnalysis(true);
    } catch (err: any) {
      console.error('Analysis failed', err);
      setAnalysisError(err.message || 'File analysis failed. Please check the format.');
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleImportAnalyzedFile = useCallback(() => {
    if (analysisFiles.length > 0) {
      handleFiles(analysisFiles);
      setShowAnalysis(false);
      setFileAnalysis(null);
      setAnalysisFiles([]);
      resetCleaningState();
    }
  }, [analysisFiles, handleFiles]);

  const removeFile = (index: number) => {
    setImportedFiles(importedFiles.filter((_, i) => i !== index));
  };

  const handleApiPreview = async () => {
    if (!apiUrl) return;
    setIsPreviewLoading(true);
    setApiPreviewError(null);
    try {
      const res = await api.post<any>('/import/api/preview', {
        url: apiUrl,
        method: apiMethod,
        headers: {},
      });
      setApiPreviewData(res);
      setShowApiPreview(true);
    } catch (err: any) {
      console.error('API preview failed', err);
      setApiPreviewError(err.message || 'Failed to fetch preview from API');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleApiImport = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!apiUrl || !apiTargetTable) return;
    setIsUploading(true);
    try {
      const res = await api.post<any>('/import/api', {
        url: apiUrl,
        method: apiMethod,
        table_name: apiTargetTable,
        if_exists: ifExists,
        refresh_interval: apiRefreshInterval,
        headers: {} // Can add UI for headers later
      });
      setImportedFiles(prev => [...prev, {
        name: `API: ${apiUrl}`,
        status: 'success',
        message: res.message,
        tableName: apiTargetTable
      }]);
      setShowApiPreview(false);
      setApiPreviewData(null);
      onConfigured();
    } catch (err: any) {
      console.error(err);
      setImportedFiles(prev => [...prev, {
        name: `API: ${apiUrl}`,
        status: 'error',
        message: err.message || 'API Import failed'
      }]);
    } finally {
      setIsUploading(false);
    }
  };

  const resetCleaningState = () => {
    setAutoDropNullRows(false);
    setAutoDropNullCols(false);
    setAutoDropDuplicates(false);
    setTypeConversions({});
    setFormattingRules([]);
    setValidationRules([]);
    setExcludeColumns([]);
    setRowFilters([]);
    setCleaningReport([]);
  };

  const handleCleanAndImport = async () => {
    if (!apiUrl || !apiTargetTable) return;
    setIsUploading(true);
    try {
      const cleaning_config: any = {
        drop_null_rows: autoDropNullRows,
        drop_null_columns: autoDropNullCols,
        drop_duplicates: autoDropDuplicates,
      };
      if (Object.keys(typeConversions).length > 0) cleaning_config.type_conversions = typeConversions;
      if (formattingRules.length > 0) cleaning_config.formatting = formattingRules;
      if (validationRules.length > 0) cleaning_config.validation_rules = validationRules;
      if (excludeColumns.length > 0) cleaning_config.exclude_columns = excludeColumns;
      if (rowFilters.length > 0) cleaning_config.row_filters = rowFilters;

      const res = await api.post<any>('/import/api/clean-and-import', {
        url: apiUrl,
        method: apiMethod,
        table_name: apiTargetTable,
        if_exists: ifExists,
        refresh_interval: apiRefreshInterval,
        headers: {},
        cleaning_config,
      });
      setCleaningReport(res.cleaning_report || []);
      setImportedFiles(prev => [...prev, {
        name: `API: ${apiUrl}`,
        status: 'success',
        rows: res.rows,
        message: res.message,
        tableName: apiTargetTable
      }]);
      setShowApiPreview(false);
      setApiPreviewData(null);
      resetCleaningState();
      onConfigured();
    } catch (err: any) {
      console.error(err);
      setImportedFiles(prev => [...prev, {
        name: `API: ${apiUrl}`,
        status: 'error',
        message: err.message || 'Clean & Import failed'
      }]);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Upload className="size-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Import Files</h1>
        </div>
        <p className="text-gray-600">
          Upload CSV or Excel files to analyze your data with natural language queries.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Import Configuration */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Import Options</h3>

            {/* If Exists Strategy */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                If Table Exists
              </label>
              <select
                value={ifExists}
                onChange={(e) => setIfExists(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                <option value="replace">Replace</option>
                <option value="append">Append</option>
                <option value="fail">Fail</option>
              </select>
            </div>
          </div>

          {/* Pre-Import Analysis */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Search className="size-5 text-purple-600" />
              <h3 className="font-bold text-gray-900">Analyze Before Import</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Preview columns and detect missing values before importing
            </p>
            <label className="block w-full px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 cursor-pointer transition-colors font-medium text-center">
              Analyze File
              <input
                type="file"
                onChange={handleAnalyzeFile}
                accept=".csv,.xlsx,.xls"
                className="hidden"
                disabled={isUploading}
              />
            </label>
            {analysisError && (
              <div className="mt-4 flex items-start gap-2 bg-red-50 text-red-700 p-3 rounded-lg text-sm">
                <AlertCircle className="size-4 mt-0.5 flex-shrink-0" />
                <p>{analysisError}</p>
              </div>
            )}
          </div>

          {/* File Type Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Supported Formats</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <FileText className="size-5 text-green-600" />
                <span className="text-sm text-gray-700">.csv files</span>
              </div>
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="size-5 text-blue-600" />
                <span className="text-sm text-gray-700">.xlsx, .xls files</span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-4">
              Maximum file size: 50MB per file
            </p>
          </div>
        </div>

        {/* Upload/Import Area */}
        <div className="lg:col-span-2 space-y-6">

          {/* Tabs */}
          <div className="bg-white rounded-xl border border-gray-200 p-2 flex overflow-x-auto hide-scrollbar">
            <button
              className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 font-medium text-sm transition-all rounded-lg whitespace-nowrap ${activeTab === 'file' ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
              onClick={() => { setActiveTab('file'); setImportMode('single'); }}
            >
              <FileSpreadsheet className="size-4" /> Single File
            </button>
            <button
              className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 font-medium text-sm transition-all rounded-lg whitespace-nowrap ${activeTab === 'batch' ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
              onClick={() => { setActiveTab('batch'); setImportMode('batch'); }}
            >
              <Upload className="size-4" /> Batch Upload
            </button>
            <button
              className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 font-medium text-sm transition-all rounded-lg whitespace-nowrap ${activeTab === 'api' ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
              onClick={() => setActiveTab('api')}
            >
              <Server className="size-4" /> API Import
            </button>
          </div>

          {/* File Drop Zone */}
          {(activeTab === 'file' || activeTab === 'batch') && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`
                bg-white rounded-xl border-2 border-dashed p-12 text-center transition-colors
                ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}
                ${isUploading ? 'opacity-50 pointer-events-none' : ''}
              `}
            >
              <Upload className={`size-16 mx-auto mb-4 ${isDragging ? 'text-blue-600' : 'text-gray-400'}`} />
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                {isUploading ? 'Uploading...' : 'Drop files here or click to browse'}
              </h3>
              <p className="text-gray-600 mb-6">
                {activeTab === 'file'
                  ? 'Upload a CSV or Excel file'
                  : 'Upload up to 20 CSV or Excel files at once'}
              </p>
              <label className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition-colors font-medium">
                Select Files
                <input
                  type="file"
                  onChange={handleFileSelect}
                  accept=".csv,.xlsx,.xls"
                  multiple={activeTab === 'batch'}
                  className="hidden"
                  disabled={isUploading}
                />
              </label>
            </div>
          )}

          {/* API Import Form */}
          {activeTab === 'api' && (
            <div className="bg-white rounded-xl border border-gray-200 p-8">
              <div className="mb-6 flex items-center gap-3 text-blue-700 bg-blue-50 p-4 rounded-lg">
                <Server className="size-5" />
                <p className="text-sm font-medium">Fetch structured data directly from an external API payload. Data will be flattened and stored into the targeted table.</p>
              </div>

              <form onSubmit={handleApiImport} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                    <select
                      value={apiMethod}
                      onChange={(e) => setApiMethod(e.target.value as 'GET' | 'POST')}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">API URL Endpoint</label>
                    <input
                      type="url"
                      required
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      placeholder="https://api.example.com/data"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target Table Name</label>
                  <input
                    type="text"
                    required
                    value={apiTargetTable}
                    onChange={(e) => setApiTargetTable(e.target.value)}
                    placeholder="e.g., api_users_data"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-2">The fetched data will be stored under this table namespace.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                    <Clock className="size-4 text-blue-600" />
                    Periodic Refresh Interval
                  </label>
                  <select
                    value={apiRefreshInterval === null ? "" : apiRefreshInterval}
                    onChange={(e) => setApiRefreshInterval(e.target.value === "" ? null : parseInt(e.target.value))}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Off (No automatic refresh)</option>
                    <option value="30">Every 30 minutes</option>
                    <option value="60">Every 1 hour</option>
                    <option value="360">Every 6 hours</option>
                    <option value="1440">Every 24 hours</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-2">
                    Enable real-time updates for this data source. The system will re-fetch data at the specified interval.
                  </p>
                </div>

                {apiPreviewError && (
                  <div className="flex items-start gap-2 bg-red-50 text-red-700 p-3 rounded-lg text-sm">
                    <AlertCircle className="size-4 mt-0.5 flex-shrink-0" />
                    <p>{apiPreviewError}</p>
                  </div>
                )}

                <div className="pt-4 border-t border-gray-100 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleApiPreview}
                    disabled={isPreviewLoading || !apiUrl}
                    className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
                  >
                    {isPreviewLoading ? <><Loader2 className="size-4 animate-spin" /> Fetching Preview...</> : <><Eye className="size-4" /> Preview Data</>}
                  </button>
                  <button
                    type="submit"
                    disabled={isUploading || !apiUrl || !apiTargetTable}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
                  >
                    {isUploading ? 'Importing...' : 'Fetch and Import Data'}
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </form>

              {/* API Preview Panel */}
              {showApiPreview && apiPreviewData && (
                <div className="mt-6 border-t border-gray-200 pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Eye className="size-5 text-purple-600" />
                      <h3 className="font-bold text-gray-900">API Data Preview</h3>
                    </div>
                    <button
                      onClick={() => { setShowApiPreview(false); setApiPreviewData(null); }}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      <X className="size-5" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span>Source: <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{apiUrl}</span></span>
                      <span className="font-semibold">{apiPreviewData.row_count.toLocaleString()} rows</span>
                    </div>

                    {/* Columns */}
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Columns ({apiPreviewData.columns.length})</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {apiPreviewData.columns.slice(0, 100).map((col) => (
                          <div key={col.name} className="px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm">
                            <p className="font-mono text-gray-900 truncate">{col.name}</p>
                            <p className="text-xs text-gray-500">{col.type}</p>
                          </div>
                        ))}
                      </div>
                      {apiPreviewData.columns.length > 100 && (
                        <p className="text-xs text-gray-500 mt-2 italic">+ {apiPreviewData.columns.length - 100} more columns</p>
                      )}
                    </div>

                    {/* Missing Values */}
                    {Object.keys(apiPreviewData.missing_values).length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">Missing Values</h4>
                        <div className="space-y-1">
                          {Object.entries(apiPreviewData.missing_values).slice(0, 100).map(([col, count]) => (
                            <div key={col} className="flex items-center justify-between p-2 bg-orange-50 border border-orange-200 rounded text-sm">
                              <span className="font-mono text-gray-900">{col}</span>
                              <span className="font-bold text-orange-600">
                                {count} missing ({((count / apiPreviewData.row_count) * 100).toFixed(1)}%)
                              </span>
                            </div>
                          ))}
                        </div>
                        {Object.keys(apiPreviewData.missing_values).length > 100 && (
                          <p className="text-xs text-gray-500 mt-2 italic">+ {Object.keys(apiPreviewData.missing_values).length - 100} more columns with missing values</p>
                        )}
                      </div>
                    )}

                    {/* Sample Data Table */}
                    {apiPreviewData.preview_rows.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">Sample Data (first {apiPreviewData.preview_rows.length} rows)</h4>
                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                          <table className="min-w-full text-xs">
                            <thead className="bg-gray-50">
                              <tr>
                                {apiPreviewData.columns.slice(0, 50).map((col) => (
                                  <th key={col.name} className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap border-b border-gray-200">
                                    {col.name}
                                  </th>
                                ))}
                                {apiPreviewData.columns.length > 50 && (
                                  <th className="px-3 py-2 text-left font-semibold text-gray-400 whitespace-nowrap border-b border-gray-200 italic">
                                    + {apiPreviewData.columns.length - 50} more
                                  </th>
                                )}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {apiPreviewData.preview_rows.map((row, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                  {apiPreviewData.columns.slice(0, 50).map((col) => (
                                    <td key={col.name} className="px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-[200px] truncate">
                                      {row[col.name] === null || row[col.name] === undefined ? (
                                        <span className="text-gray-400 italic">null</span>
                                      ) : (
                                        String(row[col.name])
                                      )}
                                    </td>
                                  ))}
                                  {apiPreviewData.columns.length > 50 && (
                                    <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">...</td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* ── Data Cleaning Section ── */}
                    <CleaningConfigUI
                      columns={apiPreviewData.columns}
                      missingValues={apiPreviewData.missing_values}
                      config={{
                        autoDropNullRows, autoDropNullCols, autoDropDuplicates,
                        typeConversions, formattingRules, validationRules,
                        excludeColumns, rowFilters
                      }}
                      setters={{
                        setAutoDropNullRows, setAutoDropNullCols, setAutoDropDuplicates,
                        setTypeConversions, setFormattingRules, setValidationRules,
                        setExcludeColumns, setRowFilters
                      }}
                    />

                    {/* Cleaning Report (shown after import) */}
                    {cleaningReport.length > 0 && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <h4 className="font-medium text-green-900 text-sm mb-2">Cleaning Report</h4>
                        <ul className="space-y-1">
                          {cleaningReport.map((line, i) => (
                            <li key={i} className="text-xs text-green-800">• {line}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={handleCleanAndImport}
                        disabled={isUploading || !apiTargetTable}
                        className="flex-1 px-5 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2 text-sm"
                      >
                        {isUploading ? <><Loader2 className="size-4 animate-spin" /> Cleaning & Importing...</> : <><Sparkles className="size-4" /> Clean & Import</>}
                      </button>
                      <button
                        onClick={() => handleApiImport()}
                        disabled={isUploading || !apiTargetTable}
                        className="px-5 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2 text-sm"
                      >
                        <ChevronRight className="size-4" /> Import Without Cleaning
                      </button>
                      <button
                        onClick={() => { setShowApiPreview(false); setApiPreviewData(null); resetCleaningState(); }}
                        className="px-5 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
                      >
                        Cancel
                      </button>
                    </div>

                    {!apiTargetTable && (
                      <p className="text-sm text-amber-600 flex items-center gap-1">
                        <AlertCircle className="size-4" /> Please enter a target table name above before importing.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* File Analysis Modal */}
          {showAnalysis && fileAnalysis && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Search className="size-6 text-purple-600" />
                  <h3 className="font-bold text-gray-900">File Analysis</h3>
                </div>
                <button
                  onClick={() => {
                    setShowAnalysis(false);
                    setFileAnalysis(null);
                    setAnalysisFiles([]);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <p className="text-sm text-gray-600 mb-2">
                    {analysisFiles.length > 1 ? `Batch Analysis: ${analysisFiles.length} files (Previewing ${fileAnalysis.fileName})` : `File: ${fileAnalysis.fileName}`}
                  </p>
                  <p className="text-sm text-gray-600">Total Rows: {fileAnalysis.totalRows.toLocaleString()}</p>
                </div>

                <div>
                  <h4 className="font-medium text-gray-900 mb-3">Columns ({fileAnalysis.columns.length})</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {fileAnalysis.columns.slice(0, 100).map((col) => (
                      <div
                        key={col}
                        className="px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm"
                      >
                        <p className="font-mono text-gray-900">{col}</p>
                        <p className="text-xs text-gray-500">{fileAnalysis.dataTypes[col]}</p>
                      </div>
                    ))}
                  </div>
                  {fileAnalysis.columns.length > 100 && (
                    <p className="text-xs text-gray-500 mt-2 italic">+ {fileAnalysis.columns.length - 100} more columns</p>
                  )}
                </div>

                {Object.keys(fileAnalysis.missingValues).length > 0 && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3">Missing Values</h4>
                    <div className="space-y-2">
                      {Object.entries(fileAnalysis.missingValues).slice(0, 100).map(([col, count]) => (
                        <div key={col} className="flex items-center justify-between p-3 bg-orange-50 border border-orange-200 rounded">
                          <span className="text-sm font-mono text-gray-900">{col}</span>
                          <span className="text-sm font-bold text-orange-600">
                            {count} missing ({((count / fileAnalysis.totalRows) * 100).toFixed(1)}%)
                          </span>
                        </div>
                      ))}
                    </div>
                    {Object.keys(fileAnalysis.missingValues).length > 100 && (
                      <p className="text-xs text-gray-500 mt-2 italic">+ {Object.keys(fileAnalysis.missingValues).length - 100} more columns with missing values</p>
                    )}
                  </div>
                )}

                {/* Hook up the Reusable Cleaning UI here */}
                <CleaningConfigUI
                  columns={fileAnalysis.columns.map(name => ({ name, type: fileAnalysis.dataTypes[name] }))}
                  missingValues={fileAnalysis.missingValues}
                  config={{
                    autoDropNullRows, autoDropNullCols, autoDropDuplicates,
                    typeConversions, formattingRules, validationRules,
                    excludeColumns, rowFilters
                  }}
                  setters={{
                    setAutoDropNullRows, setAutoDropNullCols, setAutoDropDuplicates,
                    setTypeConversions, setFormattingRules, setValidationRules,
                    setExcludeColumns, setRowFilters
                  }}
                />

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleImportAnalyzedFile}
                    className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    <Sparkles className="size-4" /> Clean & Import
                  </button>
                  <button
                    onClick={() => {
                      resetCleaningState();
                      handleImportAnalyzedFile();
                    }}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    Import Without Cleaning
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Import Results */}
          {importedFiles.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-900">Imported Files ({importedFiles.length})</h3>
                <button
                  onClick={() => {
                    setImportedFiles([]);
                    setSuggestedQueries([]);
                  }}
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Clear All
                </button>
              </div>
              <div className="space-y-3 mb-6">
                {importedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-4 p-4 rounded-lg border border-gray-200"
                  >
                    {file.status === 'success' ? (
                      <CheckCircle className="size-5 text-green-600 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="size-5 text-red-600 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-sm text-gray-600">
                        {file.status === 'success'
                          ? `${file.rows?.toLocaleString()} rows imported to table "${file.tableName}"`
                          : file.message}
                      </p>
                    </div>
                    <button
                      onClick={() => removeFile(index)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <X className="size-4 text-gray-500" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Suggested Questions */}
              {suggestedQueries.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="size-5 text-yellow-600" />
                      <h4 className="font-bold text-gray-900">Recommended Questions</h4>
                    </div>
                    <button
                      onClick={() => fetchSuggestions(true)}
                      disabled={isLoadingSuggestions}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      <RotateCw className={`size-3 ${isLoadingSuggestions ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {suggestedQueries.map((query, idx) => (
                      <button
                        key={idx}
                        onClick={() => onQueryClick?.(query)}
                        className="text-left p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition-all group"
                      >
                        <p className="text-sm text-gray-700 group-hover:text-blue-700">{query}</p>
                      </button>
                    ))}
                  </div>
                  {isLoadingSuggestions && (
                    <div className="flex items-center gap-2 mt-4 text-sm text-gray-500">
                      <Loader2 className="size-4 animate-spin" />
                      Generating more suggestions...
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tips */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h4 className="font-medium text-blue-900 mb-3">💡 Tips for Best Results</h4>
            <ul className="space-y-2 text-sm text-blue-800">
              <li>• Use the "Analyze Before Import" feature to preview your data structure</li>
              <li>• Column names will be automatically cleaned and normalized</li>
              <li>• Empty files will be rejected</li>
              <li>• Excel files with multiple sheets will import all sheets</li>
              <li>• Table names are generated from file names (lowercase, underscores)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Sub-components for better performance ---

interface CleaningConfigUIProps {
  columns: { name: string; type: string }[];
  missingValues: Record<string, number>;
  config: {
    autoDropNullRows: boolean;
    autoDropNullCols: boolean;
    autoDropDuplicates: boolean;
    typeConversions: Record<string, string>;
    formattingRules: { column: string; action: string }[];
    validationRules: { column: string; rule: string; value: string }[];
    excludeColumns: string[];
    rowFilters: { column: string; op: string; value: string }[];
  };
  setters: {
    setAutoDropNullRows: (v: boolean) => void;
    setAutoDropNullCols: (v: boolean) => void;
    setAutoDropDuplicates: (v: boolean) => void;
    setTypeConversions: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    setFormattingRules: React.Dispatch<React.SetStateAction<{ column: string; action: string }[]>>;
    setValidationRules: React.Dispatch<React.SetStateAction<{ column: string; rule: string; value: string }[]>>;
    setExcludeColumns: React.Dispatch<React.SetStateAction<string[]>>;
    setRowFilters: React.Dispatch<React.SetStateAction<{ column: string; op: string; value: string }[]>>;
  };
}

const CleaningConfigUI = React.memo(({ columns, missingValues, config, setters }: CleaningConfigUIProps) => {
  const [cleaningTab, setCleaningTab] = useState<'auto' | 'manual'>('auto');
  const [manualSection, setManualSection] = useState<string | null>(null);
  const [columnSearch, setColumnSearch] = useState('');

  const filteredColumns = useMemo(() => {
    let result = columns;
    if (columnSearch) {
      const s = columnSearch.toLowerCase();
      result = columns.filter(c => c.name.toLowerCase().includes(s));
    }
    return result.slice(0, 100);
  }, [columns, columnSearch]);

  return (
    <div className="mt-8 border-t border-gray-200 pt-6">
      <div className="flex items-center gap-2 mb-4">
        <SlidersHorizontal className="size-5 text-blue-600" />
        <h3 className="font-bold text-gray-900">Data Cleaning Configuration</h3>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="flex border-b border-gray-200 bg-gray-50">
          <button
            onClick={() => setCleaningTab('auto')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${cleaningTab === 'auto' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
          >
            <Sparkles className="size-4" /> Auto Clean
          </button>
          <button
            onClick={() => setCleaningTab('manual')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${cleaningTab === 'manual' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
          >
            <Settings2 className="size-4" /> Manual Clean
          </button>
        </div>

        <div className="p-4">
          {cleaningTab === 'auto' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 mb-3">Toggle automatic data cleaning operations</p>
              {[{
                label: 'Remove rows with missing values',
                desc: `${Object.keys(missingValues).length} column(s) have nulls`,
                checked: config.autoDropNullRows, set: setters.setAutoDropNullRows,
              }, {
                label: 'Remove entirely empty columns',
                desc: 'Drops columns where all values are null',
                checked: config.autoDropNullCols, set: setters.setAutoDropNullCols,
              }, {
                label: 'Remove duplicate rows',
                desc: 'Keeps only the first occurrence of each duplicate',
                checked: config.autoDropDuplicates, set: setters.setAutoDropDuplicates,
              }].map((item) => (
                <label key={item.label} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                  <input type="checkbox" checked={item.checked} onChange={(e) => item.set(e.target.checked)}
                    className="mt-0.5 size-4 rounded border-gray-300 text-green-600 focus:ring-green-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.label}</p>
                    <p className="text-xs text-gray-500">{item.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {cleaningTab === 'manual' && (
            <div className="space-y-2">
              {/* Search Bar for manual cleaning */}
              <div className="mb-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-gray-400" />
                <input
                  type="text"
                  value={columnSearch}
                  onChange={(e) => setColumnSearch(e.target.value)}
                  placeholder="Filter columns..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-gray-200 rounded-md focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Type Conversion */}
              <div className="border border-gray-200 rounded-lg">
                <button onClick={() => setManualSection(manualSection === 'type' ? null : 'type')}
                  className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors text-left font-medium text-gray-900">
                  Type Conversion
                  <ChevronDown className={`size-4 text-gray-500 transition-transform ${manualSection === 'type' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'type' && (
                  <div className="px-3 pb-3 space-y-2 max-h-64 overflow-y-auto customize-scrollbar">
                    {filteredColumns.length === 0 ? <p className="text-xs text-gray-400 text-center py-2">No columns match search</p> :
                      filteredColumns.map((col) => (
                        <div key={col.name} className="flex items-center gap-2">
                          <span className="text-xs font-mono text-gray-700 w-1/3 truncate" title={col.name}>{col.name}</span>
                          <select
                            value={config.typeConversions[col.name] || ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setters.setTypeConversions(prev => {
                                const next = { ...prev };
                                if (v) next[col.name] = v; else delete next[col.name];
                                return next;
                              });
                            }}
                            className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="">Keep ({col.type})</option>
                            <option value="int">Integer</option>
                            <option value="float">Float</option>
                            <option value="str">String</option>
                            <option value="datetime">DateTime</option>
                            <option value="bool">Boolean</option>
                          </select>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>

              {/* Formatting */}
              <div className="border border-gray-200 rounded-lg">
                <button onClick={() => setManualSection(manualSection === 'format' ? null : 'format')}
                  className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors text-left font-medium text-gray-900">
                  Consistent Formatting
                  <ChevronDown className={`size-4 text-gray-500 transition-transform ${manualSection === 'format' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'format' && (
                  <div className="px-3 pb-3 space-y-2">
                    {config.formattingRules.map((rule, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select value={rule.column} onChange={(e) => {
                          const updated = [...config.formattingRules]; updated[i] = { ...rule, column: e.target.value }; setters.setFormattingRules(updated);
                        }} className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded">
                          <option value="">Select column</option>
                          {columns.slice(0, 500).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                        </select>
                        <select value={rule.action} onChange={(e) => {
                          const updated = [...config.formattingRules]; updated[i] = { ...rule, action: e.target.value }; setters.setFormattingRules(updated);
                        }} className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded">
                          <option value="lowercase">Lowercase</option>
                          <option value="uppercase">Uppercase</option>
                          <option value="trim">Trim whitespace</option>
                          <option value="title">Title Case</option>
                        </select>
                        <button onClick={() => setters.setFormattingRules(config.formattingRules.filter((_, j) => j !== i))}
                          className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="size-3.5" /></button>
                      </div>
                    ))}
                    <button onClick={() => setters.setFormattingRules([...config.formattingRules, { column: '', action: 'lowercase' }])}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"><Plus className="size-3" /> Add formatting rule</button>
                  </div>
                )}
              </div>

              {/* Validation Rules */}
              <div className="border border-gray-200 rounded-lg">
                <button onClick={() => setManualSection(manualSection === 'validation' ? null : 'validation')}
                  className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors text-left font-medium text-gray-900">
                  Data Validation
                  <ChevronDown className={`size-4 text-gray-500 transition-transform ${manualSection === 'validation' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'validation' && (
                  <div className="px-3 pb-3 space-y-2">
                    <p className="text-xs text-gray-500">Rows failing validation will be removed</p>
                    {config.validationRules.map((rule, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select value={rule.column} onChange={(e) => {
                          const updated = [...config.validationRules]; updated[i] = { ...rule, column: e.target.value }; setters.setValidationRules(updated);
                        }} className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded">
                          <option value="">Column</option>
                          {columns.slice(0, 500).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                        </select>
                        <select value={rule.rule} onChange={(e) => {
                          const updated = [...config.validationRules]; updated[i] = { ...rule, rule: e.target.value }; setters.setValidationRules(updated);
                        }} className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded">
                          <option value="min_value">Min value ≥</option>
                          <option value="max_value">Max value ≤</option>
                          <option value="after_column">Date after column</option>
                        </select>
                        <input value={rule.value} onChange={(e) => {
                          const updated = [...config.validationRules]; updated[i] = { ...rule, value: e.target.value }; setters.setValidationRules(updated);
                        }} placeholder={rule.rule === 'after_column' ? 'column name' : 'value'}
                          className="w-24 px-2 py-1 text-xs border border-gray-300 rounded" />
                        <button onClick={() => setters.setValidationRules(config.validationRules.filter((_, j) => j !== i))}
                          className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="size-3.5" /></button>
                      </div>
                    ))}
                    <button onClick={() => setters.setValidationRules([...config.validationRules, { column: '', rule: 'min_value', value: '0' }])}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"><Plus className="size-3" /> Add validation rule</button>
                  </div>
                )}
              </div>

              {/* Filter Data */}
              <div className="border border-gray-200 rounded-lg">
                <button onClick={() => setManualSection(manualSection === 'filter' ? null : 'filter')}
                  className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors text-left font-medium text-gray-900">
                  Filter Data
                  <ChevronDown className={`size-4 text-gray-500 transition-transform ${manualSection === 'filter' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'filter' && (
                  <div className="px-3 pb-3 space-y-4">
                    {/* Exclude Columns */}
                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-2">Exclude Columns</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-1 max-h-48 overflow-y-auto customize-scrollbar border border-gray-100 p-2 rounded">
                        {filteredColumns.length === 0 ? <p className="text-xs text-gray-400 text-center py-2 col-span-full">No columns match search</p> :
                          filteredColumns.map((col) => (
                            <label key={col.name} className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                              <input type="checkbox" checked={config.excludeColumns.includes(col.name)}
                                onChange={(e) => {
                                  if (e.target.checked) setters.setExcludeColumns([...config.excludeColumns, col.name]);
                                  else setters.setExcludeColumns(config.excludeColumns.filter(c => c !== col.name));
                                }}
                                className="size-3 rounded border-gray-300 text-red-600 focus:ring-red-500" />
                              <span className="font-mono truncate" title={col.name}>{col.name}</span>
                            </label>
                          ))
                        }
                      </div>
                    </div>
                    {/* Row Filters */}
                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-2">Row Filters (keep rows matching)</p>
                      {config.rowFilters.map((flt, i) => (
                        <div key={i} className="flex items-center gap-2 mb-1">
                          <select value={flt.column} onChange={(e) => {
                            const updated = [...config.rowFilters]; updated[i] = { ...flt, column: e.target.value }; setters.setRowFilters(updated);
                          }} className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded">
                            <option value="">Column</option>
                            {columns.slice(0, 500).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                          </select>
                          <select value={flt.op} onChange={(e) => {
                            const updated = [...config.rowFilters]; updated[i] = { ...flt, op: e.target.value }; setters.setRowFilters(updated);
                          }} className="w-16 px-2 py-1 text-xs border border-gray-300 rounded">
                            <option value="==">=</option>
                            <option value="!=">≠</option>
                            <option value=">">&gt;</option>
                            <option value="<">&lt;</option>
                            <option value=">=">≥</option>
                            <option value="<=">≤</option>
                            <option value="contains">contains</option>
                          </select>
                          <input value={flt.value} onChange={(e) => {
                            const updated = [...config.rowFilters]; updated[i] = { ...flt, value: e.target.value }; setters.setRowFilters(updated);
                          }} placeholder="value" className="w-24 px-2 py-1 text-xs border border-gray-300 rounded" />
                          <button onClick={() => setters.setRowFilters(config.rowFilters.filter((_, j) => j !== i))}
                            className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="size-3.5" /></button>
                        </div>
                      ))}
                      <button onClick={() => setters.setRowFilters([...config.rowFilters, { column: '', op: '==', value: '' }])}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"><Plus className="size-3" /> Add row filter</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});