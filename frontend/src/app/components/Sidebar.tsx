import { useState } from 'react';
import { api } from '../../lib/api';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
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
  History,
  BookMarked,
  BookOpen,
  FileSpreadsheet,
  Network,
  LogOut,
  User as UserIcon,
  UserPlus,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ClipboardList,
  KeyRound,
  CloudUpload,
  X,
  NotebookPen,
  Lock,
  ChevronRight,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
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
  unseenAlerts?: number;
  user?: {
    display_name: string;
    role: string;
    email: string;
    permissions?: string[];
    is_superuser?: boolean;
    workspace_id?: number;
    org_id?: number | null;
  };
  onLogout?: () => void;
  onClose?: () => void;
  onCreateOrg?: () => void;
  updateAvailable?: boolean;
  currentVersion?: string;
}

export function Sidebar({
  currentView,
  onNavigate,
  isConfigured,
  branding,
  unseenInsights = 0,
  unseenAlerts = 0,
  user,
  onLogout,
  onClose,
  onCreateOrg,
  updateAvailable = false,
  currentVersion,
}: SidebarProps) {
  const primaryColor = branding.primary_color || '#2563eb';
  const [collapsed, setCollapsed] = useState(false);

  const [dataManagerOpen, setDataManagerOpen] = useState(
    ['management', 'transform', 'profiler', 'quality', 'permissions', 'catalog'].includes(currentView)
  );
  const [queryGroupOpen, setQueryGroupOpen] = useState(
    ['query', 'history', 'templates'].includes(currentView)
  );

  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'insights', label: 'Insights', icon: Lightbulb, badge: unseenInsights > 0 ? unseenInsights : undefined },
    { id: 'boards', label: 'Dashboards', icon: LayoutGrid, disabled: !isConfigured },
    { id: 'alerts', label: 'Alerts', icon: Bell, disabled: !isConfigured, badge: unseenAlerts > 0 ? unseenAlerts : undefined },
    { id: 'notebook', label: 'Notebook', icon: NotebookPen, disabled: !isConfigured },
    { id: 'schema', label: 'Schema Diagram', icon: Network, disabled: !isConfigured },
  ];

  const queryGroupItems = [
    { id: 'query', label: 'AI Query', icon: MessageSquare, disabled: !isConfigured },
    { id: 'history', label: 'Query History', icon: History, disabled: !isConfigured },
    { id: 'templates', label: 'Query Templates', icon: BookMarked, disabled: !isConfigured },
  ];

  const queryGroupActive = queryGroupItems.some(i => i.id === currentView);

  const hasPerm = (perm: string) => {
    if (Array.isArray(user?.permissions) && user.permissions.includes(perm)) return true;
    if (user?.role === 'business_owner') return true;
    if (perm === 'MANAGE_USERS' && user?.role === 'admin') return true;
    if (perm === 'WRITE_DATA' && user?.role === 'admin') return true;
    if (perm === 'MUTATE_TABLES' && (user?.role === 'admin' || user?.role === 'editor')) return true;
    return false;
  };

  const dataManagerItems = [
    { id: 'management', label: 'Data Manager', icon: Box, disabled: !isConfigured, hide: !hasPerm('WRITE_DATA') && !hasPerm('MUTATE_TABLES') },
    { id: 'transform', label: 'AI Transform', icon: Wand2, disabled: !isConfigured, hide: !hasPerm('MUTATE_TABLES') },
    { id: 'profiler', label: 'Data Profiler', icon: BarChart2, disabled: !isConfigured },
    { id: 'quality', label: 'Data Quality', icon: ShieldCheck, disabled: !isConfigured },
    { id: 'permissions', label: 'Data Permissions', icon: ShieldAlert, disabled: !isConfigured, hide: !hasPerm('MANAGE_ORG') },
    { id: 'catalog', label: 'Data Catalog', icon: BookOpen, disabled: !isConfigured, hide: !hasPerm('MANAGE_ORG') },
  ].filter(item => !item.hide);

  const dataManagerActive = dataManagerItems.some(i => i.id === currentView);

  const toolsItems = [
    { id: 'database', label: 'Connect DB', icon: Database, hide: !hasPerm('MANAGE_ORG') },
    { id: 'import', label: 'Import File', icon: FileUp, hide: !hasPerm('WRITE_DATA') },
    { id: 'analytics', label: 'Advanced Analytics', icon: TrendingUp, disabled: !isConfigured, hide: !hasPerm('VIEW_ADVANCED') },
    { id: 'streaming', label: 'Live Streams', icon: Activity, disabled: !isConfigured, hide: !hasPerm('WRITE_DATA') },
    { id: 'sheets', label: 'Sheets Sync', icon: FileSpreadsheet, disabled: !isConfigured, title: 'Sync query results to Google Sheets' },
    { id: 'integrations', label: 'Integrations', icon: Box, hide: !hasPerm('MANAGE_ORG') },
  ].filter(item => !item.hide);

  const adminItems = [
    { id: 'security', label: 'Security & 2FA', icon: ShieldCheck },
    { id: 'api-keys', label: 'API Keys', icon: KeyRound, hide: true }, // accessible via /api-keys directly; hidden from nav
    { id: 'business-profile', label: 'Business Profile', icon: Lightbulb, hide: !hasPerm('MANAGE_ORG') },
    { id: 'data-access', label: 'Access Requests', icon: Lock, hide: !hasPerm('MANAGE_ORG') },
    { id: 'audit', label: 'Audit Trail', icon: ClipboardList, hide: !hasPerm('MANAGE_ORG') },
    { id: 'sso', label: 'SSO / SAML', icon: KeyRound, hide: !hasPerm('MANAGE_ORG') },
    { id: 'cloud-storage', label: 'Cloud Storage', icon: CloudUpload, hide: !hasPerm('MANAGE_ORG') },
    { id: 'reports', label: 'Reports', icon: FileText, disabled: !isConfigured, hide: !hasPerm('VIEW_REPORTS') },
    { id: 'scheduled', label: 'Scheduled', icon: Calendar, disabled: !isConfigured, hide: !hasPerm('VIEW_REPORTS') },
    { id: 'billing', label: 'Usage & Billing', icon: Activity, hide: !hasPerm('MANAGE_ORG') },
    { id: 'branding', label: 'Branding', icon: Settings, hide: !hasPerm('MANAGE_ORG') },
    { id: 'settings', label: 'Invite Members', icon: UserPlus, hide: !hasPerm('MANAGE_USERS') || !user?.org_id },
    { id: 'admin', label: 'Admin Console', icon: Shield, hide: !user?.is_superuser, badge: updateAvailable ? '!' : undefined },
  ].filter(item => !item.hide);

  // Shared nav button — works in both expanded and collapsed modes
  const NavBtn = ({
    id, label, icon: Icon, disabled, badge,
  }: { id: string; label: string; icon: any; disabled?: boolean; badge?: number | string }) => {
    const active = currentView === id;
    return (
      <button
        key={id}
        onClick={() => !disabled && onNavigate(id)}
        disabled={disabled}
        title={collapsed ? label : undefined}
        className={`w-full flex items-center gap-3 rounded-xl transition-all relative group
          ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
          ${active
            ? 'bg-blue-600/10 text-white font-semibold'
            : disabled
              ? 'opacity-40 cursor-not-allowed'
              : 'hover:bg-slate-800/50 hover:text-white'
          }`}
      >
        {active && !collapsed && <div className="absolute left-0 w-1 h-6 bg-blue-500 rounded-r-full" />}
        {active && collapsed && <div className="absolute left-0 w-1 h-6 bg-blue-500 rounded-r-full" />}
        <Icon size={20} className={active ? 'text-blue-400 shrink-0' : 'text-slate-500 group-hover:text-slate-300 shrink-0'} />
        {!collapsed && <span className="text-[13px] flex-1 text-left truncate">{label}</span>}
        {!collapsed && badge !== undefined && (
          <span className="ml-auto bg-blue-600 text-[10px] text-white font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-lg">
            {badge}
          </span>
        )}
        {collapsed && badge !== undefined && (
          <span className="absolute top-1 right-1 size-2 bg-blue-500 rounded-full" />
        )}
      </button>
    );
  };

  return (
    <aside
      className={`h-full bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shadow-2xl lg:shadow-none transition-[width] duration-200 ease-in-out overflow-hidden
        ${collapsed ? 'w-16' : 'w-64'}`}
    >
      {/* Brand Header */}
      <div className={`border-b border-slate-800 flex items-center shrink-0 ${collapsed ? 'p-3 justify-center' : 'p-5 justify-between'}`}>
        {!collapsed && (
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="size-9 rounded-xl flex items-center justify-center text-white shadow-lg overflow-hidden shrink-0"
              style={{ backgroundColor: primaryColor }}
            >
              {branding.logo_url ? (
                <img src={api.resolveUrl(branding.logo_url)} alt="Logo" className="w-full h-full object-cover" />
              ) : (
                <TrendingUp size={20} />
              )}
            </div>
            <div className="overflow-hidden min-w-0">
              <h1 className="font-black text-white text-base leading-tight truncate">{branding.org_name}</h1>
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 truncate">{branding.tagline}</p>
            </div>
          </div>
        )}

        {collapsed && (
          <div
            className="size-9 rounded-xl flex items-center justify-center text-white shadow-lg overflow-hidden shrink-0"
            style={{ backgroundColor: primaryColor }}
            title={branding.org_name}
          >
            {branding.logo_url ? (
              <img src={api.resolveUrl(branding.logo_url)} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <TrendingUp size={20} />
            )}
          </div>
        )}

        <div className={`flex items-center ${collapsed ? 'hidden' : 'gap-1'}`}>
          {/* Desktop collapse toggle — hidden on mobile since mobile uses drawer */}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="hidden lg:flex p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors shrink-0"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Collapsed: expand button below logo */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="hidden lg:flex justify-center py-2 text-slate-500 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          title="Expand sidebar"
        >
          <PanelLeftOpen size={16} />
        </button>
      )}

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-4 space-y-6 scrollbar-hide">

        {/* Core */}
        <div>
          {!collapsed && <h2 className="px-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Main</h2>}
          <nav className={`space-y-0.5 ${collapsed ? 'px-1.5' : 'px-3'}`}>
            {navItems.map((item) => (
              <NavBtn key={item.id} {...item} />
            ))}
          </nav>
        </div>

        {/* Query group */}
        <div>
          {!collapsed && <h2 className="px-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Query</h2>}
          <nav className={`space-y-0.5 ${collapsed ? 'px-1.5' : 'px-3'}`}>
            {collapsed ? (
              // In collapsed mode: show main query icon, navigate to query
              <NavBtn id="query" label="AI Query" icon={MessageSquare} disabled={!isConfigured} />
            ) : (
              <>
                <button
                  onClick={() => setQueryGroupOpen(o => !o)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all relative group ${
                    queryGroupActive ? 'bg-blue-600/10 text-white font-semibold' : 'hover:bg-slate-800/50 hover:text-white'
                  }`}
                >
                  {queryGroupActive && <div className="absolute left-0 w-1 h-6 bg-blue-500 rounded-r-full" />}
                  <MessageSquare size={20} className={queryGroupActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'} />
                  <span className="text-[13px] flex-1 text-left">AI Query</span>
                  <ChevronRight size={14} className={`text-slate-500 transition-transform duration-200 ${queryGroupOpen ? 'rotate-90' : ''}`} />
                </button>

                {queryGroupOpen && (
                  <div className="ml-3 pl-3 border-l border-slate-700/50 space-y-0.5 mt-0.5">
                    {queryGroupItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => !item.disabled && onNavigate(item.id)}
                        disabled={item.disabled}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all relative group ${
                          currentView === item.id
                            ? 'bg-blue-600/10 text-white font-semibold'
                            : item.disabled
                              ? 'opacity-40 cursor-not-allowed'
                              : 'hover:bg-slate-800/50 hover:text-white'
                        }`}
                      >
                        {currentView === item.id && <div className="absolute left-0 w-1 h-5 bg-blue-500 rounded-r-full" />}
                        <item.icon size={16} className={currentView === item.id ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'} />
                        <span className="text-[12px]">{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </nav>
        </div>

        {/* Data Manager group */}
        {dataManagerItems.length > 0 && (
          <div>
            {!collapsed && <h2 className="px-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Data</h2>}
            <nav className={`space-y-0.5 ${collapsed ? 'px-1.5' : 'px-3'}`}>
              {collapsed ? (
                <NavBtn id="management" label="Data Manager" icon={FolderOpen} disabled={!isConfigured} />
              ) : (
                <>
                  <button
                    onClick={() => setDataManagerOpen(o => !o)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all relative group ${
                      dataManagerActive ? 'bg-blue-600/10 text-white font-semibold' : 'hover:bg-slate-800/50 hover:text-white'
                    }`}
                  >
                    {dataManagerActive && <div className="absolute left-0 w-1 h-6 bg-blue-500 rounded-r-full" />}
                    <FolderOpen size={20} className={dataManagerActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'} />
                    <span className="text-[13px] flex-1 text-left">Data Manager</span>
                    <ChevronRight size={14} className={`text-slate-500 transition-transform duration-200 ${dataManagerOpen ? 'rotate-90' : ''}`} />
                  </button>

                  {dataManagerOpen && (
                    <div className="ml-3 pl-3 border-l border-slate-700/50 space-y-0.5 mt-0.5">
                      {dataManagerItems.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => !item.disabled && onNavigate(item.id)}
                          disabled={item.disabled}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all relative group ${
                            currentView === item.id
                              ? 'bg-blue-600/10 text-white font-semibold'
                              : item.disabled
                                ? 'opacity-40 cursor-not-allowed'
                                : 'hover:bg-slate-800/50 hover:text-white'
                          }`}
                        >
                          {currentView === item.id && <div className="absolute left-0 w-1 h-5 bg-blue-500 rounded-r-full" />}
                          <item.icon size={16} className={currentView === item.id ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'} />
                          <span className="text-[12px]">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </nav>
          </div>
        )}

        {/* Tools */}
        <div>
          {!collapsed && <h2 className="px-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Tools</h2>}
          <nav className={`space-y-0.5 ${collapsed ? 'px-1.5' : 'px-3'}`}>
            {toolsItems.map((item) => (
              <NavBtn key={item.id} id={item.id} label={item.label} icon={item.icon} disabled={item.disabled} />
            ))}
          </nav>
        </div>

        {/* Admin */}
        <div>
          {!collapsed && <h2 className="px-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Admin</h2>}
          <nav className={`space-y-0.5 ${collapsed ? 'px-1.5' : 'px-3'}`}>
            {adminItems.map((item) => (
              <NavBtn key={item.id} id={item.id} label={item.label} icon={item.icon} disabled={item.disabled} badge={item.badge} />
            ))}
          </nav>
        </div>
      </div>

      {/* Footer */}
      <div className={`border-t border-slate-800 shrink-0 ${collapsed ? 'p-2 space-y-2' : 'p-4 space-y-3'}`}>
        {/* Workspace Switcher */}
        <WorkspaceSwitcher
          currentWorkspaceId={user?.workspace_id}
          collapsed={collapsed}
          onCreateOrg={onCreateOrg}
        />

        {user && !collapsed && (
          <div className="bg-slate-800/50 p-3 rounded-2xl flex items-center gap-3 border border-slate-700/50">
            <div className="size-9 bg-slate-700 rounded-xl flex items-center justify-center text-blue-400 shrink-0 border border-slate-600 shadow-inner">
              <UserIcon size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-white truncate">{user.display_name}</p>
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate max-w-[80px]">{user.role}</span>
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

        {user && collapsed && (
          <div className="flex flex-col items-center gap-2">
            <div
              className="size-9 bg-slate-700 rounded-xl flex items-center justify-center text-blue-400 border border-slate-600"
              title={`${user.display_name} (${user.role})`}
            >
              <UserIcon size={18} />
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                title="Log out"
              >
                <LogOut size={14} />
              </button>
            )}
          </div>
        )}

        {!user && !collapsed && (
          <button className="w-full flex items-center gap-3 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all text-[13px]">
            <Settings size={18} />
            Workspace Settings
          </button>
        )}

        {!collapsed && currentVersion && (
          <div className="flex items-center justify-center gap-2 pt-1">
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
