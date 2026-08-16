import { api } from '../../lib/api';
import {
  LayoutDashboard,
  Database,
  FileUp,
  MessageSquare,
  FileText,
  Calendar,
  Wand2,
  TrendingUp,
  Activity,
  Settings,
  Box,
  Lightbulb,
  Bell,
  LayoutGrid,
  BarChart2,
  LogOut,
  User as UserIcon,
  UserPlus,
  Shield,
  X
} from 'lucide-react';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  isConfigured: boolean;
  branding: {
    org_name: string;
    tagline: string;
    primary_color: string;
    logo_url: string;
  };
  unseenInsights?: number;
  user?: {
    display_name: string;
    role: string;
    email: string;
    permissions?: string[];
    is_superuser?: boolean;
  };
  onLogout?: () => void;
  onClose?: () => void;
  updateAvailable?: boolean;
  currentVersion?: string;
}

export function Sidebar({
  currentView,
  onNavigate,
  isConfigured,
  branding,
  unseenInsights = 0,
  user,
  onLogout,
  onClose,
  updateAvailable = false,
  currentVersion,
}: SidebarProps) {
  const primaryColor = branding.primary_color || '#2563eb';

  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'insights', label: 'Insights', icon: Lightbulb, badge: unseenInsights > 0 ? unseenInsights : undefined },
    { id: 'boards', label: 'Dashboards', icon: LayoutGrid, disabled: !isConfigured },
    { id: 'alerts', label: 'Alerts', icon: Bell, disabled: !isConfigured },
    { id: 'query', label: 'AI Query', icon: MessageSquare, disabled: !isConfigured },
    { id: 'profiler', label: 'Data Profiler', icon: BarChart2, disabled: !isConfigured },
  ];

  const hasPerm = (perm: string) => {
    if (Array.isArray(user?.permissions) && user.permissions.includes(perm)) return true;
    // Fallback for missing permissions in older session data
    if (user?.role === 'business_owner') return true; // Owners have all perms
    if (perm === 'MANAGE_USERS' && user?.role === 'admin') return true;
    if (perm === 'WRITE_DATA' && user?.role === 'admin') return true;
    if (perm === 'MUTATE_TABLES' && (user?.role === 'admin' || user?.role === 'editor')) return true;
    return false;
  };

  const toolsItems = [
    { id: 'database', label: 'Connect DB', icon: Database, hide: !hasPerm('MANAGE_ORG') },
    { id: 'import', label: 'Import File', icon: FileUp, hide: !hasPerm('WRITE_DATA') },
    { id: 'management', label: 'Data Manager', icon: Box, disabled: !isConfigured, hide: !hasPerm('WRITE_DATA') && !hasPerm('MUTATE_TABLES') },
    { id: 'transform', label: 'AI Transform', icon: Wand2, disabled: !isConfigured, hide: !hasPerm('MUTATE_TABLES') },
    { id: 'analytics', label: 'Advanced Analytics', icon: TrendingUp, disabled: !isConfigured, hide: !hasPerm('VIEW_ADVANCED') },
    { id: 'streaming', label: 'Live Streams', icon: Activity, disabled: !isConfigured, hide: !hasPerm('WRITE_DATA') },
    { id: 'integrations', label: 'Integrations', icon: Box, hide: !hasPerm('MANAGE_ORG') },
  ].filter(item => !item.hide);

  const adminItems = [
    { id: 'reports', label: 'Reports', icon: FileText, disabled: !isConfigured, hide: !hasPerm('VIEW_REPORTS') },
    { id: 'scheduled', label: 'Scheduled', icon: Calendar, disabled: !isConfigured, hide: !hasPerm('VIEW_REPORTS') },
    { id: 'billing', label: 'Usage & Billing', icon: Activity, hide: !hasPerm('MANAGE_ORG') },
    { id: 'branding', label: 'Branding', icon: Settings, hide: !hasPerm('MANAGE_ORG') },
    { id: 'settings', label: 'Invite Members', icon: UserPlus, hide: !hasPerm('MANAGE_USERS') },
    { id: 'admin', label: 'Admin Console', icon: Shield, hide: !user?.is_superuser, badge: updateAvailable ? '!' : undefined },
  ].filter(item => !item.hide);

  return (
    <aside className="w-64 h-full bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shadow-2xl lg:shadow-none">
      {/* Brand Header */}
      <div className="p-6 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3 mb-1">
          <div
            className="size-10 rounded-xl flex items-center justify-center text-white shadow-lg overflow-hidden shrink-0"
            style={{ backgroundColor: primaryColor }}
          >
            {branding.logo_url ? (
              <img src={api.resolveUrl(branding.logo_url)} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <TrendingUp size={24} />
            )}
          </div>
          <div className="overflow-hidden">
            <h1 className="font-black text-white text-lg leading-tight truncate">
              {branding.org_name}
            </h1>
            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 truncate">
              {branding.tagline}
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-6 space-y-8 scrollbar-hide">
        {/* Core Sections */}
        <div>
          <h2 className="px-6 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-3">Main</h2>
          <nav className="px-3 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => !item.disabled && onNavigate(item.id)}
                disabled={item.disabled}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all relative group ${currentView === item.id
                  ? 'bg-blue-600/10 text-white font-semibold'
                  : item.disabled
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-slate-800/50 hover:text-white'
                  }`}
              >
                {currentView === item.id && (
                  <div className="absolute left-0 w-1 h-6 bg-blue-500 rounded-r-full" />
                )}
                <item.icon size={20} className={currentView === item.id ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'} />
                <span className="text-[13px]">{item.label}</span>
                {item.badge !== undefined && (
                  <span className="ml-auto bg-blue-600 text-[10px] text-white font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-lg">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Tools Section */}
        <div>
          <h2 className="px-6 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-3">Tools</h2>
          <nav className="px-3 space-y-1">
            {toolsItems.map((item) => (
              <button
                key={item.id}
                onClick={() => !item.disabled && onNavigate(item.id)}
                disabled={item.disabled}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all relative group ${currentView === item.id
                  ? 'bg-blue-600/10 text-white font-semibold'
                  : item.disabled
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-slate-800/50 hover:text-white'
                  }`}
              >
                {currentView === item.id && (
                  <div className="absolute left-0 w-1 h-6 bg-blue-500 rounded-r-full" />
                )}
                <item.icon size={20} className={currentView === item.id ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'} />
                <span className="text-[13px]">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Administration Section */}
        <div>
          <h2 className="px-6 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-3">Admin</h2>
          <nav className="px-3 space-y-1">
            {adminItems.map((item) => (
              <button
                key={item.id}
                onClick={() => !item.disabled && onNavigate(item.id)}
                disabled={item.disabled}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all relative group ${currentView === item.id
                  ? 'bg-blue-600/10 text-white font-semibold'
                  : item.disabled
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-slate-800/50 hover:text-white'
                  }`}
              >
                {currentView === item.id && (
                  <div className="absolute left-0 w-1 h-6 bg-blue-500 rounded-r-full" />
                )}
                <item.icon size={20} className={currentView === item.id ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'} />
                <span className="text-[13px]">{item.label}</span>
                {item.badge && (
                  <span className="ml-auto size-5 bg-amber-500 text-[10px] text-white font-black rounded-full flex items-center justify-center shadow-lg animate-pulse">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* User Support / Footer */}
      <div className="p-4 border-t border-slate-800 space-y-3">
        {user && (
          <div className="bg-slate-800/50 p-3 rounded-2xl flex items-center gap-3 border border-slate-700/50">
            <div className="size-9 bg-slate-700 rounded-xl flex items-center justify-center text-blue-400 shrink-0 border border-slate-600 shadow-inner">
              <UserIcon size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-white truncate">{user.display_name}</p>
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate max-w-[80px]">
                  {user.role}
                </span>
                <span className="size-1 rounded-full bg-slate-600 shrink-0" />
                <span className="size-2 rounded-full bg-green-500 animate-pulse shrink-0" />
              </div>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all shrink-0"
                title="Log out"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        )}

        {!user && (
          <button className="w-full flex items-center gap-3 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all text-[13px]">
            <Settings size={18} />
            Workspace Settings
          </button>
        )}

        {/* Version label */}
        {currentVersion && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <span className="text-[11px] text-slate-600 font-mono">v{currentVersion}</span>
            {updateAvailable && (
              <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider animate-pulse">Update</span>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}