import React, { useState, useEffect } from 'react';
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
    ExternalLink,
    Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../lib/api';

interface Integration {
    id: string;
    name: string;
    icon: string;
    description: string;
    status: 'ready' | 'beta' | 'coming_soon';
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
    const [success, setSuccess] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [connecting, setConnecting] = useState<string | null>(null);
    const [configIntegration, setConfigIntegration] = useState<Integration | null>(null);

    useEffect(() => {
        loadData();
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

    const handleConnect = async (provider: string) => {
        try {
            setConnecting(provider);
            
            // 1. One-Click Mock Link
            // We check a local flag or the backend response. For now, we try to call mock-link if connecting fails or as a preference
            try {
                // If we are in mock mode, try to link instantly
                const mockRes = await api.post<any>(`/integrations/${provider}/mock-link`);
                if (mockRes.status === 'success') {
                    setSuccess(true);
                    loadData();
                    setTimeout(() => setSuccess(false), 3000);
                    setConnecting(null);
                    return;
                }
            } catch (e) {
                // Ignore and fallback to OAuth if mock link fails (e.g. not in mock mode)
            }

            // 2. Popup-based OAuth Flow
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

            // Listen for the 'crm_auth_success' message from the popup
            const handleMessage = (event: MessageEvent) => {
                if (event.data === 'crm_auth_success') {
                    setSuccess(true);
                    loadData();
                    setTimeout(() => setSuccess(false), 3000);
                    window.removeEventListener('message', handleMessage);
                }
            };
            window.addEventListener('message', handleMessage);

            // Check if popup closed manually
            const timer = setInterval(() => {
                if (popup?.closed) {
                    clearInterval(timer);
                    setConnecting(null);
                }
            }, 1000);

        } catch (err) {
            console.error(err);
            setError(`Could not initiate ${provider} connection.`);
            setConnecting(null);
        }
    };

    const handleSync = async (sourceId: string) => {
        try {
            setSyncing(sourceId);
            await api.post('/integrations/sync', { source_id: parseInt(sourceId) });
            setSuccess(true);
            setTimeout(() => {
                setSyncing(null);
                loadData();
                setTimeout(() => setSuccess(false), 3000);
            }, 1000);
        } catch (err) {
            setSyncing(null);
            setError('Sync failed. Please try again.');
        }
    };

    const handleManualImport = async (provider: string) => {
        try {
            setSyncing(provider);
            await api.post(`/integrations/import/${provider}`);
            setSuccess(true);
            setTimeout(() => {
                setSyncing(null);
                loadData();
                setTimeout(() => setSuccess(false), 3000);
            }, 1000);
        } catch (err) {
            setSyncing(null);
            setError(`Manual import for ${provider} failed.`);
        }
    };

    const isConnected = (id: string) => {
        return connected.some(c => c.source_type === `crm_${id}`);
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
            {/* Header Section */}
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
                            <p className="font-bold">Connection Error</p>
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
                            <p className="font-bold">Operation Successful</p>
                            <p className="text-sm opacity-90">Your integration task has been queued and is executing in the background.</p>
                        </div>
                        <button onClick={() => setSuccess(false)} className="text-sm font-bold hover:underline">Dismiss</button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
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
                            }`}
                        >
                            {/* Animated Background Gradient */}
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
                                        <button className="p-2 hover:bg-secondary rounded-xl transition-colors">
                                            <MoreVertical className="w-4 h-4 text-muted-foreground" />
                                        </button>
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
                                                Sync Status
                                            </span>
                                            <span className="text-xs font-bold text-foreground/80">
                                                {connectedSource?.last_sync ? new Date(connectedSource.last_sync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending...'}
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
                                    <motion.button 
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => handleConnect(integration.id)}
                                        disabled={connecting === integration.id}
                                        className={`w-full flex h-16 items-center justify-center gap-3 ${brandColor} ${brandHover} text-white font-black rounded-[1.5rem] transition-all group/btn relative overflow-hidden shadow-xl disabled:opacity-75`}
                                    >
                                        <div className="absolute inset-0 bg-white/10 translate-x-[-100%] group-hover/btn:translate-x-0 transition-transform duration-500" />
                                        <div className="relative flex items-center gap-3">
                                            {connecting === integration.id ? (
                                                <RefreshCw className="w-5 h-5 animate-spin" />
                                            ) : (
                                                <LinkIcon className="w-5 h-5 group-hover/btn:rotate-12 transition-transform duration-300" />
                                            )}
                                            <span>
                                                {connecting === integration.id ? 'Starting Login...' : `Login with ${integration.name}`}
                                            </span>
                                            {!connecting && <ArrowRight className="w-5 h-5 ml-1 group-hover/btn:translate-x-2 transition-transform duration-300" />}
                                        </div>
                                    </motion.button>
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
                    <button className="px-6 py-2 bg-primary/10 text-primary font-black text-xs uppercase tracking-widest rounded-full hover:bg-primary/20 transition-all">
                        Suggest Sync
                    </button>
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
                            onClose={() => setConfigIntegration(null)}
                            onSuccess={() => {
                                setSuccess(true);
                                setTimeout(() => setSuccess(false), 3000);
                            }}
                            handleManualImport={handleManualImport}
                            syncing={syncing}
                        />
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}

function ConfigModal({ integration, onClose, onSuccess, handleManualImport, syncing }: any) {
    const [tab, setTab] = useState<'sync' | 'provision'>('sync');
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [redirectUri, setRedirectUri] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadCredentials();
    }, []);

    const loadCredentials = async () => {
        try {
            const res = await api.get<any>(`/integrations/${integration.id}/credentials`);
            setClientId(res.client_id || '');
            setRedirectUri(res.redirect_uri || '');
        } catch (e) {
            console.error("Failed to load credentials", e);
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
            onSuccess();
            setTab('sync');
        } catch (e: any) {
            const msg = e.response?.data?.detail || "Failed to save credentials. Please check inputs.";
            alert(msg);
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
            </div>

            <div className="relative z-10">
                {tab === 'sync' ? (
                    <div className="space-y-6">
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

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2">Sync Frequency</label>
                            <select className="w-full h-14 px-5 bg-secondary/50 border border-border rounded-2xl outline-none focus:ring-2 focus:ring-primary/20 appearance-none font-bold">
                                <option>Every 60 minutes (Default)</option>
                                <option>Every 4 hours</option>
                                <option>Daily at Midnight</option>
                                <option>Manual Only</option>
                            </select>
                        </div>

                        <div className="space-y-4">
                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2">Sync Objects</label>
                            <div className="grid grid-cols-2 gap-3">
                                {(integration.id === 'hubspot' ? ['Contacts', 'Companies', 'Deals', 'Tasks'] : ['Leads', 'Contacts', 'Opportunities', 'Accounts']).map(obj => (
                                    <div key={obj} className="flex items-center gap-3 p-4 bg-secondary/30 rounded-2xl border border-border/50 hover:border-primary/20 transition-colors cursor-pointer group">
                                        <div className="w-5 h-5 rounded border-2 border-primary/50 bg-transparent flex items-center justify-center group-hover:bg-primary/10">
                                            <CheckCircle2 className="w-3 h-3 text-primary opacity-100" />
                                        </div>
                                        <span className="text-sm font-bold">{obj}</span>
                                    </div>
                                ))}
                            </div>
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

            <div className="flex gap-4 pt-4 relative z-10">
                <button 
                    onClick={onClose}
                    className="flex-1 h-16 bg-secondary text-foreground font-black rounded-3xl hover:bg-secondary/80 transition-all border border-border/50"
                >
                    Close
                </button>
                {tab === 'sync' && (
                    <button 
                        onClick={() => {
                            onSuccess();
                            onClose();
                        }}
                        className="flex-1 h-16 bg-primary text-primary-foreground font-black rounded-3xl shadow-lg shadow-primary/20 hover:opacity-90 transition-all"
                    >
                        Save Settings
                    </button>
                )}
            </div>
        </motion.div>
    );
}
