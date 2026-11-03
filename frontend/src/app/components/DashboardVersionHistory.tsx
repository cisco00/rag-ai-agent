/**
 * DashboardVersionHistory — slide-in panel showing saved snapshots.
 *
 * Usage:
 *   <DashboardVersionHistory
 *     dashboardId={id}
 *     onClose={() => setShowHistory(false)}
 *     onRestored={(dash, cards) => { ... }}
 *   />
 */

import { useEffect, useState, useCallback } from 'react';
import {
  History, X, Save, RotateCcw, Loader2, AlertCircle,
  Clock, CheckCircle2, ChevronRight,
} from 'lucide-react';
import { api } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Snapshot {
  id: number;
  dashboard_id: number;
  label?: string;
  created_by?: number;
  created_at: string;
}

interface DashboardVersionHistoryProps {
  dashboardId: number;
  onClose: () => void;
  /** Called after a successful restore with the refreshed dashboard + cards. */
  onRestored: (dashboard: any, cards: any[]) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
  } catch { return iso; }
}

function fullDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(iso));
  } catch { return iso; }
}

function isAutoSave(label: string | undefined | null): boolean {
  return !!(label?.startsWith('Auto-save'));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DashboardVersionHistory({
  dashboardId,
  onClose,
  onRestored,
}: DashboardVersionHistoryProps) {
  const [snapshots, setSnapshots]     = useState<Snapshot[]>([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [error, setError]             = useState('');
  const [successId, setSuccessId]     = useState<number | null>(null);

  // ── Fetch snapshots ──────────────────────────────────────────────────────

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get<{ snapshots: Snapshot[] }>(`/dashboards/${dashboardId}/snapshots`)
      .then(d => setSnapshots(d.snapshots || []))
      .catch(err => setError(err.message || 'Failed to load history'))
      .finally(() => setLoading(false));
  }, [dashboardId]);

  useEffect(() => { load(); }, [load]);

  // ── Save now ──────────────────────────────────────────────────────────────

  const handleSaveNow = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post(`/dashboards/${dashboardId}/snapshots`, {});
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to save snapshot');
    } finally {
      setSaving(false);
    }
  };

  // ── Restore ───────────────────────────────────────────────────────────────

  const handleRestore = async (snap: Snapshot) => {
    if (!confirm(
      `Restore to "${snap.label || fullDate(snap.created_at)}"?\n\n` +
      `The current layout will be auto-saved first so you can undo.`
    )) return;

    setRestoringId(snap.id);
    setError('');
    try {
      const data = await api.post<{ dashboard: any; cards: any[] }>(
        `/dashboards/${dashboardId}/snapshots/${snap.id}/restore`, {}
      );
      setSuccessId(snap.id);
      setTimeout(() => setSuccessId(null), 2500);
      load();
      onRestored(data.dashboard, data.cards);
    } catch (err: any) {
      setError(err.message || 'Restore failed');
    } finally {
      setRestoringId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const manualSnaps = snapshots.filter(s => !isAutoSave(s.label));
  const autoSnaps   = snapshots.filter(s => isAutoSave(s.label));

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2">
          <History className="size-4 text-blue-500" />
          <span className="font-bold text-sm text-slate-800">Version History</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Save now button */}
      <div className="px-4 py-3 border-b border-slate-100">
        <button
          onClick={handleSaveNow}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {saving ? 'Saving…' : 'Save snapshot now'}
        </button>
        <p className="text-[11px] text-slate-400 mt-1.5 text-center">
          Snapshots are also saved automatically on each restore.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs">
          <AlertCircle className="size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-blue-400" />
          </div>
        ) : snapshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2 px-4 text-center">
            <History className="size-10 opacity-30" />
            <p className="text-sm font-medium">No snapshots yet</p>
            <p className="text-xs">Click "Save snapshot now" to record the current layout.</p>
          </div>
        ) : (
          <>
            {manualSnaps.length > 0 && (
              <SnapshotSection
                title="Saved manually"
                items={manualSnaps}
                restoringId={restoringId}
                successId={successId}
                onRestore={handleRestore}
              />
            )}
            {autoSnaps.length > 0 && (
              <SnapshotSection
                title="Auto-saves"
                items={autoSnaps}
                restoringId={restoringId}
                successId={successId}
                onRestore={handleRestore}
                muted
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface SnapshotSectionProps {
  title: string;
  items: Snapshot[];
  restoringId: number | null;
  successId: number | null;
  onRestore: (s: Snapshot) => void;
  muted?: boolean;
}

function SnapshotSection({ title, items, restoringId, successId, onRestore, muted }: SnapshotSectionProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-1.5 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
      >
        <ChevronRight className={`size-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        {title}
        <span className="ml-auto font-normal normal-case tracking-normal text-slate-400">{items.length}</span>
      </button>

      {expanded && (
        <div className="space-y-0.5 px-2">
          {items.map(snap => (
            <SnapshotRow
              key={snap.id}
              snap={snap}
              isRestoring={restoringId === snap.id}
              isSuccess={successId === snap.id}
              onRestore={onRestore}
              muted={muted}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SnapshotRowProps {
  snap: Snapshot;
  isRestoring: boolean;
  isSuccess: boolean;
  onRestore: (s: Snapshot) => void;
  muted?: boolean;
}

function SnapshotRow({ snap, isRestoring, isSuccess, onRestore, muted }: SnapshotRowProps) {
  const label = snap.label && !isAutoSave(snap.label) ? snap.label : null;

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl transition-colors cursor-default
        ${isSuccess ? 'bg-emerald-50 border border-emerald-200' : 'hover:bg-slate-50 border border-transparent'}`}
    >
      {/* Icon */}
      <div className={`shrink-0 p-1.5 rounded-lg ${muted ? 'bg-slate-100' : 'bg-blue-50'}`}>
        {isSuccess ? (
          <CheckCircle2 className="size-3.5 text-emerald-500" />
        ) : (
          <Clock className={`size-3.5 ${muted ? 'text-slate-400' : 'text-blue-400'}`} />
        )}
      </div>

      {/* Meta */}
      <div className="flex-1 min-w-0">
        {label && (
          <p className="text-xs font-semibold text-slate-700 truncate">{label}</p>
        )}
        <p className={`text-[11px] truncate ${label ? 'text-slate-400' : 'text-slate-600 font-medium'}`}>
          {fullDate(snap.created_at)}
        </p>
        <p className="text-[10px] text-slate-400">{timeAgo(snap.created_at)}</p>
      </div>

      {/* Restore button */}
      {isRestoring ? (
        <Loader2 className="size-4 animate-spin text-blue-400 shrink-0" />
      ) : isSuccess ? (
        <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
      ) : (
        <button
          onClick={() => onRestore(snap)}
          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 opacity-0 group-hover:opacity-100 transition-all"
          title="Restore this version"
        >
          <RotateCcw className="size-3.5" />
        </button>
      )}
    </div>
  );
}
