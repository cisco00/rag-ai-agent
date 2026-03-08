import { useState, useEffect } from 'react';
import { Building2, CheckCircle, Copy, AlertCircle, Mail, Lock, User, UserPlus, LogIn, ArrowRight, TrendingUp } from 'lucide-react';
import { api } from '../../lib/api';

interface AuthPageProps {
    onLoginSuccess: (apiKey: string, accessToken: string, refreshToken: string, user: any) => void;
    existingKey?: string;
    isSettingsMode?: boolean;
}

export function AuthPage({ onLoginSuccess, existingKey, isSettingsMode }: AuthPageProps) {
    const [activeTab, setActiveTab] = useState<'login' | 'register' | 'invite'>(isSettingsMode ? 'invite' : (existingKey ? 'login' : 'register'));

    // Registration State
    const [orgName, setOrgName] = useState('');
    const [regEmail, setRegEmail] = useState('');
    const [regPassword, setRegPassword] = useState('');
    const [regDisplayName, setRegDisplayName] = useState('');

    // Login State
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');

    // Invite State
    const [inviteToken, setInviteToken] = useState('');
    const [invitePassword, setInvitePassword] = useState('');
    const [inviteDisplayName, setInviteDisplayName] = useState('');

    const [isLoading, setIsLoading] = useState(false);
    const [newApiKey, setNewApiKey] = useState('');
    const [sendInviteMessage, setSendInviteMessage] = useState<string | null>(null);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('analyst');
    const [generatedInviteLink, setGeneratedInviteLink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Check for invite token in URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('invite_token');
        if (token) {
            setInviteToken(token);
            setActiveTab('invite');
        }
    }, []);

    const handleRegister = async () => {
        if (!orgName.trim() || !regEmail.trim() || !regPassword.trim()) {
            setError('Org Name, Email, and Password are required.');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // 1. Register Organization
            const orgRes = await api.post<{ api_key: string }>('/register', {
                name: orgName,
                email: regEmail
            });

            const apiKey = orgRes.api_key;
            setNewApiKey(apiKey);
            localStorage.setItem('vantage_api_key', apiKey); // Temporary store for the next step

            // 2. Register Owner User
            const authRes = await api.post<any>('/auth/register', {
                email: regEmail,
                password: regPassword,
                display_name: regDisplayName || regEmail.split('@')[0]
            }, {
                headers: { 'X-API-KEY': apiKey }
            });

            // We stay on this screen to show the API Key
            // But we have the session ready
            localStorage.setItem('vantage_access_token', authRes.access_token);
            localStorage.setItem('vantage_refresh_token', authRes.refresh_token);
            localStorage.setItem('vantage_user', JSON.stringify(authRes.user));

        } catch (err: any) {
            setError(err.message || 'Registration failed');
        } finally {
            setIsLoading(false);
        }
    };

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
                authRes.api_key, // Now returned from login response
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

    const handleAcceptInvite = async () => {
        if (!inviteToken.trim() || !invitePassword.trim()) {
            setError('Invite Token and Password are required.');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            await api.post<any>('/auth/accept', {
                token: inviteToken,
                password: invitePassword,
                display_name: inviteDisplayName
            });

            setError("Invitation accepted! Please login with your new credentials.");
            setActiveTab('login');
        } catch (err: any) {
            setError(err.message || 'Failed to accept invitation');
        } finally {
            setIsLoading(false);
        }
    };

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
            setSendInviteMessage(`Invitation link generated for ${inviteEmail}`);
            setInviteEmail('');
        } catch (err: any) {
            setError(err.message || 'Failed to send invitation');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopyKey = () => {
        navigator.clipboard.writeText(newApiKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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
            <div className="space-y-6 max-w-2xl mx-auto py-4">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-blue-100 text-blue-600 rounded-2xl">
                        <UserPlus size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900">Invite Members</h2>
                        <p className="text-slate-500 text-sm">Grow your team by inviting new members to this organization.</p>
                    </div>
                </div>

                {error && (
                    <div className="flex items-start gap-3 text-red-600 bg-red-50 p-4 rounded-2xl text-sm border border-red-100">
                        <AlertCircle className="size-5 shrink-0 mt-0.5" />
                        <span className="font-medium leading-relaxed">{error}</span>
                    </div>
                )}

                {sendInviteMessage && (
                    <div className="flex items-start gap-3 text-green-600 bg-green-50 p-4 rounded-2xl text-sm border border-green-100">
                        <CheckCircle className="size-5 shrink-0 mt-0.5" />
                        <span className="font-medium leading-relaxed">{sendInviteMessage}</span>
                    </div>
                )}

                <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-sm font-bold text-slate-700 ml-1">Email Address</label>
                            <div className="relative">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                <input
                                    type="email"
                                    value={inviteEmail}
                                    onChange={(e) => setInviteEmail(e.target.value)}
                                    placeholder="colleague@company.com"
                                    className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm font-bold text-slate-700 ml-1">Assigned Role</label>
                            <select
                                value={inviteRole}
                                onChange={(e) => setInviteRole(e.target.value)}
                                className="w-full px-4 py-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none appearance-none cursor-pointer"
                            >
                                <option value="analyst">Analyst (Default)</option>
                                <option value="admin">Admin</option>
                                <option value="viewer">Viewer</option>
                            </select>
                        </div>
                    </div>

                    <button
                        onClick={handleSendInvite}
                        disabled={isLoading || !inviteEmail.trim()}
                        className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-100 transition-all disabled:opacity-50"
                    >
                        {isLoading ? 'Generating Invite...' : 'Generate Invitation'}
                    </button>

                    {generatedInviteLink && (
                        <div className="space-y-2 mt-6 animate-in fade-in slide-in-from-bottom-2">
                            <label className="text-sm font-bold text-slate-700 ml-1">Invitation Link (Copy and send via email/Teams)</label>
                            <div className="relative group">
                                <input
                                    type="text"
                                    value={generatedInviteLink}
                                    readOnly
                                    className="w-full pl-4 pr-12 py-4 bg-blue-50 border-2 border-blue-100 rounded-2xl font-mono text-xs text-blue-800 outline-none"
                                />
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(generatedInviteLink);
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 2000);
                                    }}
                                    className="absolute right-2 top-2 p-2 rounded-xl bg-white border border-blue-200 text-blue-500 hover:text-blue-600 transition-all"
                                >
                                    {copied ? <CheckCircle className="size-5" /> : <Copy className="size-5" />}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-blue-100 p-4">
            <div className="w-full max-w-xl">
                {/* Branding */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg mb-4 text-white">
                        <TrendingUp size={32} />
                    </div>
                    <h1 className="text-4xl font-black text-slate-900 tracking-tight">Vantage <span className="text-blue-600">AI</span></h1>
                    <p className="text-slate-500 font-medium mt-1">Intelligence for Commercial Teams</p>
                </div>

                <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
                    {/* Enhanced Tabs */}
                    {!newApiKey && (
                        <div className="flex p-2 bg-slate-50 border-b border-slate-200">
                            <button
                                onClick={() => { setActiveTab('register'); setError(null); }}
                                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${activeTab === 'register' ? 'bg-white shadow-md text-blue-600' : 'text-slate-500 hover:text-slate-700'
                                    }`}
                            >
                                <UserPlus size={18} />
                                Register
                            </button>
                            <button
                                onClick={() => { setActiveTab('login'); setError(null); }}
                                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${activeTab === 'login' ? 'bg-white shadow-md text-blue-600' : 'text-slate-500 hover:text-slate-700'
                                    }`}
                            >
                                <LogIn size={18} />
                                Sign In
                            </button>
                            <button
                                onClick={() => { setActiveTab('invite'); setError(null); }}
                                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${activeTab === 'invite' ? 'bg-white shadow-md text-blue-600' : 'text-slate-500 hover:text-slate-700'
                                    }`}
                            >
                                <Mail size={18} />
                                Invite
                            </button>
                        </div>
                    )}

                    <div className="p-8">
                        {error && (
                            <div className="flex items-start gap-3 text-red-600 bg-red-50 p-4 rounded-2xl text-sm mb-6 border border-red-100 animate-in fade-in slide-in-from-top-2">
                                <AlertCircle className="size-5 shrink-0 mt-0.5" />
                                <span className="font-medium leading-relaxed">{error}</span>
                            </div>
                        )}

                        {newApiKey ? (
                            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                                <div className="text-center p-6 bg-green-50 rounded-3xl border border-green-100">
                                    <div className="inline-flex items-center justify-center w-12 h-12 bg-green-100 text-green-600 rounded-full mb-3">
                                        <CheckCircle size={24} />
                                    </div>
                                    <h2 className="text-xl font-bold text-slate-900">Registration Complete!</h2>
                                    <p className="text-slate-600 text-sm mt-1">Your organization and owner account are ready.</p>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-700 ml-1">Your Organization API Key</label>
                                    <div className="relative group">
                                        <input
                                            type="text"
                                            value={newApiKey}
                                            readOnly
                                            className="w-full pl-4 pr-12 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-mono text-sm text-slate-800 focus:border-blue-500 transition-all outline-none"
                                        />
                                        <button
                                            onClick={handleCopyKey}
                                            className="absolute right-2 top-2 p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-blue-600 hover:shadow-sm transition-all"
                                        >
                                            {copied ? <CheckCircle className="size-5 text-green-600" /> : <Copy className="size-5" />}
                                        </button>
                                    </div>
                                    <p className="text-xs text-amber-600 font-bold flex items-center gap-1.5 ml-1">
                                        <AlertCircle size={14} />
                                        CRITICAL: Save this key securely. It cannot be recovered.
                                    </p>
                                </div>

                                <button
                                    onClick={handleContinue}
                                    className="w-full group py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                                >
                                    Enter Dashboard
                                    <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                                </button>
                            </div>
                        ) : activeTab === 'register' ? (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-700 ml-1">Organization Name</label>
                                        <div className="relative">
                                            <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                            <input
                                                type="text"
                                                value={orgName}
                                                onChange={(e) => setOrgName(e.target.value)}
                                                placeholder="e.g. Acme Corp"
                                                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-700 ml-1">Work Email</label>
                                        <div className="relative">
                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                            <input
                                                type="email"
                                                value={regEmail}
                                                onChange={(e) => setRegEmail(e.target.value)}
                                                placeholder="name@company.com"
                                                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-bold text-slate-700 ml-1">Display Name</label>
                                            <div className="relative">
                                                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                                <input
                                                    type="text"
                                                    value={regDisplayName}
                                                    onChange={(e) => setRegDisplayName(e.target.value)}
                                                    placeholder="John D."
                                                    className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-bold text-slate-700 ml-1">Password</label>
                                            <div className="relative">
                                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                                <input
                                                    type="password"
                                                    value={regPassword}
                                                    onChange={(e) => setRegPassword(e.target.value)}
                                                    placeholder="••••••••"
                                                    className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-slate-500 font-medium px-1 leading-relaxed">
                                        Min. 8 characters with at least one number or special character.
                                    </p>
                                </div>

                                <button
                                    onClick={handleRegister}
                                    disabled={isLoading || !orgName.trim() || !regEmail.trim() || !regPassword.trim()}
                                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                                >
                                    {isLoading ? 'Creating Workspace...' : 'Create Organization Workspace'}
                                </button>
                            </div>
                        ) : activeTab === 'login' ? (
                            <div className="space-y-5 animate-in fade-in slide-in-from-left-4">
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-700 ml-1">Email Address</label>
                                        <div className="relative">
                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                            <input
                                                type="email"
                                                value={loginEmail}
                                                onChange={(e) => setLoginEmail(e.target.value)}
                                                placeholder="name@company.com"
                                                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-700 ml-1">Password</label>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                            <input
                                                type="password"
                                                value={loginPassword}
                                                onChange={(e) => setLoginPassword(e.target.value)}
                                                placeholder="••••••••"
                                                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={handleLogin}
                                    disabled={isLoading || !loginEmail.trim() || !loginPassword.trim()}
                                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold font-bold shadow-lg shadow-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                                >
                                    {isLoading ? 'Signing In...' : 'Sign In to Workspace'}
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4">
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-700 ml-1">Invite Token</label>
                                        <input
                                            type="text"
                                            value={inviteToken}
                                            onChange={(e) => setInviteToken(e.target.value)}
                                            placeholder="Paste token from email"
                                            className="w-full px-4 py-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl font-mono text-sm focus:border-blue-500 focus:bg-white transition-all outline-none"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-700 ml-1">Display Name</label>
                                        <div className="relative">
                                            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                            <input
                                                type="text"
                                                value={inviteDisplayName}
                                                onChange={(e) => setInviteDisplayName(e.target.value)}
                                                placeholder="John Doe"
                                                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-700 ml-1">Set Password</label>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                            <input
                                                type="password"
                                                value={invitePassword}
                                                onChange={(e) => setInvitePassword(e.target.value)}
                                                placeholder="••••••••"
                                                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={handleAcceptInvite}
                                    disabled={isLoading || !inviteToken.trim() || !invitePassword.trim()}
                                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                                >
                                    {isLoading ? 'Accepting...' : 'Accept Invitation'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <p className="text-center text-xs text-slate-500 mt-8 font-medium">
                    By signing in, you agree to the <span className="hover:text-blue-600 cursor-pointer underline">Terms of Service</span> and <span className="hover:text-blue-600 cursor-pointer underline">Privacy Policy</span>.
                </p>
            </div>
        </div>
    );
}
