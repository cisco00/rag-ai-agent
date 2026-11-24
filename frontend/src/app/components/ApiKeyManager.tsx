/**
 * ApiKeyManager — API key management page for power users / developers.
 *
 * Shows the organization's API key (masked by default), allows copying it,
 * and lets admins regenerate it with a confirmation step.
 *
 * The org-level API key is the same key used in X-API-Key headers for every
 * REST call. Use it in curl, Python scripts, or any HTTP client.
 */

import { useState, useEffect } from 'react';
import {
  Key, Copy, Check, RefreshCw, Eye, EyeOff, AlertTriangle,
  Terminal, Code2, ExternalLink, ShieldCheck,
} from 'lucide-react';
import { api } from '../../lib/api';

interface ApiKeyData {
  api_key: string;
  org_name: string;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 6) + '••••••••••••••••••••' + key.slice(-4);
}

const EXAMPLE_CURL = (key: string, base: string) =>
  `curl -H "X-API-Key: ${key}" \\
  "${base}/schema/diagram"`;

const EXAMPLE_PYTHON = (key: string, base: string) =>
  `import requests

API_KEY = "${key}"
BASE_URL = "${base}"
HEADERS = {"X-API-Key": API_KEY}

# Run a natural-language query
resp = requests.post(
    f"{BASE_URL}/query",
    json={"query": "Show me total revenue by month"},
    headers=HEADERS,
)
print(resp.json()["text"])`;

export function ApiKeyManager() {
  const [data, setData]           = useState<ApiKeyData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [revealed, setRevealed]   = useState(false);
  const [copied, setCopied]       = useState(false);
  const [copiedEx, setCopiedEx]   = useState<'curl' | 'python' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenSuccess, setRegenSuccess] = useState(false);

  const baseUrl: string =
    (window as any).__VANTAGE_API_URL__ ||
    (import.meta as any).env?.VITE_API_URL ||
    'http://localhost:8000';

  useEffect(() => {
    api.get('/auth/api-key')
      .then((d: ApiKeyData) => setData(d))
      .catch((e: any) => setError(e?.message || 'Failed to load API key'))
      .finally(() => setLoading(false));
  }, []);

  async function copyKey() {
    if (!data) return;
    await navigator.clipboard.writeText(data.api_key).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyExample(type: 'curl' | 'python') {
    if (!data) return;
    const text = type === 'curl'
      ? EXAMPLE_CURL(data.api_key, baseUrl)
      : EXAMPLE_PYTHON(data.api_key, baseUrl);
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopiedEx(type);
    setTimeout(() => setCopiedEx(null), 2000);
  }

  async function doRegenerate() {
    setRegenerating(true);
    try {
      const d: ApiKeyData = await api.post('/auth/api-key/regenerate', {});
      setData(d);
      setRegenSuccess(true);
      setConfirming(false);
      setRevealed(true);
      setTimeout(() => setRegenSuccess(false), 4000);
    } catch (e: any) {
      setError(e?.message || 'Failed to regenerate');
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className="size-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertTriangle className="size-8 text-red-400 mx-auto mb-2" />
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  const displayKey = data
    ? (revealed ? data.api_key : maskKey(data.api_key))
    : '';

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2.5 bg-blue-50 rounded-xl">
            <Key className="size-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">API Key</h1>
            <p className="text-sm text-gray-500">
              Use this key to query Vantage AI programmatically from any HTTP client.
            </p>
          </div>
        </div>
      </div>

      {/* Success banner */}
      {regenSuccess && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-800 text-sm font-medium">
          <ShieldCheck className="size-5 text-green-600 shrink-0" />
          New API key generated. Update any integrations that use the old key.
        </div>
      )}

      {/* Key card */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Organization</p>
            <p className="font-bold text-gray-900 mt-0.5">{data?.org_name}</p>
          </div>
          <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-2.5 py-1 rounded-full border border-blue-100">
            Active
          </span>
        </div>

        {/* Key display */}
        <div className="px-5 py-5">
          <label className="block text-xs text-gray-400 uppercase font-bold tracking-wider mb-2">
            API Key
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 font-mono text-sm bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 overflow-x-auto break-all select-all">
              {displayKey}
            </div>
            <button
              onClick={() => setRevealed(r => !r)}
              className="p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors shrink-0"
              title={revealed ? 'Hide key' : 'Show key'}
            >
              {revealed ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            <button
              onClick={copyKey}
              className="p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors shrink-0"
              title="Copy key"
            >
              {copied ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Pass this as the <code className="bg-gray-100 px-1 rounded">X-API-Key</code> header in every request.
          </p>
        </div>

        {/* Regenerate section */}
        <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {!confirming ? (
            <>
              <div>
                <p className="text-sm font-medium text-gray-700">Regenerate API key</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Immediately invalidates the current key.
                </p>
              </div>
              <button
                onClick={() => setConfirming(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-white transition-colors shrink-0"
              >
                <RefreshCw size={15} />
                Regenerate
              </button>
            </>
          ) : (
            <div className="w-full">
              <div className="flex items-start gap-3 mb-3">
                <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-gray-700">
                  <strong>This will immediately invalidate the current key.</strong> Any scripts,
                  dashboards or integrations using it will stop working until you update them.
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirming(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={doRegenerate}
                  disabled={regenerating}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {regenerating
                    ? <><RefreshCw size={14} className="animate-spin" /> Regenerating…</>
                    : <><RefreshCw size={14} /> Yes, regenerate</>
                  }
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Code examples */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Code2 className="size-5 text-gray-500" />
          <h2 className="font-bold text-gray-900">Usage examples</h2>
        </div>

        {/* curl */}
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">curl</span>
            </div>
            <button
              onClick={() => copyExample('curl')}
              className="text-xs flex items-center gap-1 text-gray-400 hover:text-gray-700 transition-colors"
            >
              {copiedEx === 'curl' ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
              {copiedEx === 'curl' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="text-xs font-mono bg-gray-950 text-green-400 rounded-xl p-4 overflow-x-auto leading-relaxed">
            {data ? EXAMPLE_CURL(revealed ? data.api_key : maskKey(data.api_key), baseUrl) : ''}
          </pre>
        </div>

        {/* Python */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Code2 size={14} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">Python</span>
            </div>
            <button
              onClick={() => copyExample('python')}
              className="text-xs flex items-center gap-1 text-gray-400 hover:text-gray-700 transition-colors"
            >
              {copiedEx === 'python' ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
              {copiedEx === 'python' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="text-xs font-mono bg-gray-950 text-blue-300 rounded-xl p-4 overflow-x-auto leading-relaxed">
            {data ? EXAMPLE_PYTHON(revealed ? data.api_key : maskKey(data.api_key), baseUrl) : ''}
          </pre>
        </div>
      </div>

      {/* Docs hint */}
      <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <ExternalLink className="size-4 text-blue-500 shrink-0" />
        <p className="text-sm text-blue-700">
          <strong>REST API base:</strong>{' '}
          <code className="font-mono text-xs bg-blue-100 px-1.5 py-0.5 rounded">{baseUrl}</code>
          {' '}— interactive docs at{' '}
          <a
            href={`${baseUrl}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-medium hover:text-blue-900"
          >
            {baseUrl}/docs
          </a>
        </p>
      </div>
    </div>
  );
}
