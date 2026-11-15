/**
 * DataAccessModal.tsx — Data Access Permission Dialog
 *
 * Shows a consent banner before a query runs against one or more tables,
 * listing database, tables, columns, purpose, and estimated row count.
 * Three actions: "Fetch all data", "Fetch selected data", "Decline".
 */

import { useState } from 'react';
import {
  X,
  Database,
  Table2,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { api } from '../../lib/api';

interface TableSpec {
  name: string;
  columns: string[];
  estimated_rows?: number;
}

interface DataAccessModalProps {
  /** name of the connected database */
  databaseName: string;
  /** tables that will be touched by this query */
  tables: TableSpec[];
  /** analyst's stated purpose / query summary */
  purpose?: string;
  /** called when the user chose to proceed (possibly with a subset of tables) */
  onApprove: (selectedTables: string[]) => void;
  /** called when the user clicked Decline */
  onDecline: () => void;
  onClose: () => void;
}

export function DataAccessModal({
  databaseName,
  tables,
  purpose,
  onApprove,
  onDecline,
  onClose,
}: DataAccessModalProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(tables.map(t => [t.name, true]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalRows = tables.reduce((s, t) => s + (t.estimated_rows ?? 0), 0);
  const selectedTables = tables.filter(t => selected[t.name]);
  const allSelected = selectedTables.length === tables.length;

  const toggleTable = (name: string) =>
    setSelected(prev => ({ ...prev, [name]: !prev[name] }));

  const toggleExpand = (name: string) =>
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }));

  const handleFetchSelected = async () => {
    if (selectedTables.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/data-access/request', {
        database_name: databaseName,
        tables: selectedTables.map(t => t.name),
        columns: Object.fromEntries(selectedTables.map(t => [t.name, t.columns])),
        purpose: purpose || 'Ad-hoc query',
        access_type: 'read',
        estimated_rows: selectedTables.reduce((s, t) => s + (t.estimated_rows ?? 0), 0),
      });
      setSubmitted(true);
      onApprove(selectedTables.map(t => t.name));
    } catch (e: any) {
      setError(e?.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFetchAll = async () => {
    setSelected(Object.fromEntries(tables.map(t => [t.name, true])));
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/data-access/request', {
        database_name: databaseName,
        tables: tables.map(t => t.name),
        columns: Object.fromEntries(tables.map(t => [t.name, t.columns])),
        purpose: purpose || 'Ad-hoc query',
        access_type: 'read',
        estimated_rows: totalRows,
      });
      setSubmitted(true);
      onApprove(tables.map(t => t.name));
    } catch (e: any) {
      setError(e?.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] border border-slate-200 dark:border-slate-700">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <ShieldCheck className="size-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white text-base">Data Access Request</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Review what data will be accessed</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="size-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Database badge */}
          <div className="flex items-center gap-2 text-sm bg-slate-50 dark:bg-slate-800 rounded-xl p-3">
            <Database className="size-4 text-blue-500 shrink-0" />
            <span className="text-slate-500 dark:text-slate-400 shrink-0">Database:</span>
            <span className="font-mono font-semibold text-slate-800 dark:text-white truncate">{databaseName || 'connected database'}</span>
          </div>

          {/* Purpose */}
          {purpose && (
            <div className="text-sm bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-3">
              <p className="text-blue-700 dark:text-blue-300 font-medium mb-0.5">Query purpose</p>
              <p className="text-blue-600 dark:text-blue-400 text-xs leading-relaxed">{purpose}</p>
            </div>
          )}

          {/* Table list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Tables ({tables.length})
              </p>
              {totalRows > 0 && (
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  ~{totalRows.toLocaleString()} rows total
                </span>
              )}
            </div>

            <div className="space-y-2">
              {tables.map(table => {
                const isSelected = selected[table.name];
                const isExpanded = expanded[table.name];
                return (
                  <div
                    key={table.name}
                    className={`rounded-xl border transition-colors ${
                      isSelected
                        ? 'border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 p-3">
                      <button
                        onClick={() => toggleTable(table.name)}
                        className="shrink-0 text-blue-500"
                      >
                        {isSelected
                          ? <CheckSquare className="size-4" />
                          : <Square className="size-4 text-slate-400" />}
                      </button>
                      <Table2 className={`size-4 shrink-0 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`} />
                      <span className={`flex-1 font-mono text-sm font-semibold truncate ${isSelected ? 'text-slate-800 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>
                        {table.name}
                      </span>
                      {table.estimated_rows != null && (
                        <span className="text-xs text-slate-400 mr-1 shrink-0">
                          ~{table.estimated_rows.toLocaleString()} rows
                        </span>
                      )}
                      {table.columns.length > 0 && (
                        <button
                          onClick={() => toggleExpand(table.name)}
                          className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        >
                          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </button>
                      )}
                    </div>
                    {isExpanded && table.columns.length > 0 && (
                      <div className="px-3 pb-3">
                        <div className="flex flex-wrap gap-1.5">
                          {table.columns.map(col => (
                            <span
                              key={col}
                              className="text-xs font-mono px-2 py-0.5 rounded-md bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
                            >
                              {col}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl p-3">
            <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-amber-700 dark:text-amber-300 leading-relaxed">
              This action will be logged. Only select the data you need for this query.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-red-700 dark:text-red-400">
              <ShieldAlert className="size-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={handleFetchAll}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              {submitting && allSelected ? <Loader2 className="size-4 animate-spin" /> : null}
              Fetch all data
            </button>
            <button
              onClick={handleFetchSelected}
              disabled={submitting || selectedTables.length === 0}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              {submitting && !allSelected ? <Loader2 className="size-4 animate-spin" /> : null}
              Fetch selected ({selectedTables.length})
            </button>
          </div>
          <button
            onClick={onDecline}
            disabled={submitting}
            className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium text-sm transition-colors"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
