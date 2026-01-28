
import React, { useState } from 'react';
import { Building2, Check, Sparkles, HelpCircle, Copy, AlertTriangle, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

export const CreateOrganization: React.FC = () => {
  const [orgName, setOrgName] = useState('');
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await api.register(orgName);
      localStorage.setItem('vantage_api_key', response.api_key);
      localStorage.setItem('vantage_org_name', response.name);
      setCreatedApiKey(response.api_key);
    } catch (error) {
      console.error('Registration failed:', error);
      alert('Failed to register organization. Please try again.');
    }
  };

  const handleCopy = () => {
    if (createdApiKey) {
      navigator.clipboard.writeText(createdApiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleProceed = () => {
    navigate('/database-config');
  };

  return (
    <div className="create-org-page">
      <div className="help-button">
        <HelpCircle size={24} color="var(--color-text-muted)" />
      </div>

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
          {!createdApiKey ? (
            <>
              <h2>Create Your Organization</h2>
              <p className="card-subtitle">
                Get started with AI-powered analytics. Register your organization to receive an API key.
              </p>

              <form onSubmit={handleSubmit}>
                <div className="input-group">
                  <label htmlFor="orgName" className="label">Organization Name</label>
                  <div className="input-wrapper">
                    <Building2 className="input-icon" size={20} />
                    <input
                      type="text"
                      id="orgName"
                      className="input with-icon"
                      placeholder="Acme Corporation"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <button type="submit" className="btn btn-primary full-width">
                  Get Started
                </button>
              </form>

              <div className="features-section">
                <p className="features-title">What you get:</p>
                <ul className="features-list">
                  <li>
                    <Check size={16} className="feature-icon" />
                    <span>Connect multiple databases (PostgreSQL, MySQL, SQLite)</span>
                  </li>
                  <li>
                    <Check size={16} className="feature-icon" />
                    <span>Natural language queries with AI insights</span>
                  </li>
                  <li>
                    <Check size={16} className="feature-icon" />
                    <span>Automatic visualizations and shareable reports</span>
                  </li>
                </ul>
              </div>
            </>
          ) : (
            <div className="success-view">
              <div className="success-icon">
                <Check size={32} color="white" />
              </div>
              <h2>Registration Successful!</h2>
              <p className="card-subtitle">
                Here is your unique API Key. Please save it in a secure location, as you will need it to log in again.
              </p>

              <div className="api-key-box">
                <code className="api-key-text">{createdApiKey}</code>
                <button className="copy-btn" onClick={handleCopy} title="Copy to clipboard">
                  {copied ? <Check size={18} color="#10b981" /> : <Copy size={18} />}
                </button>
              </div>

              <div className="warning-box">
                <AlertTriangle size={20} className="warning-icon" />
                <p>We do not store your API key in plain text. If you lose it, you will need to create a new organization.</p>
              </div>

              <button className="btn btn-primary full-width" onClick={handleProceed}>
                <span>I have saved my key</span>
                <ArrowRight size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .create-org-page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 60px;
          background-color: var(--color-bg-primary); /* Ensure background is set */
          position: relative;
        }

        .help-button {
          position: absolute;
          bottom: 20px;
          right: 20px;
          cursor: pointer;
        }

        /* Header */
        .header {
          text-align: center;
          margin-bottom: 2rem;
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

        /* Card */
        .card {
          background-color: var(--color-bg-secondary); /* or card color specifically */
          border: 1px solid var(--color-border);
          border-radius: 16px;
          padding: 2.5rem;
          width: 100%;
          max-width: 480px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }

        h2 {
          font-size: 1.25rem;
          margin-bottom: 0.5rem;
        }

        .card-subtitle {
          color: var(--color-text-secondary);
          font-size: 0.95rem;
          margin-bottom: 2rem;
        }

        /* Form */
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

        .full-width {
          width: 100%;
          margin-top: 0.5rem;
          padding-top: 0.8rem;
          padding-bottom: 0.8rem;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 0.5rem;
        }

        /* Features */
        .features-section {
          margin-top: 2rem;
          padding-top: 1.5rem;
          border-top: 1px solid var(--color-border);
        }

        .features-title {
          font-size: 0.9rem;
          color: var(--color-text-secondary);
          margin-bottom: 1rem;
        }

        .features-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .features-list li {
          display: flex;
          align-items: flex-start;
          margin-bottom: 0.75rem;
          font-size: 0.9rem;
          color: var(--color-text-secondary);
        }

        .feature-icon {
          color: #10b981; /* Green color for validation check */
          margin-right: 0.75rem;
          margin-top: 0.15rem;
          flex-shrink: 0;
        }

        /* Success View */
        .success-view {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }

        .success-icon {
            background-color: #10b981;
            width: 64px;
            height: 64px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 1.5rem;
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        }

        .api-key-box {
            background: #f8fafc;
            border: 1px solid var(--color-border);
            border-radius: 8px;
            padding: 1rem;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1.5rem;
            gap: 1rem;
        }
        
        .api-key-text {
            font-family: monospace;
            font-size: 1.1rem;
            color: var(--color-text-primary);
            word-break: break-all;
            text-align: left;
        }

        .copy-btn {
            background: none;
            border: none;
            cursor: pointer;
            color: var(--color-text-muted);
            padding: 0.5rem;
            border-radius: 4px;
            transition: all 0.2s;
        }
        .copy-btn:hover {
            background: #e2e8f0;
            color: var(--color-text-primary);
        }

        .warning-box {
            background: #fffbeb;
            border: 1px solid #fcd34d;
            border-radius: 8px;
            padding: 1rem;
            display: flex;
            gap: 1rem;
            text-align: left;
            margin-bottom: 2rem;
            font-size: 0.9rem;
            color: #92400e;
        }
        .warning-icon {
            flex-shrink: 0;
            margin-top: 0.1rem;
        }
      `}</style>
    </div>
  );
};
