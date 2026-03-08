import { LayoutDashboard, Database, Upload, MessageSquare, Share2, Settings, Clock, Wrench, TrendingUp, Radio, LogOut, Palette, Lightbulb, Bell, PinIcon, BarChart3 } from 'lucide-react';

interface Branding {
  org_name: string;
  tagline: string;
  primary_color: string;
  logo_url: string;
}

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  isConfigured: boolean;
  branding: Branding;
  unseenInsights: number;
}

export function Sidebar({ currentView, onNavigate, isConfigured, branding, unseenInsights }: SidebarProps) {
  const primaryColor = branding.primary_color || '#2563eb';

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'insights', label: 'Insights', icon: Lightbulb, badge: unseenInsights > 0 ? unseenInsights : undefined },
    { id: 'boards', label: 'Dashboards', icon: PinIcon, disabled: !isConfigured },
    { id: 'alerts', label: 'Alerts', icon: Bell, disabled: !isConfigured },
    { id: 'database', label: 'Database', icon: Database },
    { id: 'management', label: 'Data Management', icon: Database, disabled: !isConfigured },
    { id: 'import', label: 'Import Files', icon: Upload },
    { id: 'profiler', label: 'Data Profiler', icon: BarChart3, disabled: !isConfigured },
    { id: 'query', label: 'Query', icon: MessageSquare, disabled: !isConfigured },
    { id: 'transform', label: 'Transform Data', icon: Wrench, disabled: !isConfigured },
    { id: 'analytics', label: 'Advanced Analytics', icon: TrendingUp, disabled: !isConfigured },
    { id: 'streaming', label: 'Real-Time Stream', icon: Radio, disabled: !isConfigured },
    { id: 'scheduled', label: 'Scheduled Reports', icon: Clock },
    { id: 'reports', label: 'Reports', icon: Share2 },
    { id: 'branding', label: 'Branding', icon: Palette },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      {/* Logo / Branding Header */}
      <div className="p-6 border-b border-gray-200" style={{ borderLeftColor: primaryColor, borderLeftWidth: 4 }}>
        {branding.logo_url ? (
          <img
            src={branding.logo_url}
            alt={branding.org_name}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            className="h-9 w-auto object-contain mb-1"
          />
        ) : (
          <h1 className="text-2xl font-bold" style={{ color: primaryColor }}>
            {branding.org_name || 'Vantage AI'}
          </h1>
        )}
        <p className="text-sm text-gray-500 mt-1">{branding.tagline || 'Analytics Portal'}</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          const isDisabled = item.disabled;

          return (
            <button
              key={item.id}
              onClick={() => !isDisabled && onNavigate(item.id)}
              disabled={isDisabled}
              className={`
                w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors
                ${isDisabled ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50'}
              `}
              style={isActive ? { backgroundColor: `${primaryColor}15`, color: primaryColor } : {}}
            >
              <Icon className="size-5" />
              <span className="font-medium flex-1">{item.label}</span>
              {item.badge !== undefined && (
                <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Logout Action */}
      <div className="p-4 border-t border-gray-200">
        <button
          onClick={() => {
            localStorage.removeItem('vantage_api_key');
            window.location.reload();
          }}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-red-600 hover:bg-red-50"
        >
          <LogOut className="size-5" />
          <span className="font-medium">Logout</span>
        </button>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200">
        <div className="text-xs text-gray-500">
          <p>Version 2.0</p>
          <p className="mt-1">© 2026 {branding.org_name || 'Vantage AI'}</p>
        </div>
      </div>
    </aside>
  );
}