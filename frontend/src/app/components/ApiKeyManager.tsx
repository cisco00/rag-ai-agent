import { useState } from 'react';
import { Key, Building2, CheckCircle, Copy, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';

interface ApiKeyManagerProps {
  onApiKeySet: (key: string) => void;
  existingKey?: string;
}

export function ApiKeyManager({ onApiKeySet, existingKey }: ApiKeyManagerProps) {
  const [isRegistering, setIsRegistering] = useState(!existingKey);
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState(existingKey || '');
  const [isLoading, setIsLoading] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = async () => {
    if (!orgName.trim() || !email.trim()) {
      setError('Organization Name and Email are required.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await api.post<{ api_key: string }>('/register', { name: orgName, email });
      setNewApiKey(response.api_key);
      setApiKeyInput(response.api_key);
    } catch (err: any) {
      setError(err.message || 'Failed to register organization');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      onApiKeySet(apiKeyInput.trim());
    }
  };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(newApiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (existingKey) {
    // Settings view - manage existing key
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="w-full max-w-2xl p-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <div className="flex items-center gap-3 mb-6">
              <Key className="size-8 text-blue-600" />
              <h2 className="text-2xl font-bold text-gray-900">API Key Settings</h2>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Current API Key
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={existingKey}
                    readOnly
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Your API key is stored securely in your browser's local storage.
                </p>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <button
                  onClick={() => {
                    localStorage.removeItem('vantage_api_key');
                    window.location.reload();
                  }}
                  className="px-4 py-2 text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Clear API Key
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="w-full max-w-2xl p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-blue-600 mb-2">Vantage AI</h1>
          <p className="text-gray-600">Commercial Analytics Portal</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
          {/* Toggle */}
          <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => setIsRegistering(true)}
              className={`flex-1 py-2 rounded-md transition-colors ${isRegistering ? 'bg-white shadow-sm' : 'text-gray-600'
                }`}
            >
              Register New Organization
            </button>
            <button
              onClick={() => setIsRegistering(false)}
              className={`flex-1 py-2 rounded-md transition-colors ${!isRegistering ? 'bg-white shadow-sm' : 'text-gray-600'
                }`}
            >
              I Have an API Key
            </button>
          </div>

          {isRegistering ? (
            <div className="space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-200">
                <Building2 className="size-6 text-blue-600" />
                <h2 className="text-xl font-bold text-gray-900">Register Your Organization</h2>
              </div>

              {!newApiKey ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Organization Name
                    </label>
                    <input
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Acme Corporation"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2 mt-4">
                      Admin Email Address
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@acme.com"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm mt-4">
                      <AlertCircle className="size-4" />
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    onClick={handleRegister}
                    disabled={isLoading || !orgName.trim() || !email.trim()}
                    className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium mt-6"
                  >
                    {isLoading ? 'Registering...' : 'Register Organization'}
                  </button>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-600 bg-green-50 p-4 rounded-lg">
                    <CheckCircle className="size-5" />
                    <span className="font-medium">Registration Successful!</span>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Your API Key
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newApiKey}
                        readOnly
                        className="flex-1 px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 font-mono text-sm"
                      />
                      <button
                        onClick={handleCopyKey}
                        className="px-4 py-3 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        {copied ? <CheckCircle className="size-5 text-green-600" /> : <Copy className="size-5" />}
                      </button>
                    </div>
                    <p className="text-sm text-red-600 mt-2">
                      ⚠️ Save this key! You won't be able to see it again.
                    </p>
                  </div>

                  <button
                    onClick={handleSaveApiKey}
                    className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Continue to Dashboard
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-200">
                <Key className="size-6 text-blue-600" />
                <h2 className="text-xl font-bold text-gray-900">Enter Your API Key</h2>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Key
                </label>
                <input
                  type="text"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="vantage_xxxxxxxxxxxxxxxxxx"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                />
              </div>

              <button
                onClick={handleSaveApiKey}
                disabled={!apiKeyInput.trim()}
                className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Continue to Dashboard
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-gray-600 mt-6">
          By continuing, you agree to Vantage AI's Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}
