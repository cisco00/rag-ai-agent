import { useState, useEffect } from 'react';
import { Database, CheckCircle, AlertCircle, Loader2, Table, Plus, Eye, MessageSquare } from 'lucide-react';
import { api } from '../../lib/api';

interface DatabaseConfigProps {
  apiKey: string;
  onConfigured: () => void;
  onNavigate?: (view: string) => void;
}

export function DatabaseConfig({ onConfigured, onNavigate }: DatabaseConfigProps) {
  const [configMode, setConfigMode] = useState<'existing' | 'create' | 'configured'>('existing');
  const [dbType, setDbType] = useState('postgresql');
  const [connectionString, setConnectionString] = useState('');
  const [currentConnection, setCurrentConnection] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);

  // Create database form
  const [createForm, setCreateForm] = useState({
    newDbName: '',
    newUser: '',
    newPassword: '',
  });

  const dbTypes = [
    { value: 'postgresql', label: 'PostgreSQL', example: 'postgresql://user:password@localhost:5432/dbname' },
    { value: 'mysql', label: 'MySQL', example: 'mysql://user:password@localhost:3306/dbname' },
    { value: 'sqlite', label: 'SQLite', example: 'sqlite:///path/to/database.db' },
    { value: 'mssql', label: 'SQL Server', example: 'mssql+pyodbc://user:password@localhost/dbname' },
  ];

  useEffect(() => {
    const fetchCurrentConfig = async () => {
      try {
        const res = await api.get<{ status: string; connection_string: string }>('/config');
        if (res.connection_string) {
          setCurrentConnection(res.connection_string);
          setConnectionString(res.connection_string);
          setConfigMode('configured');
          setStatus('success');
        }
      } catch (error) {
        console.error('Failed to fetch current DB config', error);
      }
    };
    fetchCurrentConfig();
  }, []);

  useEffect(() => {
    if (configMode === 'existing') {
      const fetchDatabases = async () => {
        try {
          const res = await api.get<{ status: string; databases: string[] }>('/database/available');
          if (res.databases) {
            setAvailableDatabases(res.databases);
          }
        } catch (error) {
          console.error('Failed to fetch available databases', error);
        }
      };
      fetchDatabases();
    }
  }, [configMode]);

  const handleConnect = async () => {
    if (!connectionString.trim()) return;

    setIsLoading(true);
    setStatus('idle');

    try {
      await api.post('/config', { connection_string: connectionString });
      const { tables } = await api.get<{ tables: string[] }>('/tables');
      setTables(tables || []);
      setStatus('success');
      setErrorMessage('');
      onConfigured();
    } catch (error: any) {
      console.error(error);
      setErrorMessage(error.message || 'Connection failed.');
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateDatabase = async () => {
    if (!createForm.newDbName || !createForm.newUser || !createForm.newPassword) {
      return;
    }

    setIsLoading(true);
    setStatus('idle');

    try {
      const payload = {
        new_db_name: createForm.newDbName,
        new_user: createForm.newUser,
        new_password: createForm.newPassword,
      };

      await api.post<any>('/database/create-postgres', payload);
      const mockConnectionString = `postgresql://${createForm.newUser}:[HIDDEN]@localhost:5435/${createForm.newDbName}`;
      setConnectionString(mockConnectionString);

      const { tables } = await api.get<{ tables: string[] }>('/tables');
      setTables(tables || []);

      setStatus('success');
      setErrorMessage('');
      onConfigured();
    } catch (error: any) {
      console.error(error);
      setErrorMessage(error.message || 'Creation failed.');
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreviewTable = async () => {
    if (!selectedTable) return;

    setIsLoading(true);
    try {
      const res = await api.get<{ rows: any[] }>(`/tables/${selectedTable}/preview`);
      setPreviewData(res.rows || []);
      setShowPreview(true);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestConnection = async () => {
    if (!connectionString.trim()) return;

    setIsLoading(true);
    try {
      await api.post('/config', { connection_string: connectionString });
      const { tables } = await api.get<{ tables: string[] }>('/tables');
      setTables(tables || []);
      setStatus('success');
      setErrorMessage('');
    } catch (error: any) {
      console.error(error);
      setErrorMessage(error.message || 'Test failed.');
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  };

  if (status === 'success' && configMode === 'configured') {
    return (
      <div className="p-4 md:p-8 max-w-6xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-6 md:p-12 text-center max-w-2xl mx-auto flex flex-col items-center">
          <div className="flex items-center justify-center size-20 bg-blue-100 rounded-full mb-6 text-blue-600">
            <Database className="size-10" />
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2 md:mb-3">Database Connected</h2>
          <p className="text-sm md:text-base text-gray-600 mb-6 md:mb-8 max-w-md">
            Your organization is currently connected to the following database. You're ready to start analyzing data.
          </p>
          
          <div className="bg-gray-50 p-4 rounded-lg w-full mb-8 border border-gray-100 font-mono text-sm text-gray-700 truncate text-left break-all">
            <span className="font-semibold text-gray-500 mr-2 uppercase text-xs">Connection String</span><br/>
            {currentConnection || connectionString || '••••••••'}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
            {onNavigate && (
              <>
                <button
                  onClick={() => onNavigate('dashboard')}
                  className="px-6 py-3 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                  View Dashboard
                </button>
                <button
                  onClick={() => onNavigate('query')}
                  className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <MessageSquare className="size-5" />
                  Start Querying
                </button>
              </>
            )}
          </div>
          
          <div className="mt-8 pt-6 border-t border-gray-100 w-full">
            <button 
              onClick={() => {
                setConfigMode('existing');
                setStatus('idle');
                setConnectionString(''); 
              }}
              className="text-sm text-gray-500 hover:text-blue-600 underline"
            >
              Connect to a different database
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="p-4 md:p-8 max-w-6xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-6 md:p-12 mt-4 md:mt-12 text-center max-w-2xl mx-auto flex flex-col items-center">
          <div className="flex items-center justify-center size-16 md:size-20 bg-green-100 rounded-full mb-4 md:mb-6 text-green-600">
            <CheckCircle className="size-8 md:size-10" />
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2 md:mb-3">Database Ready!</h2>
          <p className="text-sm md:text-base text-gray-600 mb-6 md:mb-8 max-w-md">
            Your database connection has been successfully configured. You're all set to start querying and analyzing your data.
          </p>
          
          <div className="bg-gray-50 p-4 rounded-lg w-full mb-8 border border-gray-100 font-mono text-sm text-gray-700 truncate text-left break-all">
            <span className="font-semibold text-gray-500 mr-2 uppercase text-xs">Connection String</span><br/>
            {connectionString || '••••••••'}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
            {onNavigate && (
              <>
                <button
                  onClick={() => onNavigate('dashboard')}
                  className="px-6 py-3 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                  View Dashboard
                </button>
                <button
                  onClick={() => onNavigate('query')}
                  className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <MessageSquare className="size-5" />
                  Start Querying
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="w-full">
          {/* Header */}
          <div className="mb-6 md:mb-8">
            <div className="flex items-center gap-3 mb-2 md:mb-3">
              <Database className="size-6 md:size-8 text-blue-600" />
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Config</h1>
            </div>
            <p className="text-sm md:text-base text-gray-600">
              Connect your database or create a new PostgreSQL database.
            </p>
          </div>

          {/* Mode Toggle */}
          <div className="bg-white rounded-xl border border-gray-200 p-1.5 mb-6 inline-flex flex-col sm:flex-row w-full sm:w-auto">
            <button
              onClick={() => { setConfigMode('existing'); setStatus('idle'); }}
              className={`px-4 md:px-6 py-2 rounded-lg transition-colors text-sm md:text-base ${configMode === 'existing'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
              Existing DB
            </button>
            <button
              onClick={() => { setConfigMode('create'); setStatus('idle'); }}
              className={`px-4 md:px-6 py-2 rounded-lg transition-colors text-sm md:text-base ${configMode === 'create'
                ? 'bg-blue-600 text-white shadow-sm'
            : 'text-gray-600 hover:bg-gray-100'
            }`}
        >
          <Plus className="size-4 inline mr-1 md:mr-2" />
          Create New
        </button>
      </div>

      {configMode === 'existing' ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-6">
          {/* Database Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Database Type
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
              {dbTypes.map((type) => (
                <button
                  key={type.value}
                  onClick={() => {
                    setDbType(type.value);
                    setConnectionString(type.example);
                    setStatus('idle');
                  }}
                  className={`p-3 md:p-4 rounded-xl border-2 transition-all ${dbType === type.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                    }`}
                >
                  <Database className="size-5 md:size-6 mx-auto mb-1 md:mb-2 text-gray-600" />
                  <p className="text-xs md:text-sm font-medium text-gray-900">{type.label}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Connection String */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Connection String
            </label>
            <textarea
              value={connectionString}
              onChange={(e) => {
                setConnectionString(e.target.value);
                setStatus('idle');
              }}
              placeholder="Enter your database connection string..."
              rows={3}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-2">
              Example: {dbTypes.find(t => t.value === dbType)?.example}
            </p>
          </div>

          {/* Available Databases / History */}
          {availableDatabases.length > 0 && (
            <div className="pt-4 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Previously Connected Databases
              </label>
              <div className="flex flex-wrap gap-2">
                {availableDatabases.map((db, idx) => (
                  <button
                    key={idx}
                    onClick={() => setConnectionString(db)}
                    className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-blue-50 hover:border-blue-300 transition-colors flex items-center gap-2"
                  >
                    <Database className="size-4 text-blue-500" />
                    <span className="truncate max-w-[250px]">{db}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Status Message */}
          {status === 'error' && (
            <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              <AlertCircle className="size-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Connection Failed</p>
                <p className="text-sm mt-1">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleTestConnection}
              disabled={isLoading || !connectionString.trim()}
              className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Testing...
                </span>
              ) : (
                'Test Connection'
              )}
            </button>
            <button
              onClick={handleConnect}
              disabled={isLoading || !connectionString.trim()}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
            >
              Connect Database
            </button>
          </div>

          {/* Tables List with Preview */}
          {tables.length > 0 && (
            <div className="pt-6 border-t border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Table className="size-5 text-gray-600" />
                  <h3 className="font-bold text-gray-900">Available Tables</h3>
                </div>
                {selectedTable && (
                  <button
                    onClick={handlePreviewTable}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors text-sm font-medium"
                  >
                    <Eye className="size-4" />
                    Preview Table
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {tables.map((table) => (
                  <button
                    key={table}
                    onClick={() => setSelectedTable(table)}
                    className={`px-3 py-2 border-2 rounded text-sm font-mono transition-colors ${selectedTable === table
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300'
                      }`}
                  >
                    {table}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Preview Modal */}
          {showPreview && previewData.length > 0 && (
            <div className="pt-6 border-t border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-900">Preview: {selectedTable}</h3>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ×
                </button>
              </div>
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {Object.keys(previewData[0] || {}).map((key) => (
                        <th
                          key={key}
                          className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
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
                          <td key={i} className="px-4 py-3 text-sm text-gray-900">
                            {String(val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Showing first 5 rows of {selectedTable}
              </p>
            </div>
          )}

          {/* Info Box */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">Security Note</h4>
            <p className="text-sm text-blue-800">
              Your connection string is stored securely and encrypted. We recommend using read-only database credentials for safety.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-6">
          <div className="flex items-center gap-2 mb-4">
            <Plus className="size-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">Create New Database User</h2>
          </div>
          <p className="text-sm text-gray-500 mb-6">Create a dedicated user for an existing database or provision a brand new database.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Database Name *
              </label>
              <input
                type="text"
                value={createForm.newDbName}
                onChange={(e) => setCreateForm({ ...createForm, newDbName: e.target.value })}
                placeholder="my_analytics_db"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm md:text-base"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New User *
              </label>
              <input
                type="text"
                value={createForm.newUser}
                onChange={(e) => setCreateForm({ ...createForm, newUser: e.target.value })}
                placeholder="analytics_user"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm md:text-base"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New User Password *
              </label>
              <input
                type="password"
                value={createForm.newPassword}
                onChange={(e) => setCreateForm({ ...createForm, newPassword: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm md:text-base"
                required
              />
            </div>
          </div>

          {status === 'error' && (
            <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              <AlertCircle className="size-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Creation Failed</p>
                <p className="text-sm mt-1">{errorMessage}</p>
              </div>
            </div>
          )}

          <button
            onClick={handleCreateDatabase}
            disabled={isLoading || !createForm.newDbName || !createForm.newUser || !createForm.newPassword}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Creating Database...
              </span>
            ) : (
              'Create Database & User'
            )}
          </button>

          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <h4 className="font-medium text-purple-900 mb-2">What happens next?</h4>
            <ul className="text-sm text-purple-800 space-y-1">
              <li>• A new PostgreSQL database will be created</li>
              <li>• A dedicated user with full permissions will be set up</li>
              <li>• The connection string will be generated automatically</li>
              <li>• Your database will be ready for data import and queries</li>
            </ul>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}