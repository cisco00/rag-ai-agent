import React, { useState } from 'react';
import { Key, Sparkles, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

export const Login: React.FC = () => {
    const [apiKey, setApiKey] = useState('');
    const [orgName, setOrgName] = useState('');
    const navigate = useNavigate();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (apiKey) {
            setLoading(true);
            try {
                // Determine destination by checking if DB is configured
                // We try to fetch tables. If it succeeds, DB is configured.
                // If it fails with specific error, we need config.

                // Store key first so api calls can use it if they read from localStorage (though api.ts methods usually take key as arg)
                localStorage.setItem('vantage_api_key', apiKey);
                if (orgName) {
                    localStorage.setItem('vantage_org_name', orgName);
                }

                await api.getTables(apiKey);
                // If successful, go straight to dashboard
                navigate('/dashboard');
            } catch (err: any) {
                // Check if error is due to missing configuration
                // The backend returns 400 with "No database..." if valid key but no DB
                if (err.message && (err.message.includes('No database') || err.message.includes('not configured'))) {
                    navigate('/database-config');
                } else {
                    // Start fresh if invalid
                    localStorage.removeItem('vantage_api_key');
                    setError(err.message || 'Login failed. Please check your API key.');
                }
            } finally {
                setLoading(false);
            }
        }
    };

    return (
        <div className="login-page">
            <div className="container">
                {/* Header Section */}
                <div className="header">
                    <div className="logo-container">
                        <div className="logo-icon">
                            <Sparkles size={24} color="white" />
                        </div>
                    </div>
                    <h1 className="brand-name">Vantage AI</h1>
                    <p className="brand-subtitle">Commercial Analytics Portal</p>
                </div>

                {/* Card Section */}
                <div className="card">
                    <h2>Welcome Back</h2>
                    <p className="card-subtitle">
                        Enter your API key to access your analytics dashboard.
                    </p>

                    {error && (
                        <div className="error-message">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleLogin}>
                        <div className="input-group">
                            <label htmlFor="apiKey" className="label">API Key</label>
                            <div className="input-wrapper">
                                <Key className="input-icon" size={18} />
                                <input
                                    type="password"
                                    id="apiKey"
                                    className="input with-icon"
                                    placeholder="your-api-key-here"
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className="input-group">
                            <label htmlFor="orgName" className="label">Organization Name (optional)</label>
                            <div className="input-wrapper">
                                <Building2 className="input-icon" size={18} />
                                <input
                                    type="text"
                                    id="orgName"
                                    className="input with-icon"
                                    placeholder="My Organization"
                                    value={orgName}
                                    onChange={(e) => setOrgName(e.target.value)}
                                />
                            </div>
                            <span className="helper-text-small">Optional: For display purposes only</span>
                        </div>

                        <button type="submit" className="btn btn-secondary full-width" disabled={loading}>
                            <Key size={18} />
                            <span>{loading ? 'Checking...' : 'Login'}</span>
                        </button>
                    </form>

                    <div className="footer-links">
                        <p>Don't have an account yet?</p>
                        <a href="/create-org" className="link-primary" onClick={(e) => {
                            e.preventDefault();
                            navigate('/create-org');
                        }}>
                            Create New Organization →
                        </a>
                    </div>

                    <div className="help-box">
                        <strong>Need help?</strong> Your API key was provided when you registered your organization. Check your email or contact support if you've lost it.
                    </div>
                </div>

                <p className="security-notice">
                    Secure login • Your API key is never stored on our servers
                </p>
            </div>

            <style>{`
                .login-page {
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding-top: 60px;
                    background-color: var(--color-bg-primary);
                }

                .container {
                    width: 100%;
                    max-width: 420px;
                    padding: 0 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }

                /* Header matches CreateOrg */
                .header {
                    text-align: center;
                    margin-bottom: 2.5rem;
                }

                .logo-container {
                    display: flex;
                    justify-content: center;
                    margin-bottom: 1rem;
                }

                .logo-icon {
                    background-color: var(--color-primary);
                    width: 48px;
                    height: 48px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
                }

                .brand-name {
                    font-size: 1.5rem;
                    margin-bottom: 0.25rem;
                }

                .brand-subtitle {
                    color: var(--color-text-muted);
                    font-size: 0.9rem;
                }

                /* Card adjustments */
                .card {
                    width: 100%;
                    background: white;
                    padding: 2.5rem;
                    border-radius: 16px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                    margin-bottom: 2rem;
                }

                h2 {
                    font-size: 1.25rem;
                    margin-bottom: 0.5rem;
                }

                .card-subtitle {
                    color: var(--color-text-secondary);
                    font-size: 0.95rem;
                    margin-bottom: 2rem;
                    line-height: 1.5;
                }

                /* Inputs */
                .input-wrapper {
                    position: relative;
                }

                .input-icon {
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--color-text-muted);
                }

                .input.with-icon {
                    padding-left: 40px;
                }

                .helper-text-small {
                    font-size: 0.75rem;
                    color: var(--color-text-muted);
                    margin-top: 0.25rem;
                    display: block;
                }

                .btn.full-width {
                    width: 100%;
                    margin-top: 1rem;
                    gap: 0.5rem;
                    padding: 0.875rem;
                    background-color: #cbd5e1; /* Light grey/silver to match image button */
                    color: #475569;
                    font-weight: 600;
                }
                
                .btn.full-width:hover {
                    background-color: #94a3b8;
                    color: white;
                }

                /* Footer Links */
                .footer-links {
                    margin-top: 2rem;
                    text-align: center;
                    font-size: 0.9rem;
                    color: var(--color-text-secondary);
                    padding-top: 1.5rem;
                    border-top: 1px solid var(--color-border);
                }

                .link-primary {
                    color: var(--color-primary);
                    text-decoration: none;
                    font-weight: 500;
                    margin-top: 0.25rem;
                    display: inline-block;
                }

                .link-primary:hover {
                    text-decoration: underline;
                }

                /* Help Box */
                .help-box {
                    background-color: #f8fafc;
                    border-radius: 8px;
                    padding: 1rem;
                    margin-top: 1.5rem;
                    font-size: 0.8rem;
                    color: var(--color-text-secondary);
                    line-height: 1.5;
                }

                .security-notice {
                    font-size: 0.8rem;
                    color: var(--color-text-muted);
                    text-align: center;
                }
                
                .error-message {
                    background-color: #fee2e2;
                    color: #b91c1c;
                    padding: 0.75rem;
                    border-radius: 8px;
                    margin-bottom: 1.5rem;
                    font-size: 0.9rem;
                    text-align: center;
                }
            `}</style>
        </div>
    );
};
