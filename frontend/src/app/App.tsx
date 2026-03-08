import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { DatabaseConfig } from './components/DatabaseConfig';
import { FileImport } from './components/FileImport';
import { QueryInterface } from './components/QueryInterface';
import { Reports } from './components/Reports';
import { ApiKeyManager } from './components/ApiKeyManager';
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
import { api } from '../lib/api';

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
  const [apiKey, setApiKey] = useState<string | null>(localStorage.getItem('vantage_api_key'));
  const [isConfigured, setIsConfigured] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const [branding, setBranding] = useState<Branding>(() => {
    try {
      const saved = localStorage.getItem('vantage_branding');
      if (saved) return { ...DEFAULT_BRANDING, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return DEFAULT_BRANDING;
  });

  useEffect(() => {
    const checkConfigStatus = async () => {
      if (apiKey) {
        try {
          await api.get('/tables');
          setIsConfigured(true);
        } catch (error) {
          setIsConfigured(false);
        }
      }
    };
    checkConfigStatus();
  }, [apiKey]);

  // Fetch branding from API on load, fall back to localStorage
  useEffect(() => {
    if (!apiKey) return;
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
  }, [apiKey]);

  // Fetch unseen insights count
  useEffect(() => {
    if (!apiKey) return;
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
  }, [apiKey]);

  const handleApiKeySet = (key: string) => {
    setApiKey(key);
    localStorage.setItem('vantage_api_key', key);
  };

  // If no API key, show setup screen
  if (!apiKey) {
    return <ApiKeyManager onApiKeySet={handleApiKeySet} />;
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        currentView={currentView}
        onNavigate={(view) => setCurrentView(view as View)}
        isConfigured={isConfigured}
        branding={branding}
        unseenInsights={unseenCount}
      />
      <main className="flex-1 overflow-auto">
        {currentView === 'dashboard' && <Dashboard onNavigate={(view) => setCurrentView(view as View)} isConfigured={isConfigured} />}
        {currentView === 'database' && (
          <DatabaseConfig
            apiKey={apiKey}
            onConfigured={() => setIsConfigured(true)}
            onNavigate={(view) => setCurrentView(view as View)}
          />
        )}
        {currentView === 'management' && <DataManagement apiKey={apiKey} onConfigured={() => setIsConfigured(true)} />}
        {currentView === 'import' && <FileImport apiKey={apiKey} onConfigured={() => setIsConfigured(true)} />}
        {currentView === 'query' && <QueryInterface apiKey={apiKey} />}
        {currentView === 'reports' && <Reports apiKey={apiKey} />}
        {currentView === 'scheduled' && <ScheduledReports apiKey={apiKey} />}
        {currentView === 'transform' && <DataTransformation apiKey={apiKey} />}
        {currentView === 'analytics' && <AdvancedAnalytics apiKey={apiKey} />}
        {currentView === 'streaming' && <RealTimeStreaming apiKey={apiKey} />}
        {currentView === 'insights' && <Insights />}
        {currentView === 'branding' && (
          <BrandingSettings onBrandingChange={(b) => setBranding(b)} />
        )}
        {currentView === 'settings' && (
          <ApiKeyManager
            onApiKeySet={handleApiKeySet}
            existingKey={apiKey}
          />
        )}
        {currentView === 'alerts' && <AlertsManager apiKey={apiKey} />}
        {currentView === 'boards' && <DashboardsView apiKey={apiKey} />}
        {currentView === 'profiler' && <DataProfiler apiKey={apiKey} />}
      </main>
    </div>
  );
}