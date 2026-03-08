import { useState, useEffect } from 'react';
import { Bell, Plus, Trash2, ToggleLeft, ToggleRight, PlayCircle, Clock, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../lib/api';

interface AlertRule {
  id: number;
  name: string;
  is_active: number;
  alert_type: string;
  table_name?: string;
  column_name?: string;
  aggregate: string;
  operator: string;
  threshold_value?: number;
  lookback_hours: number;
  notify_email?: string;
  notify_webhook?: string;
  cooldown_minutes: number;
  last_triggered_at?: string;
  timestamp_column?: string;
}

interface AlertHistory {
  id: number;
  rule_id: number;
  triggered_at: string;
  current_value?: number;
  threshold_value?: number;
  message: string;
  delivered: number;
}

const OPERATORS = ['>', '<', '>=', '<=', '==', '!=', 'pct_change_gt', 'pct_change_lt'];
const AGGREGATES = ['avg', 'sum', 'count', 'min', 'max'];

export function AlertsManager({ apiKey }: { apiKey: string }) {
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistory[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<Record<number, any>>({});
  const [form, setForm] = useState({
    name: '', alert_type: 'metric', table_name: '', column_name: '',
    aggregate: 'avg', operator: '>', threshold_value: '', lookback_hours: 24,
    notify_email: '', notify_webhook: '', cooldown_minutes: 60,
    timestamp_column: 'created_at',
  });

  const fetchAlerts = async () => {
    try {
      const data = await api.get<{ alerts: AlertRule[] }>('/alerts');
      setAlerts(data.alerts || []);
    } catch (e) { console.error(e); }
  };

  const fetchHistory = async () => {
    try {
      const data = await api.get<{ history: AlertHistory[] }>('/alerts/history');
      setHistory(data.history || []);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchAlerts(); fetchHistory(); }, []);

  const handleCreate = async () => {
    setLoading(true);
    try {
      await api.post('/alerts', { ...form, threshold_value: Number(form.threshold_value) });
      setShowCreate(false);
      setForm({ name: '', alert_type: 'metric', table_name: '', column_name: '', aggregate: 'avg', operator: '>', threshold_value: '', lookback_hours: 24, notify_email: '', notify_webhook: '', cooldown_minutes: 60, timestamp_column: 'created_at' });
      fetchAlerts();
    } catch (e: any) { alert(e.message || 'Failed to create alert'); }
    setLoading(false);
  };

  const handleToggle = async (id: number) => {
    try { await api.post(`/alerts/${id}/toggle`); fetchAlerts(); } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this alert rule?')) return;
    try { await api.delete(`/alerts/${id}`); fetchAlerts(); } catch (e) { console.error(e); }
  };

  const handleTest = async (id: number) => {
    try {
      const result = await api.post<any>(`/alerts/${id}/test`);
      setTestResult(prev => ({ ...prev, [id]: result }));
    } catch (e: any) { setTestResult(prev => ({ ...prev, [id]: { error: e.message } })); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 rounded-lg"><Bell className="size-6 text-orange-600" /></div>
          <div><h1 className="text-2xl font-bold text-gray-900">Alert Rules</h1>
            <p className="text-sm text-gray-500">Get notified when data conditions are met</p></div>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="size-4" /><span>New Alert</span>
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Create Alert Rule</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Revenue drop alert" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Table</label>
              <input value={form.table_name} onChange={e => setForm(f => ({ ...f, table_name: e.target.value }))}
                placeholder="your_table" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Column</label>
              <input value={form.column_name} onChange={e => setForm(f => ({ ...f, column_name: e.target.value }))}
                placeholder="column_name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Aggregate</label>
              <select value={form.aggregate} onChange={e => setForm(f => ({ ...f, aggregate: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {AGGREGATES.map(a => <option key={a}>{a.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Operator</label>
              <select value={form.operator} onChange={e => setForm(f => ({ ...f, operator: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {OPERATORS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Threshold Value</label>
              <input type="number" value={form.threshold_value} onChange={e => setForm(f => ({ ...f, threshold_value: e.target.value }))}
                placeholder="e.g. 1000" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lookback Hours</label>
              <input type="number" value={form.lookback_hours} onChange={e => setForm(f => ({ ...f, lookback_hours: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            {form.operator.startsWith('pct_change') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Timestamp Column</label>
                <input value={form.timestamp_column} onChange={e => setForm(f => ({ ...f, timestamp_column: e.target.value }))}
                  placeholder="created_at" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notify Email</label>
              <input value={form.notify_email} onChange={e => setForm(f => ({ ...f, notify_email: e.target.value }))}
                placeholder="alerts@example.com" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL (optional)</label>
              <input value={form.notify_webhook} onChange={e => setForm(f => ({ ...f, notify_webhook: e.target.value }))}
                placeholder="https://hooks.example.com/..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cooldown (minutes)</label>
              <input type="number" value={form.cooldown_minutes} onChange={e => setForm(f => ({ ...f, cooldown_minutes: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleCreate} disabled={loading || !form.name}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
              {loading ? 'Creating...' : 'Create Alert'}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {/* Alert Rules List */}
      <div className="space-y-3">
        {alerts.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Bell className="size-12 mx-auto mb-3 opacity-30" />
            <p>No alert rules yet. Create one to get started.</p>
          </div>
        )}
        {alerts.map(alert => (
          <div key={alert.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <div className={`mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${alert.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{alert.name}</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {alert.aggregate?.toUpperCase()}({alert.column_name}) {alert.operator} {alert.threshold_value}
                    {' '}in <span className="font-mono text-xs bg-gray-100 px-1 rounded">{alert.table_name}</span>
                    {alert.timestamp_column && alert.timestamp_column !== 'created_at' && (
                      <span className="text-xs text-gray-400 ml-2"> (via {alert.timestamp_column})</span>
                    )}
                  </p>
                  {alert.last_triggered_at && (
                    <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                      <Clock className="size-3" />Last triggered: {new Date(alert.last_triggered_at).toLocaleString()}
                    </p>
                  )}
                  {testResult[alert.id] && (
                    <div className={`mt-2 text-xs px-3 py-2 rounded-lg ${testResult[alert.id].triggered ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                      {testResult[alert.id].triggered ? <CheckCircle className="size-3 inline mr-1" /> : <XCircle className="size-3 inline mr-1" />}
                      {testResult[alert.id].message || testResult[alert.id].error}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => handleTest(alert.id)} title="Test now"
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                  <PlayCircle className="size-4" />
                </button>
                <button onClick={() => handleToggle(alert.id)} title={alert.is_active ? 'Disable' : 'Enable'}
                  className="p-2 hover:bg-gray-50 rounded-lg transition-colors text-gray-600">
                  {alert.is_active ? <ToggleRight className="size-5 text-green-600" /> : <ToggleLeft className="size-5" />}
                </button>
                <button onClick={() => handleDelete(alert.id)} title="Delete"
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Alert History */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <button onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
          <span className="font-semibold text-gray-800">Alert History</span>
          {showHistory ? <ChevronUp className="size-4 text-gray-500" /> : <ChevronDown className="size-4 text-gray-500" />}
        </button>
        {showHistory && (
          <div className="divide-y divide-gray-100">
            {history.length === 0 && <p className="text-sm text-gray-500 text-center py-6">No history yet.</p>}
            {history.map(h => (
              <div key={h.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-800">{h.message}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(h.triggered_at).toLocaleString()}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${h.delivered ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {h.delivered ? 'Delivered' : 'Failed'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
