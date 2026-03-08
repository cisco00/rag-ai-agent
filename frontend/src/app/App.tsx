import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { DatabaseConfig } from './components/DatabaseConfig';
import { FileImport } from './components/FileImport';
import { QueryInterface } from './components/QueryInterface';
import { Reports } from './components/Reports';
import { AuthPage } from './components/AuthPage';
import { ScheduledReports } from './components/ScheduledReports';
import { DataTransformation } from './components/DataTransformation';
import { AdvancedAnalytics } from './components/AdvancedAnalytics';
import { RealTimeStreaming } from './components/RealTimeStreaming';
import { DataManagement } from './components/DataManagement';
import { BrandingSettings } from './components/BrandingSettings';
import { Insights } from './components/Insights';
import { AlertsManager } from './components/AlertsManager';
import { DashboardsView } from './components/DashboardsView';
import { DataProfiler } from './components/DataProfiler';
import { api, clearSession, getApiKey, getAccessToken } from '../lib/api';

type View = 'dashboard' | 'database' | 'management' | 'import' | 'query' | 'reports' |
  'scheduled' | 'transform' | 'analytics' | 'streaming' | 'settings' | 'branding' |
  'insights' | 'alerts' | 'boards' | 'profiler';

interface Branding {
  org_name: string;
  tagline: string;
  primary_color: string;
  logo_url: string;
}

const DEFAULT_BRANDING: Branding = {
  org_name: 'Vantage AI',
  tagline: 'Analytics Portal',
  primary_color: '#2563eb',
  logo_url: '',
};

export default function App() {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [apiKey, setApiKey] = useState<string | null>(getApiKey());
  const [accessToken, setAccessToken] = useState<string | null>(getAccessToken());
  const [user, setUser] = useState<any>(() => {
    try {
      const saved = localStorage.getItem('vantage_user');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const [isConfigured, setIsConfigured] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const [branding, setBranding] = useState<Branding>(() => {
    try {
      const saved = localStorage.getItem('vantage_branding');
      if (saved) return { ...DEFAULT_BRANDING, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return DEFAULT_BRANDING;
  });

  const isAuthenticated = !!(apiKey && accessToken);

  useEffect(() => {
    const checkConfigStatus = async () => {
      if (isAuthenticated) {
        try {
          await api.get('/tables');
          setIsConfigured(true);
        } catch (error) {
          setIsConfigured(false);
        }
      }
    };
    checkConfigStatus();
  }, [isAuthenticated]);

  // Fetch branding from API on load
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchBranding = async () => {
      try {
        const data = await api.get<Branding>('/branding');
        setBranding(data);
        localStorage.setItem('vantage_branding', JSON.stringify(data));
      } catch (err) {
        // keep whatever was loaded from localStorage
      }
    };
    fetchBranding();
  }, [isAuthenticated]);

  // Fetch unseen insights count
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchUnseenCount = async () => {
      try {
        const data = await api.get<{ insights: any[] }>('/insights?limit=100');
        const count = (data.insights || []).filter((i: any) => i.seen === 0).length;
        setUnseenCount(count);
      } catch (err) {
        console.error('Failed to fetch unseen insights', err);
      }
    };
    fetchUnseenCount();
    const interval = setInterval(fetchUnseenCount, 30000); // 30s
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleLoginSuccess = (key: string, access: string, refresh: string, userData: any) => {
    setApiKey(key);
    setAccessToken(access);
    setUser(userData);
    localStorage.setItem('vantage_api_key', key);
    localStorage.setItem('vantage_access_token', access);
    localStorage.setItem('vantage_refresh_token', refresh);
    localStorage.setItem('vantage_user', JSON.stringify(userData));
  };

  const handleLogout = async () => {
    try {
      const refresh = localStorage.getItem('vantage_refresh_token');
      if (refresh) {
        await api.post('/auth/logout', {}, { headers: { 'refresh-token': refresh } });
      }
    } catch (e) {
      console.error("Logout error", e);
    }
    clearSession();
    setApiKey(null);
    setAccessToken(null);
    setUser(null);
    window.location.reload();
  };

  // If not authenticated, show setup/auth screen
  if (!isAuthenticated) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} existingKey={apiKey || undefined} />;
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        currentView={currentView}
        onNavigate={(view) => setCurrentView(view as View)}
        isConfigured={isConfigured}
        branding={branding}
        unseenInsights={unseenCount}
        user={user}
        onLogout={handleLogout}
      />
      <main className="flex-1 overflow-auto">
        {currentView === 'dashboard' && <Dashboard onNavigate={(view) => setCurrentView(view as View)} isConfigured={isConfigured} />}
        {currentView === 'database' && (
          <DatabaseConfig
            apiKey={apiKey!}
            onConfigured={() => setIsConfigured(true)}
            onNavigate={(view) => setCurrentView(view as View)}
          />
        )}
        {currentView === 'management' && <DataManagement apiKey={apiKey!} onConfigured={() => setIsConfigured(true)} />}
        {currentView === 'import' && <FileImport apiKey={apiKey!} onConfigured={() => setIsConfigured(true)} />}
        {currentView === 'query' && <QueryInterface apiKey={apiKey!} />}
        {currentView === 'reports' && <Reports apiKey={apiKey!} />}
        {currentView === 'scheduled' && <ScheduledReports apiKey={apiKey!} />}
        {currentView === 'transform' && <DataTransformation apiKey={apiKey!} />}
        {currentView === 'analytics' && <AdvancedAnalytics apiKey={apiKey!} />}
        {currentView === 'streaming' && <RealTimeStreaming apiKey={apiKey!} />}
        {currentView === 'insights' && <Insights />}
        {currentView === 'branding' && (
          <BrandingSettings onBrandingChange={(b) => setBranding(b)} />
        )}
        {currentView === 'settings' && (
          <AuthPage
            onLoginSuccess={() => { }}
            existingKey={apiKey}
            isSettingsMode={true}
          />
        )}
        {currentView === 'alerts' && <AlertsManager apiKey={apiKey!} />}
        {currentView === 'boards' && <DashboardsView apiKey={apiKey!} />}
        {currentView === 'profiler' && <DataProfiler apiKey={apiKey!} />}
      </main>
    </div>
  );
}