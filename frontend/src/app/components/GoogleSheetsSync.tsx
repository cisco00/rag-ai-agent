/**
 * GoogleSheetsSync — Feature #8: Google Sheets / Excel Live Sync
 *
 * Shows a management page for all sheet syncs:
 *  - Connect Google account via OAuth popup
 *  - Create syncs from a query + sheet config
 *  - Run manually, view last-run status
 *  - Delete syncs
 *
 * Also exports <SyncToSheetButton> for inline use in QueryInterface.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Sheet, RefreshCw, Plus, Trash2, Play, CheckCircle,
  XCircle, Clock, ExternalLink, AlertCircle, Link, Loader2, FileSpreadsheet,
} from 'lucide-react';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SheetSync {
  id: number;
  name: string;
  query_text: string;
  spreadsheet_id: string;
  spreadsheet_url: string;
  worksheet_name: string;
  cron_schedule: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_row_count: number | null;
  is_active: boolean;
  created_at: string;
}

interface GoogleTokens {
  access_token: string;
  refresh_token: string;
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────

async function launchOAuthPopup(): Promise<GoogleTokens> {
  const { url } = await api.get<{ url: string }>('/sheets/auth-url');

  return new Promise((resolve, reject) => {
    const width = 600, height = 700;
    const left  = window.screenX + (window.outerWidth  - width)  / 2;
    const top   = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(url, 'google-oauth', `width=${width},height=${height},left=${left},top=${top}`);

    if (!popup) {
      reject(new Error('Popup blocked. Allow popups for this site.'));
      return;
    }

    // The popup redirects back to GOOGLE_REDIRECT_URI which should post a message
    const onMessage = async (e: MessageEvent) => {
      if (e.data?.type !== 'google-oauth-code') return;
      window.removeEventListener('message', onMessage);
      popup.close();
      try {
        const tokens = await api.post<GoogleTokens>('/sheets/exchange-code', { code: e.data.code });
        resolve(tokens);
      } catch (err: any) {
        reject(err);
      }
    };
    window.addEventListener('message', onMessage);

    // Fallback: poll for popup close
    const poll = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(poll);
        window.removeEventListener('message', onMessage);
        reject(new Error('OAuth popup closed without completing sign-in.'));
      }
    }, 1000);
  });
}

// ── CreateSyncModal ────────────────────────────────────────────────────────────

interface CreateSyncModalProps {
  tokens: GoogleTokens;
  initialQuery?: string;
  onCreated: (sync: SheetSync) => void;
  onClose: () => void;
}

function CreateSyncModal({ tokens, initialQuery, onCreated, onClose }: CreateSyncModalProps) {
  const [name, setName] = useState(initialQuery ? initialQuery.slice(0, 50) : '');
  const [query, setQuery] = useState(initialQuery || '');
  const [sheetMode, setSheetMode] = useState<'new' | 'existing'>('new');
  const [sheetName, setSheetName] = useState('Vantage Data');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [worksheetName, setWorksheetName] = useState('Vantage Sync');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !query.trim()) return;
    setSaving(true);
    try {
      const body: any = {
        name: name.trim(),
        query_text: query.trim(),
        worksheet_name: worksheetName.trim() || 'Vantage Sync',
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
      };
      if (sheetMode === 'new') {
        body.spreadsheet_name = sheetName.trim() || name.trim();
      } else {
        body.spreadsheet_id = spreadsheetId.trim();
      }
      const res = await api.post<{ sync: SheetSync }>('/sheets/syncs', body);
      onCreated(res.sync);
    } catch (e: any) {
      alert(e.message || 'Failed to create sync');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-green-600" />
            <h2 className="text-lg font-bold text-gray-900">New Sheet Sync</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Sync Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Weekly Sales Report"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" autoFocus />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">SQL / Natural Language Query *</label>
            <textarea rows={3} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="SELECT * FROM sales WHERE date >= date('now', '-30 days')"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none resize-none font-mono" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Destination Sheet</label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm mb-3">
              {(['new', 'existing'] as const).map(m => (
                <button key={m} onClick={() => setSheetMode(m)}
                  className={`flex-1 py-2 font-medium transition-colors ${sheetMode === m ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {m === 'new' ? '+ Create New Sheet' : 'Use Existing Sheet'}
                </button>
              ))}
            </div>

            {sheetMode === 'new' ? (
              <input value={sheetName} onChange={e => setSheetName(e.target.value)} placeholder="New spreadsheet name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
            ) : (
              <input value={spreadsheetId} onChange={e => setSpreadsheetId(e.target.value)}
                placeholder="Spreadsheet ID (from the URL: /d/XXXXXXXXXXX/edit)"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none font-mono" />
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Worksheet / Tab Name</label>
            <input value={worksheetName} onChange={e => setWorksheetName(e.target.value)} placeholder="Vantage Sync"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={handleSave} disabled={saving || !name.trim() || !query.trim()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
            <FileSpreadsheet className="size-4" />
            {saving ? 'Creating…' : 'Create Sync'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── SyncCard ──────────────────────────────────────────────────────────────────

function SyncCard({ sync, onRun, onDelete }: {
  sync: SheetSync;
  onRun: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    await onRun(sync.id);
    setRunning(false);
  };

  const statusIcon = () => {
    if (!sync.last_run_status) return <Clock className="size-4 text-gray-400" />;
    if (sync.last_run_status === 'success') return <CheckCircle className="size-4 text-green-500" />;
    return <XCircle className="size-4 text-red-500" />;
  };

  const relTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <FileSpreadsheet className="size-4 text-green-600 shrink-0" />
            <h3 className="font-semibold text-gray-900 truncate">{sync.name}</h3>
          </div>
          <p className="text-xs text-gray-500 font-mono truncate mb-2">{sync.query_text}</p>
          <div className="flex items-center gap-3 flex-wrap">
            {sync.spreadsheet_url && (
              <a href={sync.spreadsheet_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-green-600 hover:underline">
                <ExternalLink className="size-3" />
                Open Sheet
              </a>
            )}
            <span className="text-xs text-gray-400">Tab: <span className="font-medium text-gray-600">{sync.worksheet_name}</span></span>
            {sync.cron_schedule && (
              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{sync.cron_schedule}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleRun} disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100 disabled:opacity-50 transition-colors">
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {running ? 'Running…' : 'Sync Now'}
          </button>
          <button onClick={() => onDelete(sync.id)}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {/* Last run status */}
      {sync.last_run_at && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-500">
          {statusIcon()}
          <span>Last run {relTime(sync.last_run_at)}</span>
          {sync.last_run_status === 'success' && sync.last_row_count != null && (
            <span className="text-green-600">· {sync.last_row_count} rows written</span>
          )}
          {sync.last_run_status && sync.last_run_status !== 'success' && (
            <span className="text-red-500 truncate max-w-[200px]">· {sync.last_run_status}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

interface GoogleSheetsSyncProps {
  initialQuery?: string;
}

export function GoogleSheetsSync({ initialQuery }: GoogleSheetsSyncProps) {
  const [syncs, setSyncs] = useState<SheetSync[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverConfigured, setServerConfigured] = useState(false);
  const [tokens, setTokens] = useState<GoogleTokens | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const loadSyncs = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, syncsRes] = await Promise.all([
        api.get<{ configured: boolean }>('/sheets/status'),
        api.get<{ syncs: SheetSync[] }>('/sheets/syncs'),
      ]);
      setServerConfigured(statusRes.configured);
      setSyncs(syncsRes.syncs);
    } catch (e) {
      console.error('Failed to load sheets', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSyncs(); }, [loadSyncs]);

  const handleConnect = async () => {
    if (!serverConfigured) return;
    setConnecting(true);
    try {
      const t = await launchOAuthPopup();
      setTokens(t);
      setShowCreate(true);
    } catch (e: any) {
      alert(e.message || 'Failed to connect Google account');
    }
    setConnecting(false);
  };

  const handleRun = async (id: number) => {
    try {
      await api.post(`/sheets/syncs/${id}/run`);
      await loadSyncs();
    } catch (e: any) {
      alert(e.message || 'Sync failed');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this sync?')) return;
    try {
      await api.delete(`/sheets/syncs/${id}`);
      setSyncs(prev => prev.filter(s => s.id !== id));
    } catch (e: any) {
      alert(e.message || 'Failed to delete');
    }
  };

  const handleCreated = (sync: SheetSync) => {
    setSyncs(prev => [sync, ...prev]);
    setShowCreate(false);
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <FileSpreadsheet className="size-6 text-green-600" />
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Google Sheets Sync</h1>
          </div>
          <p className="text-sm text-gray-500">Push query results to Google Sheets and keep them fresh automatically.</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={loadSyncs} className="p-2 text-gray-400 hover:text-blue-600 transition-colors" title="Refresh">
            <RefreshCw className={`size-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {tokens ? (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors text-sm">
              <Plus className="size-4" /> New Sync
            </button>
          ) : (
            <button onClick={handleConnect} disabled={connecting || !serverConfigured}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 disabled:opacity-50 transition-colors text-sm">
              {connecting ? <Loader2 className="size-4 animate-spin" /> : <Link className="size-4" />}
              {connecting ? 'Connecting…' : 'Connect Google'}
            </button>
          )}
        </div>
      </div>

      {/* Server not configured notice */}
      {!serverConfigured && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 flex items-start gap-3">
          <AlertCircle className="size-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-800 text-sm">Google OAuth not configured</p>
            <p className="text-xs text-amber-600 mt-1">
              Set <code className="bg-amber-100 px-1 rounded">GOOGLE_CLIENT_ID</code> and{' '}
              <code className="bg-amber-100 px-1 rounded">GOOGLE_CLIENT_SECRET</code> environment variables,
              then restart the backend. You'll also need to register{' '}
              <code className="bg-amber-100 px-1 rounded">/sheets/callback</code> as an OAuth redirect URI
              in your Google Cloud Console.
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-green-600" />
        </div>
      )}

      {/* Empty state */}
      {!loading && syncs.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
          <FileSpreadsheet className="size-12 text-gray-300 mx-auto mb-4" />
          <h3 className="font-semibold text-gray-700 mb-1">No syncs yet</h3>
          <p className="text-sm text-gray-400 mb-6 max-w-sm mx-auto">
            Connect your Google account to start pushing query results directly to Google Sheets.
          </p>
          {serverConfigured && (
            <button onClick={handleConnect} disabled={connecting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 text-sm transition-colors">
              <Link className="size-4" />
              Connect Google Account
            </button>
          )}
        </div>
      )}

      {/* Sync list */}
      {syncs.length > 0 && (
        <div className="space-y-3">
          {syncs.map(sync => (
            <SyncCard key={sync.id} sync={sync} onRun={handleRun} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && tokens && (
        <CreateSyncModal
          tokens={tokens}
          initialQuery={initialQuery}
          onCreated={handleCreated}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

// ── SyncToSheetButton — inline button for QueryInterface ─────────────────────

interface SyncToSheetButtonProps {
  query: string;
  onNavigateToSheets: (query: string) => void;
}

export function SyncToSheetButton({ query, onNavigateToSheets }: SyncToSheetButtonProps) {
  return (
    <button
      onClick={() => onNavigateToSheets(query)}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
      title="Sync to Google Sheets"
    >
      <FileSpreadsheet className="size-3.5" />
      Sync to Sheets
    </button>
  );
}
