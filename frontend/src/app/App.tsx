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
import { LandingPage } from './components/LandingPage';
import { AboutPage } from './components/AboutPage';
import { api, clearSession, getApiKey, getAccessToken } from '../lib/api';

/** Decode JWT payload without verifying signature (client-side only) */
function decodeJwtPayload(token: string): any {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch { return null; }
}

/** Returns true if the token is expired or expires within 30 seconds */
function isTokenExpiredOrExpiring(token: string | null): boolean {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 < Date.now() + 30_000;
}

type View = 'dashboard' | 'database' | 'management' | 'import' | 'query' | 'reports' |
  'scheduled' | 'transform' | 'analytics' | 'streaming' | 'settings' | 'branding' |
  'insights' | 'alerts' | 'boards' | 'profiler' | 'about';

// What unauthenticated visitors see
type PublicScreen = 'landing' | 'auth' | 'about';

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
  const [initialQuery, setInitialQuery] = useState<string | null>(null);
  const [publicScreen, setPublicScreen] = useState<PublicScreen>('landing');

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

  // Proactively refresh token on startup if it's expired or nearly expired
  useEffect(() => {
    if (!accessToken || !apiKey) return;
    if (!isTokenExpiredOrExpiring(accessToken)) return;

    const refreshToken = localStorage.getItem('vantage_refresh_token');
    if (!refreshToken) return;

    console.log('[App] Access token expired on startup — proactively refreshing...');
    fetch(`${(import.meta as any).env?.VITE_API_URL || 'http://localhost:8000'}/auth/refresh?refresh_token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (data.access_token) {
          localStorage.setItem('vantage_access_token', data.access_token);
          setAccessToken(data.access_token);
          console.log('[App] Token refreshed proactively at startup.');
        }
      })
      .catch(() => {
        console.warn('[App] Startup token refresh failed — logging out.');
        clearSession();
        setApiKey(null);
        setAccessToken(null);
        setUser(null);
        setPublicScreen('landing');
      });
  }, []); // run once on mount

  // Check if org has a database configured.
  useEffect(() => {
    if (!isAuthenticated) return;
    api.get('/tables')
      .then(() => setIsConfigured(true))
      .catch(() => setIsConfigured(false));
  }, [isAuthenticated]);

  // Fetch branding from API on load
  useEffect(() => {
    if (!isAuthenticated) return;
    api.get<Branding>('/branding')
      .then((data) => {
        setBranding(data);
        localStorage.setItem('vantage_branding', JSON.stringify(data));
      })
      .catch(() => { /* keep localStorage fallback */ });
  }, [isAuthenticated]);

  // Poll unseen insights count every 30s
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchCount = () =>
      api.get<{ insights: any[] }>('/insights?limit=100')
        .then((data) => {
          setUnseenCount((data.insights || []).filter((i: any) => i.seen === 0).length);
        })
        .catch(() => { });

    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
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
        await api.post(`/auth/logout?refresh_token=${encodeURIComponent(refresh)}`);
      }
    } catch (e) {
      console.error('Logout error', e);
    }
    clearSession();
    setApiKey(null);
    setAccessToken(null);
    setUser(null);
    setPublicScreen('landing');
  };

  // ── Unauthenticated routing ──────────────────────────────────────────────
  if (!isAuthenticated) {
    if (publicScreen === 'about') {
      return <AboutPage />;
    }
    if (publicScreen === 'auth') {
      return (
        <AuthPage
          onLoginSuccess={handleLoginSuccess}
          existingKey={apiKey || undefined}
        />
      );
    }
    // Default: landing page
    return <LandingPage onGetStarted={() => setPublicScreen('auth')} />;
  }

  // ── Authenticated app ────────────────────────────────────────────────────
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
        {currentView === 'dashboard' && (
          <Dashboard
            onNavigate={(view, query) => {
              setCurrentView(view as View);
              if (query) setInitialQuery(query);
            }}
            isConfigured={isConfigured}
          />
        )}
        {currentView === 'database' && (
          <DatabaseConfig
            apiKey={apiKey!}
            onConfigured={() => setIsConfigured(true)}
            onNavigate={(view) => setCurrentView(view as View)}
          />
        )}
        {currentView === 'management' && (
          <DataManagement apiKey={apiKey!} onConfigured={() => setIsConfigured(true)} />
        )}
        {currentView === 'import' && (
          <FileImport
            apiKey={apiKey!}
            onConfigured={() => setIsConfigured(true)}
            onQueryClick={(query) => {
              setInitialQuery(query);
              setCurrentView('query');
            }}
          />
        )}
        {currentView === 'query' && (
          <QueryInterface
            apiKey={apiKey!}
            initialQuery={initialQuery || undefined}
            onQueryProcessed={() => setInitialQuery(null)}
          />
        )}
        {currentView === 'reports' && <Reports apiKey={apiKey!} />}
        {currentView === 'scheduled' && <ScheduledReports apiKey={apiKey!} />}
        {currentView === 'transform' && <DataTransformation apiKey={apiKey!} />}
        {currentView === 'analytics' && <AdvancedAnalytics apiKey={apiKey!} />}
        {currentView === 'streaming' && <RealTimeStreaming apiKey={apiKey!} />}
        {currentView === 'insights' && <Insights />}
        {currentView === 'alerts' && <AlertsManager apiKey={apiKey!} />}
        {currentView === 'boards' && <DashboardsView apiKey={apiKey!} />}
        {currentView === 'profiler' && <DataProfiler apiKey={apiKey!} />}
        {currentView === 'about' && <AboutPage />}
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
      </main>
    </div>
  );
}