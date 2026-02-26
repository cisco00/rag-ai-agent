import { useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, X, FileSpreadsheet, Search, ChevronRight, Server } from 'lucide-react';
import { api } from '../../lib/api';

interface FileImportProps {
  apiKey: string;
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

export function FileImport({ }: FileImportProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [importMode, setImportMode] = useState<'single' | 'batch'>('single');
  const [ifExists, setIfExists] = useState('replace');
  const [importedFiles, setImportedFiles] = useState<ImportedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [fileAnalysis, setFileAnalysis] = useState<FileAnalysis | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisFile, setAnalysisFile] = useState<File | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Tabs and API Import State
  const [activeTab, setActiveTab] = useState<'file' | 'batch' | 'api'>('file');
  const [apiUrl, setApiUrl] = useState('');
  const [apiMethod, setApiMethod] = useState<'GET' | 'POST'>('GET');
  const [apiTargetTable, setApiTargetTable] = useState('');

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
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      handleFiles(files);
    }
  };

  const handleAnalyzeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAnalysisFile(file);
      setIsUploading(true);
      setAnalysisError(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await api.post<any>('/analyze-file', formData);

        const fileAnalysisData: FileAnalysis = {
          fileName: res.filename,
          columns: res.columns.map((c: any) => c.name),
          missingValues: res.missing_values || {},
          totalRows: res.row_count,
          dataTypes: res.columns.reduce((acc: any, c: any) => ({ ...acc, [c.name]: c.type }), {}),
        };

        setFileAnalysis(fileAnalysisData);
        setShowAnalysis(true);
      } catch (err: any) {
        console.error('Analysis failed', err);
        setAnalysisError(err.message || 'File analysis failed. Please check the format.');
      } finally {
        setIsUploading(false);
        // Reset file input target
        e.target.value = '';
      }
    }
  };

  const handleImportAnalyzedFile = () => {
    if (analysisFile) {
      handleFiles([analysisFile]);
      setShowAnalysis(false);
      setFileAnalysis(null);
      setAnalysisFile(null);
    }
  };

  const handleFiles = async (files: File[]) => {
    setIsUploading(true);

    try {
      if (importMode === 'single' || files.length === 1) {
        const formData = new FormData();
        formData.append('file', files[0]);
        formData.append('if_exists', ifExists);

        const res = await api.post<any>('/import', formData);
        setImportedFiles(prev => [...prev, {
          name: files[0].name,
          status: 'success',
          rows: res.rows_imported,
          tableName: res.table_name,
        }]);
      } else {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f));
        formData.append('if_exists', ifExists);

        const res = await api.post<any>('/import/batch', formData);

        const results = res.files.map((r: any) => ({
          name: r.filename,
          status: r.status === 'success' ? 'success' : 'error',
          rows: r.rows_imported,
          tableName: r.table_name,
          message: r.error || r.status
        }));

        setImportedFiles(prev => [...prev, ...results]);
      }
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
  };

  const removeFile = (index: number) => {
    setImportedFiles(importedFiles.filter((_, i) => i !== index));
  };

  const handleApiImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiUrl || !apiTargetTable) return;
    setIsUploading(true);
    try {
      const res = await api.post<any>('/import/api', {
        url: apiUrl,
        method: apiMethod,
        table_name: apiTargetTable,
        if_exists: ifExists,
        headers: {} // Can add UI for headers later
      });
      setImportedFiles(prev => [...prev, {
        name: `API: ${apiUrl}`,
        status: 'success',
        message: res.message,
        tableName: apiTargetTable
      }]);
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

                <div className="pt-4 border-t border-gray-100 flex justify-end">
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
                    setAnalysisFile(null);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <p className="text-sm text-gray-600 mb-2">File: {fileAnalysis.fileName}</p>
                  <p className="text-sm text-gray-600">Total Rows: {fileAnalysis.totalRows.toLocaleString()}</p>
                </div>

                <div>
                  <h4 className="font-medium text-gray-900 mb-3">Columns ({fileAnalysis.columns.length})</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {fileAnalysis.columns.map((col) => (
                      <div
                        key={col}
                        className="px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm"
                      >
                        <p className="font-mono text-gray-900">{col}</p>
                        <p className="text-xs text-gray-500">{fileAnalysis.dataTypes[col]}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {Object.keys(fileAnalysis.missingValues).length > 0 && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3">Missing Values</h4>
                    <div className="space-y-2">
                      {Object.entries(fileAnalysis.missingValues).map(([col, count]) => (
                        <div key={col} className="flex items-center justify-between p-3 bg-orange-50 border border-orange-200 rounded">
                          <span className="text-sm font-mono text-gray-900">{col}</span>
                          <span className="text-sm font-bold text-orange-600">
                            {count} missing ({((count / fileAnalysis.totalRows) * 100).toFixed(1)}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleImportAnalyzedFile}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Proceed with Import
                </button>
              </div>
            </div>
          )}

          {/* Import Results */}
          {importedFiles.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-900">Imported Files ({importedFiles.length})</h3>
                <button
                  onClick={() => setImportedFiles([])}
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Clear All
                </button>
              </div>
              <div className="space-y-3">
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