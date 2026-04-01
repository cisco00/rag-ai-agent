import React, { useState, useEffect } from 'react';
import { Clock, Plus, Edit2, Trash2, Power, PowerOff, Mail, Calendar } from 'lucide-react';
import { api } from '../../lib/api';

interface ScheduledReportsProps {
  apiKey: string;
}

interface ScheduledReport {
  id: number;
  query: string;
  frequency: string;
  recipients: string[];
  nextRun: Date;
  isActive: boolean;
}

export function ScheduledReports({ }: ScheduledReportsProps) {
  const [reports, setReports] = useState<ScheduledReport[]>([]);

  const fetchReports = async () => {
    try {
      const data = await api.get<any[]>('/scheduled-reports');
      const formatted = data.map((r) => ({
        id: r.id,
        query: r.query,
        frequency: r.frequency,
        recipients: Array.isArray(r.recipients) 
          ? r.recipients 
          : r.recipients.split(',').map((email: string) => email.trim()).filter(Boolean),
        nextRun: new Date(r.next_run_at),
        isActive: r.is_active === 1 || r.is_active === true,
      }));
      setReports(formatted);
    } catch (err) {
      console.error('Failed to fetch scheduled reports', err);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const [showModal, setShowModal] = useState(false);
  const [editingReportId, setEditingReportId] = useState<number | null>(null);
  const [newReport, setNewReport] = useState({
    query: '',
    frequency: 'weekly',
    recipients: '',
  });

  const handleCreateReport = async () => {
    if (!newReport.query || !newReport.recipients) return;
    try {
      if (editingReportId) {
        await api.put(`/scheduled-reports/${editingReportId}`, {
          query: newReport.query,
          frequency: newReport.frequency,
          recipients: newReport.recipients
        });
      } else {
        await api.post('/scheduled-reports', {
          query: newReport.query,
          frequency: newReport.frequency,
          recipients: newReport.recipients
        });
      }
      setShowModal(false);
      setEditingReportId(null);
      setNewReport({ query: '', frequency: 'weekly', recipients: '' });
      fetchReports();
    } catch (err) {
      console.error(err);
      alert(editingReportId ? 'Failed to update report' : 'Failed to schedule report');
    }
  };

  const toggleActive = async (id: number) => {
    try {
      await api.patch(`/scheduled-reports/${id}/toggle`);
      fetchReports();
    } catch (err) {
      console.error(err);
      alert('Failed to toggle report status');
    }
  };

  const startEdit = (report: ScheduledReport) => {
    setEditingReportId(report.id);
    setNewReport({
      query: report.query,
      frequency: report.frequency,
      recipients: report.recipients.join(', ')
    });
    setShowModal(true);
  };

  const deleteReport = async (id: number) => {
    if (!confirm('Are you sure you want to delete this scheduled report?')) return;
    try {
      await api.delete(`/scheduled-reports/${id}`);
      fetchReports();
    } catch (err) {
      console.error(err);
      alert('Failed to delete report');
    }
  };

  const frequencyLabels: Record<string, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    biweekly: 'Bi-weekly',
    monthly: 'Monthly',
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <Clock className="size-8 text-blue-600" />
              <h1 className="text-3xl font-bold text-gray-900">Scheduled Reports</h1>
            </div>
            <p className="text-gray-600">
              Automate your analytics with scheduled queries and email delivery.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <Plus className="size-5" />
            New Schedule
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Schedules</p>
              <p className="text-3xl font-bold text-gray-900">{reports.length}</p>
            </div>
            <Clock className="size-10 text-blue-100" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Active</p>
              <p className="text-3xl font-bold text-green-600">
                {reports.filter((r) => r.isActive).length}
              </p>
            </div>
            <Power className="size-10 text-green-100" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Inactive</p>
              <p className="text-3xl font-bold text-gray-400">
                {reports.filter((r) => !r.isActive).length}
              </p>
            </div>
            <PowerOff className="size-10 text-gray-100" />
          </div>
        </div>
      </div>

      {/* Reports List */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">All Scheduled Reports</h2>
        </div>

        <div className="divide-y divide-gray-200">
          {reports.map((report) => (
            <div key={report.id} className="p-6 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-bold text-gray-900">{report.query}</h3>
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded ${report.isActive
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                        }`}
                    >
                      {report.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600 mb-3">
                    <div className="flex items-center gap-2">
                      <Clock className="size-4" />
                      <span>{frequencyLabels[report.frequency]}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="size-4" />
                      <span>Next: {report.nextRun.toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="size-4" />
                      <span>{report.recipients.length} recipient(s)</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {report.recipients.map((email, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-mono"
                      >
                        {email}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleActive(report.id)}
                    className={`p-2 rounded-lg transition-colors ${report.isActive
                      ? 'bg-green-100 text-green-600 hover:bg-green-200'
                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      }`}
                    title={report.isActive ? 'Deactivate' : 'Activate'}
                  >
                    {report.isActive ? (
                      <Power className="size-5" />
                    ) : (
                      <PowerOff className="size-5" />
                    )}
                  </button>
                  <button
                    onClick={() => startEdit(report)}
                    className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="size-5" />
                  </button>
                  <button
                    onClick={() => deleteReport(report.id)}
                    className="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="size-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <Clock className="size-6 text-blue-600" />
                <h2 className="text-xl font-bold text-gray-900">
                  {editingReportId ? 'Edit Scheduled Report' : 'Create Scheduled Report'}
                </h2>
              </div>
              <button
                onClick={() => { setShowModal(false); setEditingReportId(null); }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Query
                </label>
                <textarea
                  value={newReport.query}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewReport({ ...newReport, query: e.target.value })}
                  placeholder="What are the top 5 products by revenue?"
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Frequency
                </label>
                <select
                  value={newReport.frequency}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewReport({ ...newReport, frequency: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Recipients (comma-separated)
                </label>
                <input
                  type="text"
                  value={newReport.recipients}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewReport({ ...newReport, recipients: e.target.value })}
                  placeholder="admin@example.com, team@example.com"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
              <button
                onClick={() => { setShowModal(false); setEditingReportId(null); }}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateReport}
                disabled={!newReport.query || !newReport.recipients}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition-colors font-medium"
              >
                {editingReportId ? 'Save Changes' : 'Create Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
