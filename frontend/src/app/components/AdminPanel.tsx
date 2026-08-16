import React, { useState, useEffect } from 'react';
import { Users, Activity, BarChart, Server, Search, Calendar, Shield, ExternalLink, RefreshCw, ArrowUpCircle, Terminal, Copy, Check, Clock } from 'lucide-react';
import { api } from '../../lib/api';

interface AdminStats {
  total_users: number;
  total_organizations: number;
  total_activities: number;
}

interface UserRecord {
  id: number;
  email: string;
  display_name: string;
  role: string;
  org_name: string;
  last_login_at: string;
  created_at: string;
  is_active: number;
}

interface ActivityRecord {
  id: number;
  action: string;
  details: string;
  created_at: string;
  user_email: string;
  user_name: string;
  org_name: string;
}

interface UpdateStatus {
  update_available: boolean;
  current_version: string;
  latest_version: string;
  changelog_url: string;
  checked_at: string;
  update_command: string;
  error: string | null;
  dismissed_version: string | null;
}

export function AdminPanel() {
  const [activeTab, setActiveTab] = useState<'users' | 'activities' | 'stats' | 'system'>('stats');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchStats = async () => {
    try {
      const data = await api.get<AdminStats>('/admin/stats');
      setStats(data);
    } catch (e) {
      console.error('Failed to fetch admin stats', e);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await api.get<{ users: UserRecord[] }>('/admin/users?limit=100');
      setUsers(data.users);
    } catch (e) {
      console.error('Failed to fetch admin users', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const data = await api.get<{ activities: ActivityRecord[] }>('/admin/activities?limit=100');
      setActivities(data.activities);
    } catch (e) {
      console.error('Failed to fetch admin activities', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'activities') fetchActivities();
  }, [activeTab]);

  const fetchUpdateStatus = async (force = false) => {
    setCheckingUpdate(true);
    try {
      if (force) {
        const data = await api.post<UpdateStatus>('/admin/updates/check');
        setUpdateStatus(data as UpdateStatus);
      } else {
        const data = await api.get<UpdateStatus>('/admin/updates/status');
        setUpdateStatus(data);
      }
    } catch (e) {
      console.error('Failed to fetch update status', e);
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'system') fetchUpdateStatus();
  }, [activeTab]);

  const copyCommand = () => {
    if (updateStatus?.update_command) {
      navigator.clipboard.writeText(updateStatus.update_command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const filteredUsers = users.filter(u => 
    u.email?.toLowerCase().includes(search.toLowerCase()) || 
    u.org_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.display_name?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredActivities = activities.filter(a => 
    a.action?.toLowerCase().includes(search.toLowerCase()) || 
    a.user_email?.toLowerCase().includes(search.toLowerCase()) ||
    a.org_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Admin Console</h1>
          <p className="text-slate-500 mt-1">Platform-wide user management and activity audit</p>
        </div>
        <button 
          onClick={() => activeTab === 'stats' ? fetchStats() : activeTab === 'users' ? fetchUsers() : fetchActivities()}
          className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-slate-600 shadow-sm"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl w-fit">
        {[
          { id: 'stats', label: 'Overview', icon: BarChart },
          { id: 'users', label: 'Global Users', icon: Users },
          { id: 'activities', label: 'Activity Feed', icon: Activity },
          { id: 'system', label: 'System', icon: Server },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
              activeTab === tab.id 
                ? 'bg-white text-blue-600 shadow-md' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'stats' && stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard label="Total Users" value={stats.total_users} icon={Users} color="blue" />
          <StatCard label="Organizations" value={stats.total_organizations} icon={Server} color="indigo" />
          <StatCard label="Events Logged" value={stats.total_activities} icon={Activity} color="emerald" />
        </div>
      )}

      {(activeTab === 'users' || activeTab === 'activities') && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="text"
              placeholder={`Search ${activeTab}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              {activeTab === 'users' ? (
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-bold text-slate-700">User / Identity</th>
                      <th className="px-6 py-4 font-bold text-slate-700">Organization</th>
                      <th className="px-6 py-4 font-bold text-slate-700">Role</th>
                      <th className="px-6 py-4 font-bold text-slate-700">Last Seen</th>
                      <th className="px-6 py-4 font-bold text-slate-700">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="size-9 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-bold">
                              {u.display_name?.charAt(0) || u.email.charAt(0)}
                            </div>
                            <div>
                              <div className="font-bold text-slate-800">{u.display_name}</div>
                              <div className="text-slate-500 text-xs">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-600 font-medium">{u.org_name || 'Individual'}</td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 bg-slate-100 text-slate-600 text-[11px] font-black uppercase rounded-md tracking-wider">
                            {u.role}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-500">
                          {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`size-2.5 rounded-full inline-block ${u.is_active ? 'bg-green-500' : 'bg-slate-300'}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-bold text-slate-700">Time</th>
                      <th className="px-6 py-4 font-bold text-slate-700">User / Org</th>
                      <th className="px-6 py-4 font-bold text-slate-700">Action</th>
                      <th className="px-6 py-4 font-bold text-slate-700">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredActivities.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 text-slate-500 whitespace-nowrap">
                          {new Date(a.created_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-800">{a.user_email || 'System'}</div>
                          <div className="text-slate-400 text-xs italic">{a.org_name || 'No Org'}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 bg-blue-50 text-blue-700 font-bold text-xs rounded-lg">
                            {a.action}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-500 max-w-xs truncate" title={a.details}>
                          {a.details || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {((activeTab === 'users' && filteredUsers.length === 0) || 
              (activeTab === 'activities' && filteredActivities.length === 0)) && !loading && (
              <div className="p-12 text-center text-slate-400 italic">
                No records found matching your search.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'system' && (
        <div className="space-y-6">
          {/* Version Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Current Version */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-4 mb-4">
                <div className="size-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-inner">
                  <Server size={24} />
                </div>
                <div>
                  <p className="text-sm text-slate-500 font-medium">Current Version</p>
                  <p className="text-2xl font-black text-slate-900">v{updateStatus?.current_version || '...'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm text-emerald-600 font-bold">Running</span>
              </div>
            </div>

            {/* Latest Version */}
            <div className={`bg-white p-6 rounded-3xl border shadow-sm ${
              updateStatus?.update_available
                ? 'border-amber-200 bg-gradient-to-br from-white to-amber-50/30'
                : 'border-slate-200'
            }`}>
              <div className="flex items-center gap-4 mb-4">
                <div className={`size-12 rounded-2xl flex items-center justify-center shadow-inner ${
                  updateStatus?.update_available
                    ? 'bg-amber-50 text-amber-600'
                    : 'bg-slate-50 text-slate-400'
                }`}>
                  <ArrowUpCircle size={24} />
                </div>
                <div>
                  <p className="text-sm text-slate-500 font-medium">Latest Available</p>
                  <p className="text-2xl font-black text-slate-900">
                    {updateStatus?.latest_version ? `v${updateStatus.latest_version}` : 'Unknown'}
                  </p>
                </div>
              </div>
              {updateStatus?.update_available ? (
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-sm text-amber-600 font-bold">Update Available</span>
                </div>
              ) : updateStatus?.latest_version ? (
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-emerald-500" />
                  <span className="text-sm text-emerald-600 font-bold">Up to date</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Last Checked + Check Now */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock size={20} className="text-slate-400" />
                <div>
                  <p className="text-sm font-bold text-slate-700">Last Checked</p>
                  <p className="text-sm text-slate-500">
                    {updateStatus?.checked_at
                      ? new Date(updateStatus.checked_at).toLocaleString()
                      : 'Never checked'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => fetchUpdateStatus(true)}
                disabled={checkingUpdate}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-bold rounded-xl transition-all shadow-sm"
              >
                <RefreshCw size={16} className={checkingUpdate ? 'animate-spin' : ''} />
                {checkingUpdate ? 'Checking...' : 'Check Now'}
              </button>
            </div>
            {updateStatus?.error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <strong>Error:</strong> {updateStatus.error}
              </div>
            )}
          </div>

          {/* Update Instructions */}
          {updateStatus?.update_available && (
            <div className="bg-white p-6 rounded-3xl border border-amber-200 shadow-sm">
              <h3 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
                <Terminal size={20} className="text-amber-600" />
                Update Instructions
              </h3>
              <p className="text-sm text-slate-600 mb-4">
                Run the following command on your server to update:
              </p>
              <div className="relative">
                <pre className="bg-slate-900 text-emerald-400 p-4 rounded-2xl text-sm font-mono overflow-x-auto">
                  {updateStatus.update_command}
                </pre>
                <button
                  onClick={copyCommand}
                  className="absolute top-3 right-3 p-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
                  title="Copy command"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}

          {/* Changelog Link */}
          {updateStatus?.changelog_url && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900">Full Changelog</h3>
                  <p className="text-sm text-slate-500 mt-1">View all release notes and breaking changes</p>
                </div>
                <a
                  href={updateStatus.changelog_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl transition-all"
                >
                  <ExternalLink size={16} />
                  View Changelog
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string, value: number, icon: any, color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  };
  
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-6 group hover:border-blue-300 transition-all cursor-default">
      <div className={`size-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner ${colors[color]}`}>
        <Icon size={28} />
      </div>
      <div>
        <p className="text-slate-500 text-sm font-medium">{label}</p>
        <p className="text-3xl font-black text-slate-900 mt-1">{value.toLocaleString()}</p>
      </div>
    </div>
  );
}
