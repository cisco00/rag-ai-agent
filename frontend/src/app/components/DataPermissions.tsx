/**
 * DataPermissions.tsx — Feature #10: Row-Level & Column-Level Data Permissions
 *
 * Admin-only panel to create, edit and toggle permission rules that:
 *   • ROW rules   — inject a WHERE clause for a specific role/user
 *   • COLUMN rules — mask (replace with ***) or hide columns from result sets
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import {
  ShieldAlert,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Eye,
  EyeOff,
  Filter,
  Columns,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Pencil,
  X,
} from 'lucide-react';

/* ─────────────────────────── types ───────────────────────────────────────── */

interface PermissionRule {
  id: number;
  rule_type: 'row' | 'column';
  target_type: 'role' | 'user';
  target_value: string;
  table_name: string;
  column_names: string[] | null;
  column_action: 'mask' | 'hide' | null;
  row_filter: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

const ROLES = [
  'owner', 'admin', 'business_owner', 'product_manager',
  'operation_manager', 'analyst', 'sales_team', 'marketing_team', 'viewer',
];

/* ─────────────────────────── helpers ─────────────────────────────────────── */

function RuleBadge({ rule }: { rule: PermissionRule }) {
  const isRow = rule.rule_type === 'row';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
      isRow
        ? 'bg-violet-100 text-violet-700'
        : rule.column_action === 'hide'
          ? 'bg-red-100 text-red-700'
          : 'bg-amber-100 text-amber-700'
    }`}>
      {isRow ? <Filter className="size-2.5" /> : <Columns className="size-2.5" />}
      {isRow ? 'Row filter' : rule.column_action === 'hide' ? 'Hide cols' : 'Mask cols'}
    </span>
  );
}

/* ─────────────────────────── Rule form modal ─────────────────────────────── */

interface RuleFormProps {
  initial?: Partial<PermissionRule>;
  onSave: (data: Partial<PermissionRule>) => Promise<void>;
  onClose: () => void;
}

function RuleForm({ initial, onSave, onClose }: RuleFormProps) {
  const [ruleType, setRuleType]       = useState<'row' | 'column'>(initial?.rule_type ?? 'row');
  const [targetType, setTargetType]   = useState<'role' | 'user'>(initial?.target_type ?? 'role');
  const [targetValue, setTargetValue] = useState(initial?.target_value ?? '');
  const [tableName, setTableName]     = useState(initial?.table_name ?? '');
  const [rowFilter, setRowFilter]     = useState(initial?.row_filter ?? '');
  const [colNames, setColNames]       = useState(
    Array.isArray(initial?.column_names) ? initial.column_names.join(', ') : ''
  );
  const [colAction, setColAction] = useState<'mask' | 'hide'>(
    initial?.column_action ?? 'mask'
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload: Partial<PermissionRule> = {
        rule_type: ruleType,
        target_type: targetType,
        target_value: targetValue.trim(),
        table_name: tableName.trim(),
        description: description.trim() || null,
      };
      if (ruleType === 'row') {
        payload.row_filter = rowFilter.trim();
      } else {
        payload.column_names = colNames.split(',').map(s => s.trim()).filter(Boolean);
        payload.column_action = colAction;
      }
      await onSave(payload);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-lg font-black text-slate-900">
            {initial?.id ? 'Edit Rule' : 'New Permission Rule'}
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 rounded-lg transition-colors">
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Rule type */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Rule type</label>
            <div className="flex gap-2">
              {(['row', 'column'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRuleType(t)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-colors ${
                    ruleType === t
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {t === 'row' ? '🔍 Row filter' : '📋 Column control'}
                </button>
              ))}
            </div>
          </div>

          {/* Target */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Target type</label>
              <select
                value={targetType}
                onChange={e => setTargetType(e.target.value as 'role' | 'user')}
                className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="role">Role</option>
                <option value="user">Specific user (ID)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                {targetType === 'role' ? 'Role' : 'User ID'}
              </label>
              {targetType === 'role' ? (
                <select
                  value={targetValue}
                  onChange={e => setTargetValue(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select role…</option>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="e.g. 42"
                  value={targetValue}
                  onChange={e => setTargetValue(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                />
              )}
            </div>
          </div>

          {/* Table */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Table name</label>
            <input
              type="text"
              placeholder="e.g. orders"
              value={tableName}
              onChange={e => setTableName(e.target.value)}
              required
              className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Row filter */}
          {ruleType === 'row' && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                WHERE clause <span className="font-normal text-slate-400">(SQL fragment)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. region = 'US' OR amount < 10000"
                value={rowFilter}
                onChange={e => setRowFilter(e.target.value)}
                required
                className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                Added as <code className="bg-slate-100 px-1 rounded">WHERE {rowFilter || '…'}</code> after the AI query runs.
              </p>
            </div>
          )}

          {/* Column control */}
          {ruleType === 'column' && (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Columns <span className="font-normal text-slate-400">(comma-separated)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. salary, ssn, credit_card"
                  value={colNames}
                  onChange={e => setColNames(e.target.value)}
                  required
                  className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Action</label>
                <div className="flex gap-2">
                  {(['mask', 'hide'] as const).map(a => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setColAction(a)}
                      className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-colors ${
                        colAction === a
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      {a === 'mask' ? '🔒 Mask (show ***)' : '🙈 Hide (remove col)'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Description <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="Why this rule exists…"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !tableName.trim() || !targetValue.trim()}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {initial?.id ? 'Save changes' : 'Create rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────── main component ──────────────────────────────── */

export function DataPermissions() {
  const [rules, setRules]       = useState<PermissionRule[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<PermissionRule | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<PermissionRule[]>('/permissions/rules');
      setRules(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);

  async function handleCreate(data: Partial<PermissionRule>) {
    await api.post('/permissions/rules', data);
    await loadRules();
    flash('Rule created');
  }

  async function handleUpdate(id: number, data: Partial<PermissionRule>) {
    await api.patch(`/permissions/rules/${id}`, data);
    await loadRules();
    flash('Rule updated');
  }

  async function handleToggle(rule: PermissionRule) {
    await api.post(`/permissions/rules/${rule.id}/toggle`, {});
    await loadRules();
    flash(rule.is_active ? 'Rule disabled' : 'Rule enabled');
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this permission rule? This cannot be undone.')) return;
    await api.delete(`/permissions/rules/${id}`);
    await loadRules();
    flash('Rule deleted');
  }

  const rowRules    = rules.filter(r => r.rule_type === 'row');
  const columnRules = rules.filter(r => r.rule_type === 'column');

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-violet-50 rounded-2xl">
            <ShieldAlert className="size-7 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900">Data Permissions</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Control which rows and columns each role or user can see in AI query results.
            </p>
          </div>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow transition-colors"
        >
          <Plus className="size-4" />
          New Rule
        </button>
      </div>

      {/* Success toast */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm font-medium">
          <CheckCircle2 className="size-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-8 animate-spin text-slate-300" />
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
          <ShieldAlert className="size-10 text-slate-300 mx-auto mb-3" />
          <p className="font-bold text-slate-500">No permission rules yet</p>
          <p className="text-sm text-slate-400 mt-1">
            All users can see all data. Add rules to restrict access.
          </p>
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="mt-4 px-4 py-2 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors text-sm"
          >
            Add your first rule
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Row Rules */}
          {rowRules.length > 0 && (
            <section>
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-2">
                <Filter className="size-3.5" /> Row Filters ({rowRules.length})
              </h2>
              <div className="space-y-2">
                {rowRules.map(rule => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    expanded={expandedId === rule.id}
                    onExpand={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
                    onEdit={() => { setEditing(rule); setShowForm(true); }}
                    onToggle={() => handleToggle(rule)}
                    onDelete={() => handleDelete(rule.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Column Rules */}
          {columnRules.length > 0 && (
            <section>
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-2">
                <Columns className="size-3.5" /> Column Controls ({columnRules.length})
              </h2>
              <div className="space-y-2">
                {columnRules.map(rule => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    expanded={expandedId === rule.id}
                    onExpand={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
                    onEdit={() => { setEditing(rule); setShowForm(true); }}
                    onToggle={() => handleToggle(rule)}
                    onDelete={() => handleDelete(rule.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* How it works */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-2">
        <h3 className="font-bold text-slate-700 text-sm">How it works</h3>
        <ul className="text-sm text-slate-500 space-y-1 list-disc list-inside">
          <li><strong>Row filters</strong> wrap the AI-generated SQL in a subquery and append a WHERE clause, so affected users only see matching rows.</li>
          <li><strong>Mask</strong> replaces column values with <code className="bg-slate-200 px-1 rounded text-xs">***</code> in results while keeping the column visible.</li>
          <li><strong>Hide</strong> removes the column from result sets entirely.</li>
          <li>User-level rules take precedence over role-level rules for the same column.</li>
          <li>Rules only apply when the table they target appears in the AI-generated SQL.</li>
        </ul>
      </div>

      {/* Form modal */}
      {showForm && (
        <RuleForm
          initial={editing ?? undefined}
          onSave={editing ? (d) => handleUpdate(editing.id, d) : handleCreate}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── rule card ──────────────────────────────────── */

interface RuleCardProps {
  rule: PermissionRule;
  expanded: boolean;
  onExpand: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

function RuleCard({ rule, expanded, onExpand, onEdit, onToggle, onDelete }: RuleCardProps) {
  return (
    <div className={`bg-white border rounded-xl transition-all ${
      rule.is_active ? 'border-slate-200' : 'border-slate-100 opacity-60'
    }`}>
      <div
        className="flex items-center gap-3 p-4 cursor-pointer"
        onClick={onExpand}
      >
        <RuleBadge rule={rule} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-800">
              <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">{rule.table_name}</code>
            </span>
            <span className="text-xs text-slate-400">→</span>
            <span className="text-xs font-semibold text-slate-600">
              {rule.target_type === 'role' ? `role: ${rule.target_value}` : `user #${rule.target_value}`}
            </span>
            {rule.description && (
              <span className="text-xs text-slate-400 truncate max-w-[200px]">{rule.description}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg transition-colors"
            title="Edit"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onToggle(); }}
            className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg transition-colors"
            title={rule.is_active ? 'Disable' : 'Enable'}
          >
            {rule.is_active
              ? <ToggleRight className="size-4 text-emerald-500" />
              : <ToggleLeft className="size-4" />
            }
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
            title="Delete"
          >
            <Trash2 className="size-3.5" />
          </button>
          {expanded ? <ChevronUp className="size-4 text-slate-300" /> : <ChevronDown className="size-4 text-slate-300" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-2">
          {rule.rule_type === 'row' && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1">WHERE clause</p>
              <code className="block bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-violet-700 font-mono">
                {rule.row_filter}
              </code>
            </div>
          )}
          {rule.rule_type === 'column' && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1">
                Columns ({rule.column_action === 'hide' ? 'hidden' : 'masked'})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(rule.column_names ?? []).map(col => (
                  <span key={col} className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-mono text-slate-700">
                    {rule.column_action === 'hide'
                      ? <EyeOff className="size-2.5" />
                      : <Eye className="size-2.5" />
                    }
                    {col}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-slate-400">
            Created {new Date(rule.created_at).toLocaleDateString()} · ID #{rule.id}
            {!rule.is_active && ' · Disabled'}
          </p>
        </div>
      )}
    </div>
  );
}
