import { useState, useEffect, useRef } from 'react';
import {
    Cloud,
    Zap,
    RefreshCw,
    Link as LinkIcon,
    CheckCircle2,
    AlertCircle,
    ArrowRight,
    Settings,
    MoreVertical,
    Unplug,
    Save,
    X
} from 'lucide-react';
import { Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../lib/api';

interface Integration {
    id: string;
    name: string;
    icon: string;
    description: string;
    status: 'ready' | 'beta' | 'coming_soon';
    credentials_configured: boolean;
}

interface ConnectedSource {
    id: string;
    name: string;
    source_type: string;
    last_sync: string | null;
}

export function Integrations() {
    const [available, setAvailable] = useState<Integration[]>([]);
    const [connected, setConnected] = useState<ConnectedSource[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [connecting, setConnecting] = useState<string | null>(null);
    const [configIntegration, setConfigIntegration] = useState<Integration | null>(null);
    const [configInitialTab, setConfigInitialTab] = useState<'sync' | 'provision'>('sync');
    const [menuOpen, setMenuOpen] = useState<string | null>(null);
    const [disconnectConfirm, setDisconnectConfirm] = useState<Integration | null>(null);
    const [disconnecting, setDisconnecting] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        loadData();
    }, []);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [av, con] = await Promise.all([
                api.get<Integration[]>('/integrations/available'),
                api.get<ConnectedSource[]>('/data/sources')
            ]);
            setAvailable(av);
            setConnected(con || []);
            setError(null);
        } catch (err) {
            console.error(err);
            setError('Failed to load integrations. Please check your connection.');
        } finally {
            setLoading(false);
        }
    };

    const showSuccess = (msg: string) => {
        setSuccess(msg);
        setTimeout(() => setSuccess(null), 4000);
    };

    const openProvision = (integration: Integration) => {
        setConfigInitialTab('provision');
        setConfigIntegration(integration);
    };

    const handleConnect = async (integration: Integration) => {
        const provider = integration.id;

        // If credentials aren't configured yet, send user to provisioning tab first
        if (!integration.credentials_configured) {
            openProvision(integration);
            return;
        }

        try {
            setConnecting(provider);

            // Real OAuth popup flow
            const res = await api.get<{ url: string }>(`/integrations/${provider}/auth-url`);

            const width = 600;
            const height = 700;
            const left = window.screenX + (window.outerWidth - width) / 2;
            const top = window.screenY + (window.outerHeight - height) / 2;

            const popup = window.open(
                res.url,
                `Connect ${provider}`,
                `width=${width},height=${height},left=${left},top=${top}`
            );

            const handleMessage = (event: MessageEvent) => {
                if (event.data === 'crm_auth_success') {
                    showSuccess(`${provider.charAt(0).toUpperCase() + provider.slice(1)} connected successfully.`);
                    loadData();
                    window.removeEventListener('message', handleMessage);
                    setConnecting(null);
                }
            };
            window.addEventListener('message', handleMessage);

            const timer = setInterval(() => {
                if (popup?.closed) {
                    clearInterval(timer);
                    setConnecting(null);
                }
            }, 1000);

        } catch (err: any) {
            console.error(err);
            const detail = err?.response?.data?.detail || err?.message || '';
            // If the error says credentials are missing, open the provisioning modal
            if (detail.toLowerCase().includes('client id') || detail.toLowerCase().includes('not configured')) {
                setError('OAuth credentials are not configured. Enter your app credentials first.');
                openProvision(integration);
            } else {
                setError(`Could not initiate ${provider} connection. ${detail}`);
            }
            setConnecting(null);
        }
    };

    const handleSync = async (sourceId: string) => {
        try {
            setSyncing(sourceId);
            await api.post('/integrations/sync', { source_id: parseInt(sourceId) });
            showSuccess('Sync started in background.');
            setTimeout(() => {
                setSyncing(null);
                loadData();
            }, 1200);
        } catch (err) {
            setSyncing(null);
            setError('Sync failed. Please try again.');
        }
    };

    const handleManualImport = async (provider: string) => {
        try {
            setSyncing(provider);
            await api.post(`/integrations/import/${provider}`);
            showSuccess('Import started in background.');
            setTimeout(() => {
                setSyncing(null);
                loadData();
            }, 1200);
        } catch (err) {
            setSyncing(null);
            setError(`Manual import for ${provider} failed.`);
        }
    };

    const handleDisconnect = async (provider: string) => {
        try {
            setDisconnecting(provider);
            await api.delete(`/integrations/${provider}/disconnect`);
            showSuccess(`${provider.charAt(0).toUpperCase() + provider.slice(1)} disconnected.`);
            loadData();
        } catch (err: any) {
            setError(err?.response?.data?.detail || `Failed to disconnect ${provider}.`);
        } finally {
            setDisconnecting(null);
            setDisconnectConfirm(null);
        }
    };

    const formatLastSync = (last_sync: string | null) => {
        if (!last_sync) return 'Never synced';
        const d = new Date(last_sync);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (isToday) return `Today at ${time}`;
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
        return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
    };

    const filteredIntegrations = available.filter(i =>
        i.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
                    className="relative"
                >
                    <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Zap className="w-6 h-6 text-primary" />
                    </div>
                </motion.div>
                <p className="text-muted-foreground font-medium animate-pulse">Initializing CRM ecosystem...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-8 p-6 lg:p-10 transition-all">
            {/* Header */}
            <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="flex flex-col md:flex-row md:items-end justify-between gap-6"
            >
                <div className="space-y-2">
                    <h1 className="text-4xl md:text-5xl font-black tracking-tighter bg-gradient-to-br from-foreground to-foreground/50 bg-clip-text text-transparent">
                        Integrations
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-2xl font-medium">
                        Seamlessly synchronize your CRM data with Vantage AI to power deep cross-functional insights and predictive analytics.
                    </p>
                </div>

                <div className="relative w-full md:w-80 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <input
                        type="text"
                        placeholder="Search integrations..."
                        className="w-full pl-10 pr-4 py-3 bg-secondary/30 backdrop-blur-xl border border-border/50 rounded-2xl focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </motion.div>

            {/* Toasts */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ height: 0, opacity: 0, y: -10 }}
                        animate={{ height: 'auto', opacity: 1, y: 0 }}
                        exit={{ height: 0, opacity: 0, y: -10 }}
                        className="p-4 bg-destructive/10 border border-destructive/20 rounded-2xl flex items-start gap-3 text-destructive overflow-hidden"
                    >
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-bold">Error</p>
                            <p className="text-sm opacity-90">{error}</p>
                        </div>
                        <button onClick={() => setError(null)} className="text-sm font-bold hover:underline">Dismiss</button>
                    </motion.div>
                )}
                {success && (
                    <motion.div
                        initial={{ height: 0, opacity: 0, y: -10 }}
                        animate={{ height: 'auto', opacity: 1, y: 0 }}
                        exit={{ height: 0, opacity: 0, y: -10 }}
                        className="p-4 bg-primary/10 border border-primary/20 rounded-2xl flex items-start gap-3 text-primary overflow-hidden"
                    >
                        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-bold">Success</p>
                            <p className="text-sm opacity-90">{success}</p>
                        </div>
                        <button onClick={() => setSuccess(null)} className="text-sm font-bold hover:underline">Dismiss</button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Integration Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8" ref={menuRef}>
                {filteredIntegrations.map((integration, index) => {
                    const connectedSource = connected.find(c => c.source_type === `crm_${integration.id}`);
                    const active = !!connectedSource;

                    const brandColor = integration.id === 'hubspot' ? 'bg-[#ff7a59]' : 'bg-[#00a1e0]';
                    const brandHover = integration.id === 'hubspot' ? 'hover:bg-[#ff8f75]' : 'hover:bg-[#1ab6f5]';

                    return (
                        <motion.div
                            key={integration.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            whileHover={{ y: -5 }}
                            className={`group relative overflow-hidden rounded-[2.5rem] border transition-all duration-500 shadow-sm hover:shadow-2xl hover:shadow-primary/10 ${
                                active ? 'bg-primary/[0.04] border-primary/20' : 'bg-card border-border/50 hover:border-primary/40'
                            } ${!active && !integration.credentials_configured ? 'border-dashed' : ''}`}
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                            <div className="p-8 space-y-8 relative z-10">
                                <div className="flex justify-between items-start">
                                    <div className={`p-5 rounded-3xl ${active || connecting === integration.id ? brandColor : 'bg-secondary/80'} text-white transition-all duration-500 group-hover:scale-110 shadow-lg`}>
                                        <Cloud className="w-8 h-8" />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {active ? (
                                            <span className="flex items-center gap-1.5 px-4 py-1.5 bg-primary/10 text-primary text-[10px] font-black uppercase tracking-widest rounded-full border border-primary/20">
                                                <CheckCircle2 className="w-3 h-3" />
                                                Active
                                            </span>
                                        ) : (
                                            <span className="px-4 py-1.5 bg-secondary text-muted-foreground text-[10px] font-black uppercase tracking-widest rounded-full">
                                                Available
                                            </span>
                                        )}

                                        {/* MoreVertical dropdown — only shown when connected */}
                                        {active && (
                                            <div className="relative">
                                                <button
                                                    onClick={() => setMenuOpen(menuOpen === integration.id ? null : integration.id)}
                                                    className="p-2 hover:bg-secondary rounded-xl transition-colors"
                                                >
                                                    <MoreVertical className="w-4 h-4 text-muted-foreground" />
                                                </button>
                                                <AnimatePresence>
                                                    {menuOpen === integration.id && (
                                                        <motion.div
                                                            initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                                            exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                                            className="absolute right-0 top-10 w-44 bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden"
                                                        >
                                                            <button
                                                                onClick={() => { setMenuOpen(null); setConfigIntegration(integration); }}
                                                                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold hover:bg-secondary transition-colors"
                                                            >
                                                                <Settings className="w-4 h-4 text-muted-foreground" />
                                                                Settings
                                                            </button>
                                                            <button
                                                                onClick={() => { setMenuOpen(null); handleSync(connectedSource!.id); }}
                                                                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold hover:bg-secondary transition-colors"
                                                            >
                                                                <RefreshCw className="w-4 h-4 text-muted-foreground" />
                                                                Sync Now
                                                            </button>
                                                            <div className="border-t border-border/50" />
                                                            <button
                                                                onClick={() => { setMenuOpen(null); setDisconnectConfirm(integration); }}
                                                                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-destructive hover:bg-destructive/10 transition-colors"
                                                            >
                                                                <Unplug className="w-4 h-4" />
                                                                Disconnect
                                                            </button>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <h3 className="text-2xl font-black group-hover:text-primary transition-colors duration-300">{integration.name}</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed font-medium">
                                        {integration.description}
                                    </p>
                                </div>

                                {active ? (
                                    <div className="space-y-6 pt-4 border-t border-border/50">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                                <RefreshCw className="w-3 h-3" />
                                                Last Sync
                                            </span>
                                            <span className="text-xs font-bold text-foreground/80">
                                                {formatLastSync(connectedSource?.last_sync ?? null)}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <motion.button
                                                whileTap={{ scale: 0.95 }}
                                                onClick={() => handleSync(connectedSource!.id)}
                                                disabled={!!syncing}
                                                className="flex h-14 items-center justify-center gap-2 bg-primary text-primary-foreground font-black rounded-2xl hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-primary/20"
                                            >
                                                {syncing === connectedSource!.id ? (
                                                    <RefreshCw className="w-5 h-5 animate-spin" />
                                                ) : (
                                                    <>
                                                        <RefreshCw className="w-5 h-5" />
                                                        Refresh
                                                    </>
                                                )}
                                            </motion.button>
                                            <motion.button
                                                whileTap={{ scale: 1.05 }}
                                                onClick={() => setConfigIntegration(integration)}
                                                className="flex h-14 items-center justify-center gap-2 bg-secondary font-black rounded-2xl hover:bg-secondary/80 transition-all border border-border/50"
                                            >
                                                <Settings className="w-5 h-5 text-muted-foreground" />
                                                Config
                                            </motion.button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {!integration.credentials_configured && (
                                            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
                                                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                                <p className="text-xs text-muted-foreground leading-relaxed">
                                                    OAuth credentials required. Enter your <strong>{integration.name} Developer App</strong> credentials first.
                                                </p>
                                            </div>
                                        )}
                                        <motion.button
                                            whileTap={{ scale: 0.98 }}
                                            onClick={() => handleConnect(integration)}
                                            disabled={connecting === integration.id}
                                            className={`w-full flex h-16 items-center justify-center gap-3 ${
                                                integration.credentials_configured ? `${brandColor} ${brandHover}` : 'bg-secondary hover:bg-secondary/80 border border-border/50'
                                            } ${integration.credentials_configured ? 'text-white' : 'text-foreground'} font-black rounded-[1.5rem] transition-all group/btn relative overflow-hidden shadow-xl disabled:opacity-75`}
                                        >
                                            {integration.credentials_configured && (
                                                <div className="absolute inset-0 bg-white/10 translate-x-[-100%] group-hover/btn:translate-x-0 transition-transform duration-500" />
                                            )}
                                            <div className="relative flex items-center gap-3">
                                                {connecting === integration.id ? (
                                                    <RefreshCw className="w-5 h-5 animate-spin" />
                                                ) : integration.credentials_configured ? (
                                                    <LinkIcon className="w-5 h-5 group-hover/btn:rotate-12 transition-transform duration-300" />
                                                ) : (
                                                    <Settings className="w-5 h-5" />
                                                )}
                                                <span>
                                                    {connecting === integration.id
                                                        ? 'Opening Login…'
                                                        : integration.credentials_configured
                                                            ? `Login with ${integration.name}`
                                                            : 'Configure App Credentials'}
                                                </span>
                                                {!connecting && integration.credentials_configured && (
                                                    <ArrowRight className="w-5 h-5 ml-1 group-hover/btn:translate-x-2 transition-transform duration-300" />
                                                )}
                                            </div>
                                        </motion.button>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    );
                })}

                {/* Coming Soon Placeholder */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.7 }}
                    className="rounded-[2.5rem] border-2 border-dashed border-border/80 bg-secondary/10 flex flex-col items-center justify-center p-10 space-y-6 group hover:bg-secondary/20 transition-all"
                >
                    <div className="w-16 h-16 rounded-[1.5rem] bg-secondary/80 flex items-center justify-center text-muted-foreground group-hover:scale-110 transition-transform duration-500">
                        <Zap className="w-8 h-8" />
                    </div>
                    <div className="text-center space-y-2">
                        <p className="text-xl font-black italic">More On Way</p>
                        <p className="text-sm text-muted-foreground font-medium">Request your custom ecosystem</p>
                    </div>
                    <a
                        href="mailto:support@vantage.ai?subject=Integration%20Request"
                        className="px-6 py-2 bg-primary/10 text-primary font-black text-xs uppercase tracking-widest rounded-full hover:bg-primary/20 transition-all"
                    >
                        Suggest Sync
                    </a>
                </motion.div>
            </div>

            {/* Config Modal */}
            <AnimatePresence>
                {configIntegration && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setConfigIntegration(null)}
                            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                        />
                        <ConfigModal
                            integration={configIntegration}
                            onClose={() => { setConfigIntegration(null); loadData(); }}
                            onSuccess={(msg: string) => showSuccess(msg)}
                            handleManualImport={handleManualImport}
                            syncing={syncing}
                            initialTab={configInitialTab}
                        />
                    </div>
                )}
            </AnimatePresence>

            {/* Disconnect Confirm Dialog */}
            <AnimatePresence>
                {disconnectConfirm && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setDisconnectConfirm(null)}
                            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="relative z-10 bg-card border border-border rounded-[2rem] p-8 max-w-md w-full shadow-2xl space-y-6"
                        >
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-destructive/10 rounded-2xl">
                                    <Unplug className="w-6 h-6 text-destructive" />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black">Disconnect {disconnectConfirm.name}?</h3>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        This will remove the connection and stop all syncs. Your already-imported data will remain intact.
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setDisconnectConfirm(null)}
                                    className="flex-1 h-12 bg-secondary font-bold rounded-2xl hover:bg-secondary/80 transition-all border border-border/50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => handleDisconnect(disconnectConfirm.id)}
                                    disabled={disconnecting === disconnectConfirm.id}
                                    className="flex-1 h-12 bg-destructive text-destructive-foreground font-bold rounded-2xl hover:opacity-90 transition-all disabled:opacity-60"
                                >
                                    {disconnecting === disconnectConfirm.id ? (
                                        <RefreshCw className="w-4 h-4 animate-spin mx-auto" />
                                    ) : 'Yes, Disconnect'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Modal
// ─────────────────────────────────────────────────────────────────────────────

const FREQUENCY_OPTIONS = [
    { label: 'Every 15 minutes', value: 15 },
    { label: 'Every 30 minutes', value: 30 },
    { label: 'Every 60 minutes (Default)', value: 60 },
    { label: 'Every 4 hours', value: 240 },
    { label: 'Daily at Midnight', value: 1440 },
    { label: 'Manual Only', value: 0 },
];

const PROVIDER_OBJECTS: Record<string, string[]> = {
    hubspot: ['contacts', 'companies', 'deals', 'tasks'],
    salesforce: ['leads', 'contacts', 'opportunities', 'accounts'],
};

function ConfigModal({ integration, onClose, onSuccess, handleManualImport, syncing, initialTab = 'sync' }: any) {
    const [tab, setTab] = useState<'sync' | 'provision'>(initialTab);
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [redirectUri, setRedirectUri] = useState('');
    const [saving, setSaving] = useState(false);
    const [savingSync, setSavingSync] = useState(false);

    // Sync settings state
    const [frequency, setFrequency] = useState(60);
    const [selectedObjects, setSelectedObjects] = useState<string[]>([]);
    const [loadingSettings, setLoadingSettings] = useState(true);

    const availableObjects = PROVIDER_OBJECTS[integration.id] || [];

    useEffect(() => {
        loadCredentials();
        loadSyncSettings();
    }, []);

    const loadCredentials = async () => {
        try {
            const res = await api.get<any>(`/integrations/${integration.id}/credentials`);
            setClientId(res.client_id || '');
            setRedirectUri(res.redirect_uri || '');
        } catch (e) {
            console.error('Failed to load credentials', e);
        }
    };

    const loadSyncSettings = async () => {
        try {
            setLoadingSettings(true);
            const res = await api.get<any>(`/integrations/${integration.id}/sync-settings`);
            setFrequency(res.frequency ?? 60);
            // Default: all objects selected if none saved yet
            setSelectedObjects(res.objects?.length > 0 ? res.objects : availableObjects);
        } catch (e) {
            setSelectedObjects(availableObjects);
        } finally {
            setLoadingSettings(false);
        }
    };

    const toggleObject = (obj: string) => {
        setSelectedObjects(prev =>
            prev.includes(obj) ? prev.filter(o => o !== obj) : [...prev, obj]
        );
    };

    const handleSaveSyncSettings = async () => {
        try {
            setSavingSync(true);
            await api.post(`/integrations/${integration.id}/sync-settings`, {
                frequency,
                objects: selectedObjects,
            });
            onSuccess('Sync settings saved.');
            onClose();
        } catch (e: any) {
            alert(e.response?.data?.detail || 'Failed to save sync settings.');
        } finally {
            setSavingSync(false);
        }
    };

    const handleSaveCredentials = async () => {
        try {
            setSaving(true);
            await api.post(`/integrations/${integration.id}/credentials`, {
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri
            });
            onSuccess('Credentials saved.');
            setTab('sync');
        } catch (e: any) {
            alert(e.response?.data?.detail || 'Failed to save credentials.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-2xl bg-card border border-border rounded-[3rem] p-8 md:p-10 shadow-2xl space-y-6 overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
        >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />

            <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-4">
                    <div className="p-4 bg-primary text-primary-foreground rounded-2xl">
                        <Settings className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black">{integration.name} Setup</h2>
                        <p className="text-sm text-muted-foreground">Configure your private CRM application.</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex bg-secondary/50 p-1 rounded-2xl border border-border/50">
                        <button
                            onClick={() => setTab('sync')}
                            className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${tab === 'sync' ? 'bg-background shadow-lg text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Sync
                        </button>
                        <button
                            onClick={() => setTab('provision')}
                            className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${tab === 'provision' ? 'bg-background shadow-lg text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Provisioning
                        </button>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-secondary rounded-xl transition-colors">
                        <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                </div>
            </div>

            <div className="relative z-10">
                {tab === 'sync' ? (
                    <div className="space-y-6">
                        {/* Force sync */}
                        <div className="p-6 bg-secondary/30 rounded-[2rem] border border-border/50 space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <h4 className="text-lg font-black italic uppercase tracking-tighter text-primary">Force Sync</h4>
                                    <p className="text-xs text-muted-foreground font-medium">Trigger an immediate data refresh from the source API.</p>
                                </div>
                                <button
                                    onClick={() => {
                                        handleManualImport(integration.id);
                                        onClose();
                                    }}
                                    disabled={!!syncing}
                                    className="px-6 py-3 bg-foreground text-background text-xs font-black rounded-2xl hover:opacity-90 active:scale-95 transition-all shadow-xl"
                                >
                                    {syncing === integration.id ? 'Starting...' : 'Import Now'}
                                </button>
                            </div>
                        </div>

                        {/* Frequency */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2">Sync Frequency</label>
                            <select
                                className="w-full h-14 px-5 bg-secondary/50 border border-border rounded-2xl outline-none focus:ring-2 focus:ring-primary/20 appearance-none font-bold"
                                value={frequency}
                                onChange={(e) => setFrequency(Number(e.target.value))}
                            >
                                {FREQUENCY_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Sync Objects */}
                        <div className="space-y-4">
                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2">Sync Objects</label>
                            {loadingSettings ? (
                                <div className="h-12 flex items-center px-2 text-sm text-muted-foreground">Loading...</div>
                            ) : (
                                <div className="grid grid-cols-2 gap-3">
                                    {availableObjects.map(obj => {
                                        const checked = selectedObjects.includes(obj);
                                        return (
                                            <button
                                                key={obj}
                                                type="button"
                                                onClick={() => toggleObject(obj)}
                                                className={`flex items-center gap-3 p-4 rounded-2xl border transition-colors text-left ${
                                                    checked
                                                        ? 'bg-primary/10 border-primary/40'
                                                        : 'bg-secondary/30 border-border/50 hover:border-primary/20'
                                                }`}
                                            >
                                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                                    checked ? 'border-primary bg-primary' : 'border-muted-foreground/40 bg-transparent'
                                                }`}>
                                                    {checked && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
                                                </div>
                                                <span className="text-sm font-bold capitalize">{obj}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="bg-primary/5 border border-primary/20 p-5 rounded-[2rem] flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Provide your <strong>{integration.name} Developer App</strong> credentials below.
                                This allows Vantage AI to connect directly to your instance using your preferred application settings.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2">Client ID</label>
                                <input
                                    type="text"
                                    className="w-full h-14 px-5 bg-secondary/30 border border-border rounded-2xl outline-none focus:border-primary font-bold transition-all"
                                    placeholder="Enter your application client_id"
                                    value={clientId}
                                    onChange={(e) => setClientId(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2">Client Secret</label>
                                <input
                                    type="password"
                                    className="w-full h-14 px-5 bg-secondary/30 border border-border rounded-2xl outline-none focus:border-primary font-bold transition-all"
                                    placeholder="••••••••••••••••"
                                    value={clientSecret}
                                    onChange={(e) => setClientSecret(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2">Redirect URI (Optional)</label>
                                <input
                                    type="text"
                                    className="w-full h-14 px-5 bg-secondary/30 border border-border rounded-2xl outline-none focus:border-primary font-bold transition-all"
                                    placeholder="https://your-domain.com/callback"
                                    value={redirectUri}
                                    onChange={(e) => setRedirectUri(e.target.value)}
                                />
                                <p className="text-[10px] text-muted-foreground mt-1 px-2 italic">Leave empty to use Vantage defaults.</p>
                            </div>
                        </div>

                        <button
                            onClick={handleSaveCredentials}
                            disabled={saving}
                            className="w-full h-16 bg-primary text-primary-foreground font-black rounded-3xl shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95 transition-all"
                        >
                            {saving ? 'Saving Credentials...' : 'Save & Provision'}
                        </button>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex gap-4 pt-4 relative z-10">
                <button
                    onClick={onClose}
                    className="flex-1 h-16 bg-secondary text-foreground font-black rounded-3xl hover:bg-secondary/80 transition-all border border-border/50"
                >
                    Cancel
                </button>
                {tab === 'sync' && (
                    <button
                        onClick={handleSaveSyncSettings}
                        disabled={savingSync || selectedObjects.length === 0}
                        className="flex-1 h-16 bg-primary text-primary-foreground font-black rounded-3xl shadow-lg shadow-primary/20 hover:opacity-90 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                        {savingSync ? (
                            <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                <Save className="w-5 h-5" />
                                Save Settings
                            </>
                        )}
                    </button>
                )}
            </div>
        </motion.div>
    );
}
