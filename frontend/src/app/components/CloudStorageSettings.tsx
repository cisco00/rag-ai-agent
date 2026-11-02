import React, { useState, useEffect } from 'react';
import {
    Cloud, Upload, Trash2, CheckCircle2, AlertCircle,
    RefreshCw, Eye, EyeOff, ExternalLink, HardDrive,
    Clock, FileText, Download
} from 'lucide-react';
import { api } from '../../lib/api';

interface StorageConfig {
    provider: string;
    bucket: string;
    region: string;
    endpoint_url?: string;
    access_key: string;
    secret_key: string;
    path_prefix: string;
    is_active: boolean;
}

interface ExportLogEntry {
    id: number;
    file_key: string;
    file_size: number;
    export_type: string;
    status: string;
    error_msg?: string;
    created_at: string;
}

const PROVIDERS = [
    { value: 's3',    label: 'AWS S3',            placeholder: 'us-east-1' },
    { value: 'r2',    label: 'Cloudflare R2',      placeholder: 'auto' },
    { value: 'b2',    label: 'Backblaze B2',        placeholder: 'us-west-004' },
    { value: 'minio', label: 'MinIO (self-hosted)', placeholder: 'us-east-1' },
    { value: 'other', label: 'S3-compatible',       placeholder: 'us-east-1' },
];

function formatBytes(bytes: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CloudStorageSettings() {
    const [configured, setConfigured]   = useState(false);
    const [config, setConfig]           = useState<Partial<StorageConfig>>({
        provider: 's3', region: 'us-east-1', path_prefix: 'vantage-exports/', is_active: true,
    });
    const [showSecret, setShowSecret]   = useState(false);
    const [saving, setSaving]           = useState(false);
    const [testing, setTesting]         = useState(false);
    const [testResult, setTestResult]   = useState<{ ok: boolean; message: string } | null>(null);
    const [error, setError]             = useState<string | null>(null);
    const [success, setSuccess]         = useState<string | null>(null);
    const [exportLog, setExportLog]     = useState<ExportLogEntry[]>([]);
    const [loadingLog, setLoadingLog]   = useState(false);
    const [activeTab, setActiveTab]     = useState<'config' | 'log'>('config');

    useEffect(() => { loadConfig(); }, []);

    const loadConfig = async () => {
        try {
            const data = await api.get<any>('/cloud-storage/config');
            if (data.configured) {
                setConfigured(true);
                setConfig(data.config);
            }
        } catch { /* not configured yet */ }
    };

    const loadLog = async () => {
        setLoadingLog(true);
        try {
            const data = await api.get<any>('/cloud-storage/log');
            setExportLog(data.exports || []);
        } catch {
            setExportLog([]);
        } finally {
            setLoadingLog(false);
        }
    };

    const handleTabChange = (tab: 'config' | 'log') => {
        setActiveTab(tab);
        if (tab === 'log' && exportLog.length === 0) loadLog();
    };

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        setError(null);
        try {
            const result = await api.post<any>('/cloud-storage/test', config);
            setTestResult(result);
        } catch (err: any) {
            setTestResult({ ok: false, message: err?.detail || 'Connection test failed.' });
        } finally {
            setTesting(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSuccess(null);
        try {
            await api.post('/cloud-storage/config', config);
            setConfigured(true);
            setSuccess('Cloud storage configuration saved successfully.');
            setTimeout(() => setSuccess(null), 4000);
        } catch (err: any) {
            setError(err?.detail || 'Failed to save configuration.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Remove cloud storage configuration? Existing exports are not affected.')) return;
        try {
            await api.delete('/cloud-storage/config');
            setConfigured(false);
            setConfig({ provider: 's3', region: 'us-east-1', path_prefix: 'vantage-exports/', is_active: true });
            setSuccess('Configuration removed.');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err: any) {
            setError(err?.detail || 'Failed to remove configuration.');
        }
    };

    const selectedProvider = PROVIDERS.find(p => p.value === config.provider) || PROVIDERS[0];
    const needsEndpoint = ['r2', 'b2', 'minio', 'other'].includes(config.provider || '');

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                        <Cloud className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-white">Cloud Storage</h2>
                        <p className="text-sm text-gray-400">
                            Export query results, PDFs and reports directly to S3-compatible storage
                        </p>
                    </div>
                </div>
                {configured && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-full">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                    </span>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1 w-fit">
                {(['config', 'log'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => handleTabChange(tab)}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                            activeTab === tab
                                ? 'bg-gray-700 text-white'
                                : 'text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        {tab === 'config' ? 'Configuration' : 'Export Log'}
                    </button>
                ))}
            </div>

            {/* Alerts */}
            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
            )}
            {success && (
                <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />{success}
                </div>
            )}

            {/* ── Config Tab ── */}
            {activeTab === 'config' && (
                <div className="space-y-5">
                    {/* Provider */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-gray-300">Provider</label>
                            <select
                                value={config.provider}
                                onChange={e => setConfig(c => ({ ...c, provider: e.target.value }))}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                            >
                                {PROVIDERS.map(p => (
                                    <option key={p.value} value={p.value}>{p.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-gray-300">Region</label>
                            <input
                                type="text"
                                value={config.region || ''}
                                onChange={e => setConfig(c => ({ ...c, region: e.target.value }))}
                                placeholder={selectedProvider.placeholder}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-gray-500"
                            />
                        </div>
                    </div>

                    {/* Bucket */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-gray-300">Bucket Name</label>
                        <input
                            type="text"
                            value={config.bucket || ''}
                            onChange={e => setConfig(c => ({ ...c, bucket: e.target.value }))}
                            placeholder="my-exports-bucket"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-gray-500"
                        />
                    </div>

                    {/* Custom endpoint (for non-AWS providers) */}
                    {needsEndpoint && (
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-gray-300">
                                Endpoint URL
                                <span className="ml-2 text-xs text-gray-500">
                                    {config.provider === 'r2' && '(e.g. https://<account>.r2.cloudflarestorage.com)'}
                                    {config.provider === 'b2' && '(e.g. https://s3.us-west-004.backblazeb2.com)'}
                                    {config.provider === 'minio' && '(e.g. http://localhost:9000)'}
                                </span>
                            </label>
                            <input
                                type="text"
                                value={config.endpoint_url || ''}
                                onChange={e => setConfig(c => ({ ...c, endpoint_url: e.target.value }))}
                                placeholder="https://..."
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-gray-500"
                            />
                        </div>
                    )}

                    {/* Credentials */}
                    <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-gray-300">
                                {config.provider === 'r2' ? 'Access Key ID' :
                                 config.provider === 'b2' ? 'Key ID' : 'Access Key ID'}
                            </label>
                            <input
                                type="text"
                                value={config.access_key || ''}
                                onChange={e => setConfig(c => ({ ...c, access_key: e.target.value }))}
                                placeholder="AKIAIOSFODNN7EXAMPLE"
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-gray-500"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-gray-300">
                                {config.provider === 'r2' ? 'Secret Access Key' :
                                 config.provider === 'b2' ? 'Application Key' : 'Secret Access Key'}
                            </label>
                            <div className="relative">
                                <input
                                    type={showSecret ? 'text' : 'password'}
                                    value={config.secret_key === '••••••••' ? '' : (config.secret_key || '')}
                                    onChange={e => setConfig(c => ({ ...c, secret_key: e.target.value }))}
                                    placeholder={configured ? '(unchanged)' : 'wJalrXUtnFEMI/K7MDENG/...'}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-10 text-white text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-gray-500"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowSecret(s => !s)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                                >
                                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Path prefix */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-gray-300">
                            Path Prefix
                            <span className="ml-2 text-xs text-gray-500">Files are stored under this prefix</span>
                        </label>
                        <input
                            type="text"
                            value={config.path_prefix || ''}
                            onChange={e => setConfig(c => ({ ...c, path_prefix: e.target.value }))}
                            placeholder="vantage-exports/"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500 placeholder-gray-500"
                        />
                        <p className="text-xs text-gray-500">
                            Files will be stored as: <span className="text-gray-300 font-mono">{config.path_prefix || 'vantage-exports/'}2024/01/15/export.csv</span>
                        </p>
                    </div>

                    {/* Test result */}
                    {testResult && (
                        <div className={`flex items-start gap-2 p-3 rounded-lg text-sm border ${
                            testResult.ok
                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                : 'bg-red-500/10 border-red-500/20 text-red-400'
                        }`}>
                            {testResult.ok
                                ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                                : <AlertCircle  className="w-4 h-4 mt-0.5 shrink-0" />}
                            {testResult.message}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-2">
                        <button
                            onClick={handleTest}
                            disabled={testing || !config.bucket || !config.access_key}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                        >
                            {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                            Test Connection
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || !config.bucket || !config.access_key}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                        >
                            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            Save Configuration
                        </button>
                        {configured && (
                            <button
                                onClick={handleDelete}
                                className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm rounded-lg transition-colors ml-auto"
                            >
                                <Trash2 className="w-4 h-4" /> Remove
                            </button>
                        )}
                    </div>

                    {/* Info box */}
                    <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50 text-sm text-gray-400 space-y-1">
                        <p className="font-medium text-gray-300">How exports work</p>
                        <p>Once configured, you can export any query result (CSV, JSON) or report (PDF, PPTX) directly to your bucket from the Export menu. Each file gets a presigned URL valid for 7 days.</p>
                        <p className="pt-1">Your credentials are encrypted before storage and never logged.</p>
                    </div>
                </div>
            )}

            {/* ── Export Log Tab ── */}
            {activeTab === 'log' && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-400">Recent cloud exports</p>
                        <button onClick={loadLog} className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1">
                            <RefreshCw className="w-3.5 h-3.5" /> Refresh
                        </button>
                    </div>

                    {loadingLog ? (
                        <div className="flex items-center justify-center py-12 text-gray-500">
                            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
                        </div>
                    ) : exportLog.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-gray-500 gap-2">
                            <HardDrive className="w-8 h-8 opacity-40" />
                            <p className="text-sm">No exports yet</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {exportLog.map(entry => (
                                <div
                                    key={entry.id}
                                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                                        entry.status === 'success'
                                            ? 'bg-gray-800/50 border-gray-700/50'
                                            : 'bg-red-500/5 border-red-500/20'
                                    }`}
                                >
                                    <div className={`p-1.5 rounded ${entry.status === 'success' ? 'bg-blue-500/10' : 'bg-red-500/10'}`}>
                                        {entry.status === 'success'
                                            ? <FileText className="w-4 h-4 text-blue-400" />
                                            : <AlertCircle className="w-4 h-4 text-red-400" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-white truncate font-mono">{entry.file_key}</p>
                                        <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                                            <span className="uppercase font-medium text-gray-300">{entry.export_type}</span>
                                            <span>{formatBytes(entry.file_size)}</span>
                                            <span className="flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                {new Date(entry.created_at).toLocaleString()}
                                            </span>
                                        </div>
                                        {entry.error_msg && (
                                            <p className="text-xs text-red-400 mt-1 truncate">{entry.error_msg}</p>
                                        )}
                                    </div>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                        entry.status === 'success'
                                            ? 'bg-emerald-500/10 text-emerald-400'
                                            : 'bg-red-500/10 text-red-400'
                                    }`}>
                                        {entry.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
