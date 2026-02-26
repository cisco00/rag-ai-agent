import { LayoutDashboard, Database, Upload, MessageSquare, Share2, Settings, Clock, Wrench, TrendingUp, Radio, LogOut } from 'lucide-react';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  isConfigured: boolean;
}

export function Sidebar({ currentView, onNavigate, isConfigured }: SidebarProps) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'database', label: 'Database', icon: Database },
    { id: 'management', label: 'Data Management', icon: Database, disabled: !isConfigured },
    { id: 'import', label: 'Import Files', icon: Upload },
    { id: 'query', label: 'Query', icon: MessageSquare, disabled: !isConfigured },
    { id: 'transform', label: 'Transform Data', icon: Wrench, disabled: !isConfigured },
    { id: 'analytics', label: 'Advanced Analytics', icon: TrendingUp, disabled: !isConfigured },
    { id: 'streaming', label: 'Real-Time Stream', icon: Radio, disabled: !isConfigured },
    { id: 'scheduled', label: 'Scheduled Reports', icon: Clock },
    { id: 'reports', label: 'Reports', icon: Share2 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-blue-600">Vantage AI</h1>
        <p className="text-sm text-gray-500 mt-1">Analytics Portal</p>
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
                ${isActive
                  ? 'bg-blue-50 text-blue-600'
                  : isDisabled
                    ? 'text-gray-400 cursor-not-allowed'
                    : 'text-gray-700 hover:bg-gray-50'
                }
              `}
            >
              <Icon className="size-5" />
              <span className="font-medium">{item.label}</span>
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
          <p>Version 1.0</p>
          <p className="mt-1">© 2026 Vantage AI</p>
        </div>
      </div>
    </aside>
  );
}