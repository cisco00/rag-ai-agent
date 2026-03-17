import { useState, useEffect } from 'react';
import {
    Building2, CheckCircle, Copy, AlertCircle, Mail, Lock,
    User, UserPlus, LogIn, ArrowRight, TrendingUp, Sparkles,
    ShieldCheck, Globe, Zap
} from 'lucide-react';
import { api } from '../../lib/api';

// --- Shared Types ---

interface LoginFormProps {
    onLoginSuccess: (apiKey: string, accessToken: string, refreshToken: string, user: any) => void;
    setError: (err: string | null) => void;
    isLoading: boolean;
    setIsLoading: (val: boolean) => void;
}

interface RegisterFormProps {
    setNewApiKey: (val: string) => void;
    setStep: (val: number) => void;
    setError: (err: string | null) => void;
    isLoading: boolean;
    setIsLoading: (val: boolean) => void;
}

interface InviteAcceptFormProps {
    inviteToken: string;
    setInviteToken: (val: string) => void;
    setActiveTab: (val: 'login' | 'register' | 'invite') => void;
    setError: (err: string | null) => void;
    isLoading: boolean;
    setIsLoading: (val: boolean) => void;
}

// --- Sub-components (outside to prevent re-creation on re-render) ---

const InputField = ({ icon: Icon, label, id, ...props }: any) => (
    <div className="space-y-1.5 group">
        <label htmlFor={id} className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1 group-focus-within:text-blue-500 transition-colors">
            {label}
        </label>
        <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                <Icon size={18} />
            </div>
            <input
                {...props}
                id={id}
                className="w-full pl-11 pr-4 py-3 bg-white/50 backdrop-blur-sm border border-slate-200/60 rounded-xl focus:border-blue-500/50 focus:bg-white focus:ring-4 focus:ring-blue-500/5 outline-none text-slate-800 placeholder:text-slate-300 shadow-sm"
            />
        </div>
    </div>
);

function LoginForm({ onLoginSuccess, setError, isLoading, setIsLoading }: LoginFormProps) {
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');

    const handleLogin = async () => {
        if (!loginEmail.trim() || !loginPassword.trim()) {
            setError('Email and Password are required.');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const authRes = await api.post<any>('/auth/login', {
                email: loginEmail,
                password: loginPassword
            });

            onLoginSuccess(
                authRes.api_key,
                authRes.access_token,
                authRes.refresh_token,
                authRes.user
            );
        } catch (err: any) {
            setError(err.message || 'Login failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handleLogin();
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-5">
                <InputField
                    id="login-email"
                    icon={Mail}
                    label="Work Email"
                    type="email"
                    value={loginEmail}
                    onChange={(e: any) => setLoginEmail(e.target.value)}
                    placeholder="name@company.com"
                />

                <InputField
                    id="login-password"
                    icon={Lock}
                    label="Password"
                    type="password"
                    value={loginPassword}
                    onChange={(e: any) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                />
            </div>

            <button
                type="submit"
                disabled={isLoading || !loginEmail.trim() || !loginPassword.trim()}
                className="w-full py-4.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-lg shadow-2xl shadow-blue-500/20 transition-all disabled:opacity-50 active:scale-[0.98] mt-2"
            >
                {isLoading ? 'AUTHENTICATING...' : 'SIGN IN'}
            </button>
        </form>
    );
}

function RegisterForm({ setNewApiKey, setStep, setError, isLoading, setIsLoading }: RegisterFormProps) {
    const [orgName, setOrgName] = useState('');
    const [regEmail, setRegEmail] = useState('');
    const [regPassword, setRegPassword] = useState('');
    const [regDisplayName, setRegDisplayName] = useState('');

    const handleRegister = async () => {
        if (!orgName.trim() || !regEmail.trim() || !regPassword.trim()) {
            setError('All fields are required.');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const orgRes = await api.post<{ api_key: string }>('/auth/register', {
                name: orgName,
                email: regEmail
            });

            const apiKey = orgRes.api_key;
            setNewApiKey(apiKey);
            localStorage.setItem('vantage_api_key', apiKey);

            const authRes = await api.post<any>('/auth/register-first-user', {
                email: regEmail,
                password: regPassword,
                display_name: regDisplayName || regEmail.split('@')[0]
            });

            localStorage.setItem('vantage_access_token', authRes.access_token);
            localStorage.setItem('vantage_refresh_token', authRes.refresh_token);
            localStorage.setItem('vantage_user', JSON.stringify(authRes.user));

            setStep(2); // Success step
        } catch (err: any) {
            setError(err.message || 'Registration failed.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handleRegister();
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
                <InputField
                    id="reg-org"
                    icon={Building2}
                    label="Company Name"
                    value={orgName}
                    onChange={(e: any) => setOrgName(e.target.value)}
                    placeholder="e.g. Nexus Forge"
                />

                <InputField
                    id="reg-email"
                    icon={Mail}
                    label="Work Email"
                    type="email"
                    value={regEmail}
                    onChange={(e: any) => setRegEmail(e.target.value)}
                    placeholder="name@company.com"
                />

                <div className="grid grid-cols-2 gap-4">
                    <InputField
                        id="reg-nickname"
                        icon={User}
                        label="Nick Name"
                        value={regDisplayName}
                        onChange={(e: any) => setRegDisplayName(e.target.value)}
                        placeholder="Alex"
                    />
                    <InputField
                        id="reg-password"
                        icon={Lock}
                        label="Password"
                        type="password"
                        value={regPassword}
                        onChange={(e: any) => setRegPassword(e.target.value)}
                        placeholder="••••••••"
                    />
                </div>
            </div>

            <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100/50 flex gap-3 items-center">
                <div className="p-2 bg-white rounded-lg text-blue-500 shadow-sm"><Globe size={16} /></div>
                <p className="text-[11px] text-blue-600 font-bold leading-tight">
                    A dedicated database and secure workspace will be provisioned on the fly.
                </p>
            </div>

            <button
                type="submit"
                disabled={isLoading || !orgName.trim() || !regEmail.trim() || !regPassword.trim()}
                className="w-full py-4.5 bg-slate-900 hover:bg-black text-white rounded-2xl font-black text-lg shadow-xl shadow-slate-900/10 transition-all disabled:opacity-50 active:scale-[0.98] mt-2 mb-4"
            >
                {isLoading ? 'INITIATING...' : 'CREATE WORKSPACE'}
            </button>
        </form>
    );
}

function InviteAcceptForm({ inviteToken, setInviteToken, setActiveTab, setError, isLoading, setIsLoading }: InviteAcceptFormProps) {
    const [invitePassword, setInvitePassword] = useState('');
    const [inviteDisplayName, setInviteDisplayName] = useState('');

    const handleAcceptInvite = async () => {
        if (!inviteToken.trim() || !invitePassword.trim()) {
            setError('Invite Token and Password are required.');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            await api.post<any>('/auth/accept-invite', {
                token: inviteToken,
                password: invitePassword,
                display_name: inviteDisplayName
            });

            setError("Invitation accepted! Please login.");
            setActiveTab('login');
        } catch (err: any) {
            setError(err.message || 'Failed to accept invitation');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handleAcceptInvite();
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
                <div className="space-y-1.5 group">
                    <label htmlFor="invite-token" className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">Invite Token</label>
                    <input
                        id="invite-token"
                        type="text"
                        value={inviteToken}
                        onChange={(e) => setInviteToken(e.target.value)}
                        placeholder="Token from email"
                        className="w-full px-4 py-3 bg-white/50 border border-slate-200 rounded-xl font-mono text-xs focus:border-blue-500/50 outline-none"
                    />
                </div>

                <InputField
                    id="invite-name"
                    icon={User}
                    label="Display Name"
                    value={inviteDisplayName}
                    onChange={(e: any) => setInviteDisplayName(e.target.value)}
                    placeholder="John Doe"
                />

                <InputField
                    id="invite-password"
                    icon={Lock}
                    label="Set Password"
                    type="password"
                    value={invitePassword}
                    onChange={(e: any) => setInvitePassword(e.target.value)}
                    placeholder="••••••••"
                />
            </div>

            <button
                type="submit"
                disabled={isLoading || !inviteToken.trim() || !invitePassword.trim()}
                className="w-full py-4.5 bg-slate-900 hover:bg-black text-white rounded-2xl font-black text-lg transition-all disabled:opacity-50 active:scale-[0.98]"
            >
                {isLoading ? 'PROCESSING...' : 'ACCEPT INVITATION'}
            </button>
        </form>
    );
}

// --- Main Page Component ---

interface AuthPageProps {
    onLoginSuccess: (apiKey: string, accessToken: string, refreshToken: string, user: any) => void;
    existingKey?: string;
    isSettingsMode?: boolean;
}

export function AuthPage({ onLoginSuccess, existingKey, isSettingsMode }: AuthPageProps) {
    const [activeTab, setActiveTab] = useState<'login' | 'register' | 'invite'>(
        isSettingsMode ? 'invite' : (existingKey ? 'login' : 'register')
    );
    const [step, setStep] = useState(1); // For registration wizard

    const [isLoading, setIsLoading] = useState(false);
    const [newApiKey, setNewApiKey] = useState('');
    const [sendInviteMessage, setSendInviteMessage] = useState<string | null>(null);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('analyst');
    const [generatedInviteLink, setGeneratedInviteLink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [inviteToken, setInviteToken] = useState('');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('invite_token');
        if (token) {
            setInviteToken(token);
            setActiveTab('invite');
        }
    }, []);

    const handleSendInvite = async () => {
        if (!inviteEmail.trim()) {
            setError('Email is required.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setSendInviteMessage(null);
        setGeneratedInviteLink(null);

        try {
            const res = await api.post<any>('/auth/invite', {
                email: inviteEmail,
                role: inviteRole
            });

            const link = `${window.location.origin}?invite_token=${res.token}`;
            setGeneratedInviteLink(link);
            setSendInviteMessage(`Invitation generated for ${inviteEmail}`);
            setInviteEmail('');
        } catch (err: any) {
            setError(err.message || 'Failed to generate invitation');
        } finally {
            setIsLoading(false);
        }
    };

    const handleContinue = () => {
        const accessToken = localStorage.getItem('vantage_access_token');
        const refreshToken = localStorage.getItem('vantage_refresh_token');
        const user = JSON.parse(localStorage.getItem('vantage_user') || '{}');
        if (newApiKey && accessToken && refreshToken) {
            onLoginSuccess(newApiKey, accessToken, refreshToken, user);
        }
    };

    if (isSettingsMode) {
        return (
            <div className="space-y-8 animate-in fade-in duration-700">
                <div className="flex items-center gap-4">
                    <div className="p-4 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl shadow-lg shadow-blue-500/20">
                        <UserPlus size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Invite Team Members</h2>
                        <p className="text-slate-500 text-sm font-medium">Collaborate by inviting your colleagues.</p>
                    </div>
                </div>

                <div className="bg-white/70 backdrop-blur-md rounded-[2rem] p-8 border border-slate-200/50 shadow-xl shadow-slate-200/20 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <InputField
                            icon={Mail}
                            label="Email Address"
                            type="email"
                            value={inviteEmail}
                            onChange={(e: any) => setInviteEmail(e.target.value)}
                            placeholder="name@company.com"
                        />

                        <div className="space-y-1.5 group">
                            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">Assigned Role</label>
                            <select
                                value={inviteRole}
                                onChange={(e) => setInviteRole(e.target.value)}
                                className="w-full px-4 py-3 bg-white/50 backdrop-blur-sm border border-slate-200/60 rounded-xl focus:border-blue-500/50 focus:bg-white focus:ring-4 focus:ring-blue-500/5 transition-all outline-none appearance-none cursor-pointer text-slate-800 shadow-sm"
                            >
                                <option value="analyst">Analyst</option>
                                <option value="admin">Admin</option>
                                <option value="viewer">Viewer</option>
                            </select>
                        </div>
                    </div>

                    <button
                        onClick={handleSendInvite}
                        disabled={isLoading || !inviteEmail.trim()}
                        className="w-full py-4 bg-slate-900 hover:bg-black text-white rounded-2xl font-bold shadow-xl shadow-slate-900/10 transition-all disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98]"
                    >
                        {isLoading ? <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-white" /> : <Zap size={18} />}
                        {isLoading ? 'Generating...' : 'Create Invitation Link'}
                    </button>

                    {(error || sendInviteMessage) && (
                        <div className={`p-4 rounded-2xl text-sm font-medium border animate-in zoom-in-95 ${error ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                            }`}>
                            {error || sendInviteMessage}
                        </div>
                    )}

                    {generatedInviteLink && (
                        <div className="space-y-3 animate-in slide-in-from-bottom-4 duration-500">
                            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">Shareable Link</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={generatedInviteLink}
                                    readOnly
                                    className="flex-1 px-4 py-3 bg-blue-50/50 border border-blue-100 rounded-xl font-mono text-[10px] text-blue-700 outline-none"
                                />
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(generatedInviteLink);
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 2000);
                                    }}
                                    className="px-4 bg-white border border-slate-200 rounded-xl text-slate-600 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm"
                                >
                                    {copied ? <CheckCircle className="size-5 text-emerald-500" /> : <Copy className="size-5" />}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-[#F8FAFC] overflow-hidden relative">
            {/* Animated Background Orbs */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/10 rounded-full blur-[120px] animate-pulse" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-400/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />

            <div className="w-full max-w-[480px] p-6 relative z-10">
                {/* Branding Section */}
                <div className="text-center mb-10 space-y-4">
                    <div className="inline-flex items-center justify-center p-4 bg-white rounded-3xl shadow-2xl shadow-blue-500/10 ring-1 ring-slate-100 mb-2 group transition-all hover:rotate-12">
                        <TrendingUp size={36} className="text-blue-600" />
                    </div>
                    <div className="space-y-1">
                        <h1 className="text-4xl font-black text-slate-900 tracking-tighter">
                            VANTAGE <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">AI</span>
                        </h1>
                        <div className="flex items-center justify-center gap-2 text-slate-400 text-sm font-bold uppercase tracking-[0.2em]">
                            <ShieldCheck size={14} />
                            Enterprise Analytics
                        </div>
                    </div>
                </div>

                <div className="bg-white/80 backdrop-blur-xl rounded-[2.5rem] shadow-2xl shadow-blue-500/5 border border-white p-2">
                    {/* Glass Tabs */}
                    {!newApiKey && (
                        <div className="flex gap-1 p-1.5 bg-slate-100/50 rounded-[2rem] mb-2">
                            {(['register', 'login', 'invite'] as const).map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => { setActiveTab(tab); setError(null); }}
                                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-[1.5rem] text-sm font-bold transition-all duration-300 ${activeTab === tab
                                            ? 'bg-white shadow-xl shadow-slate-200/50 text-blue-600'
                                            : 'text-slate-400 hover:text-slate-600'
                                        }`}
                                >
                                    {tab === 'register' && <UserPlus size={16} />}
                                    {tab === 'login' && <LogIn size={16} />}
                                    {tab === 'invite' && <Mail size={16} />}
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="p-8 pt-6">
                        {error && (
                            <div className="flex items-start gap-3 text-red-600 bg-red-50/80 backdrop-blur-sm p-4 rounded-2xl text-[13px] mb-8 border border-red-100 animate-in fade-in slide-in-from-top-4 duration-500">
                                <AlertCircle className="size-5 shrink-0" />
                                <span className="font-semibold leading-relaxed">{error}</span>
                            </div>
                        )}

                        {newApiKey && step === 2 ? (
                            <div className="space-y-8 animate-in fade-in zoom-in-95 duration-700">
                                <div className="text-center space-y-4">
                                    <div className="inline-flex items-center justify-center w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full shadow-inner mb-2">
                                        <Sparkles size={40} className="animate-bounce" />
                                    </div>
                                    <div>
                                        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Success!</h2>
                                        <p className="text-slate-500 font-medium px-4">Your organization workspace has been provisioned.</p>
                                    </div>
                                </div>

                                <div className="space-y-3 bg-slate-50/50 p-6 rounded-3xl border border-slate-100">
                                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">Secure API Key</label>
                                    <div className="relative group">
                                        <input
                                            type="text"
                                            value={newApiKey}
                                            readOnly
                                            className="w-full pl-4 pr-12 py-4 bg-white border border-slate-200 rounded-2xl font-mono text-xs text-slate-600 shadow-sm"
                                        />
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(newApiKey);
                                                setCopied(true);
                                                setTimeout(() => setCopied(false), 2000);
                                            }}
                                            className="absolute right-2 top-2 p-2 rounded-xl bg-slate-50 text-slate-400 hover:text-blue-600 transition-all"
                                        >
                                            {copied ? <CheckCircle size={20} className="text-emerald-500" /> : <Copy size={20} />}
                                        </button>
                                    </div>
                                    <div className="flex items-start gap-2 text-[10px] text-amber-600 font-bold uppercase tracking-wider bg-amber-50 p-3 rounded-xl border border-amber-100">
                                        <AlertCircle size={14} className="shrink-0" />
                                        Store this safely. It identifies your organization.
                                    </div>
                                </div>

                                <button
                                    onClick={handleContinue}
                                    className="w-full h-16 bg-blue-600 hover:bg-blue-700 text-white rounded-[1.5rem] font-black tracking-wide shadow-2xl shadow-blue-500/20 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                                >
                                    GET STARTED
                                    <ArrowRight size={24} />
                                </button>
                            </div>
                        ) : activeTab === 'register' ? (
                            <div key="reg" className="animate-in fade-in slide-in-from-right-8 duration-500">
                                <RegisterForm
                                    setNewApiKey={setNewApiKey}
                                    setStep={setStep}
                                    setError={setError}
                                    isLoading={isLoading}
                                    setIsLoading={setIsLoading}
                                />
                            </div>
                        ) : activeTab === 'login' ? (
                            <div key="login" className="animate-in fade-in slide-in-from-left-8 duration-500">
                                <LoginForm
                                    onLoginSuccess={onLoginSuccess}
                                    setError={setError}
                                    isLoading={isLoading}
                                    setIsLoading={setIsLoading}
                                />
                            </div>
                        ) : (
                            <div key="invite" className="animate-in fade-in slide-in-from-bottom-8 duration-500">
                                <InviteAcceptForm
                                    inviteToken={inviteToken}
                                    setInviteToken={setInviteToken}
                                    setActiveTab={setActiveTab}
                                    setError={setError}
                                    isLoading={isLoading}
                                    setIsLoading={setIsLoading}
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div className="text-center mt-10">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        Vantage AI Platform v2.0.4 • SOC2 Compliant
                    </p>
                </div>
            </div>
        </div>
    );
}
