/**
 * DataAccessManager.tsx — Admin view for Data Access Requests
 *
 * Lists pending, approved and declined requests.
 * Admins can approve or decline from here.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Database,
  Table2,
  User,
  Calendar,
  ChevronDown,
  ChevronUp,
  Loader2,
  Trash2,
} from 'lucide-react';
import { api } from '../../lib/api';

interface DataAccessRequest {
  id: number;
  requester_name?: string;
  requester_email?: string;
  database_name?: string;
  tables: string[];
  columns: Record<string, string[]>;
  purpose?: string;
  access_type: string;
  estimated_rows?: number;
  status: 'pending' | 'approved' | 'declined';
  decline_reason?: string;
  created_at: string;
  resolved_at?: string;
}

const STATUS_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  pending:  { label: 'Pending',  icon: Clock,       color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700' },
  approved: { label: 'Approved', icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700' },
  declined: { label: 'Declined', icon: XCircle,     color: 'text-red-600 dark:text-red-400',      bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700' },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.pending;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${m.bg} ${m.color}`}>
      <Icon className="size-3" />
      {m.label}
    </span>
  );
}

function RequestCard({
  req,
  onApprove,
  onDecline,
  onDelete,
}: {
  req: DataAccessRequest;
  onApprove: (id: number) => void;
  onDecline: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState<'approve' | 'decline' | null>(null);

  const handleApprove = async () => {
    setLoading('approve');
    await onApprove(req.id);
    setLoading(null);
  };

  const handleDecline = async () => {
    setLoading('decline');
    await onDecline(req.id);
    setLoading(null);
  };

  const tableCount = req.tables.length;
  const colCount = Object.values(req.columns).flat().length;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="size-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
              <ShieldCheck className="size-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-900 dark:text-white text-sm">
                  {req.requester_name || req.requester_email || 'Unknown user'}
                </span>
                <StatusBadge status={req.status} />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                <Calendar className="size-3 shrink-0" />
                {new Date(req.created_at).toLocaleString()}
              </p>
            </div>
          </div>
          <span className="text-xs text-slate-400 shrink-0 font-mono">#{req.id}</span>
        </div>

        {/* Meta row */}
        <div className="mt-3 flex flex-wrap gap-2">
          {req.database_name && (
            <span className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-700 rounded-lg px-2.5 py-1 text-slate-600 dark:text-slate-300">
              <Database className="size-3" />
              {req.database_name}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-700 rounded-lg px-2.5 py-1 text-slate-600 dark:text-slate-300">
            <Table2 className="size-3" />
            {tableCount} table{tableCount !== 1 ? 's' : ''}
            {colCount > 0 ? `, ${colCount} col${colCount !== 1 ? 's' : ''}` : ''}
          </span>
          {req.estimated_rows != null && (
            <span className="text-xs bg-slate-100 dark:bg-slate-700 rounded-lg px-2.5 py-1 text-slate-600 dark:text-slate-300">
              ~{req.estimated_rows.toLocaleString()} rows
            </span>
          )}
          <span className="text-xs bg-slate-100 dark:bg-slate-700 rounded-lg px-2.5 py-1 text-slate-600 dark:text-slate-300 capitalize">
            {req.access_type}
          </span>
        </div>

        {/* Purpose */}
        {req.purpose && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 italic truncate">
            "{req.purpose}"
          </p>
        )}

        {/* Decline reason */}
        {req.status === 'declined' && req.decline_reason && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            Reason: {req.decline_reason}
          </p>
        )}

        {/* Expand toggle */}
        {tableCount > 0 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-3 flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {expanded ? 'Hide tables' : 'View tables'}
          </button>
        )}

        {expanded && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {req.tables.map(t => (
              <span
                key={t}
                className="text-xs font-mono px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 flex gap-2">
        {req.status === 'pending' && (
          <>
            <button
              onClick={handleApprove}
              disabled={!!loading}
              className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              {loading === 'approve' ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Approve
            </button>
            <button
              onClick={handleDecline}
              disabled={!!loading}
              className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              {loading === 'decline' ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
              Decline
            </button>
          </>
        )}
        <button
          onClick={() => onDelete(req.id)}
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-500 hover:border-red-300 transition-colors"
          title="Delete"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function DataAccessManager() {
  const [requests, setRequests] = useState<DataAccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const data = await api.get<{ requests: DataAccessRequest[] }>(`/data-access/requests${params}`);
      setRequests(data.requests || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: number) => {
    try {
      await api.post(`/data-access/requests/${id}/approve`, {});
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to approve');
    }
  };

  const handleDecline = async (id: number) => {
    try {
      await api.post(`/data-access/requests/${id}/decline`, {});
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to decline');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this request permanently?')) return;
    try {
      await api.delete(`/data-access/requests/${id}`);
      setRequests(prev => prev.filter(r => r.id !== id));
    } catch (e: any) {
      setError(e?.message || 'Failed to delete');
    }
  };

  const pendingCount  = requests.filter(r => r.status === 'pending').length;
  const approvedCount = requests.filter(r => r.status === 'approved').length;
  const declinedCount = requests.filter(r => r.status === 'declined').length;

  const FILTERS = [
    { id: 'all',      label: 'All',      count: requests.length },
    { id: 'pending',  label: 'Pending',  count: pendingCount  },
    { id: 'approved', label: 'Approved', count: approvedCount },
    { id: 'declined', label: 'Declined', count: declinedCount },
  ] as const;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-2xl bg-blue-600 flex items-center justify-center">
            <ShieldCheck className="size-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Data Access Requests</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Review and manage data access permissions</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Pending',  count: pendingCount,  icon: Clock,       color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { label: 'Approved', count: approvedCount, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
          { label: 'Declined', count: declinedCount, icon: XCircle,     color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20' },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className={`rounded-xl p-4 ${s.bg} border border-transparent`}>
              <Icon className={`size-5 mb-2 ${s.color}`} />
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{s.count}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
              filter === f.id
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {f.label}
            {f.count > 0 && (
              <span className={`text-xs rounded-full px-1.5 font-bold ${
                filter === f.id ? 'bg-blue-600 text-white' : 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400'
              }`}>
                {f.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-red-700 dark:text-red-400">
          <ShieldAlert className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-blue-500" />
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-16 text-slate-400 dark:text-slate-500">
          <ShieldCheck className="size-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No {filter !== 'all' ? filter : ''} requests</p>
          <p className="text-sm mt-1">Requests will appear here when analysts submit them.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(req => (
            <RequestCard
              key={req.id}
              req={req}
              onApprove={handleApprove}
              onDecline={handleDecline}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
