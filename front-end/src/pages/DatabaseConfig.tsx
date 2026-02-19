
import React, { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { Database, AlertCircle, PlusCircle, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

export const DatabaseConfig: React.FC = () => {
  const navigate = useNavigate();
  const [connectionString, setConnectionString] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string, code?: string } | null>(null);

  // Creation Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    host: 'localhost',
    port: '5435',
    admin_user: 'postgres',
    admin_password: 'postgres',
    new_db_name: 'vantage_db',
    new_user: 'vantage_user',
    new_password: '',
    email: ''
  });
  const [isCreating, setIsCreating] = useState(false);

  const handleConnect = async () => {
    setIsLoading(true);
    setStatus(null);

    const apiKey = localStorage.getItem('vantage_api_key');
    if (!apiKey) {
      setStatus({ type: 'error', message: 'No API key found. Please login again.' });
      setIsLoading(false);
      return;
    }

    try {
      await api.configureDatabase(connectionString, apiKey);
      setStatus({ type: 'success', message: 'Database connected successfully!' });
      setTimeout(() => {
        navigate('/dashboard', { state: { activeTab: 'tables' } });
      }, 1000);
    } catch (err: any) {
      // Check for structured error
      const code = err.code || 'UNKNOWN';
      const msg = err.message || 'Failed to connect';
      setStatus({ type: 'error', message: typeof err === 'string' ? err : msg, code });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateDatabase = async () => {
    setIsCreating(true);
    try {
      const apiKey = localStorage.getItem('vantage_api_key');
      if (!apiKey) throw new Error("No API key");

      await api.createDatabase(createForm, apiKey);
      setShowCreateModal(false);
      setStatus({ type: 'success', message: `Database '${createForm.new_db_name}' created! An email has been sent to ${createForm.email}.` });
      // Auto-fill connection string just for visual confirmation, though backend is already updated
      setConnectionString(`postgresql://${createForm.new_user}:${createForm.new_password}@${createForm.host}:${createForm.port}/${createForm.new_db_name}`);

      setTimeout(() => {
        navigate('/dashboard', { state: { activeTab: 'tables' } });
      }, 2000);
    } catch (err: any) {
      alert(`Failed to create database: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="db-config-container">
      <div className="content-container">
        <h1 className="page-title">Database Configuration</h1>
        <p className="page-subtitle">Connect your database to start querying with natural language.</p>

        <div className="config-section">
          <div className="card">
            <label htmlFor="connString" className="label">Connection String</label>
            <div className="input-with-icon">
              <Database size={18} className="db-icon" />
              <input
                id="connString"
                type="text"
                className="input padded"
                placeholder="postgresql://user:password@localhost:5432/dbname"
                value={connectionString}
                onChange={(e) => setConnectionString(e.target.value)}
              />
            </div>
            <p className="helper-text">Enter your database connection string. It will be stored securely.</p>

            <button className="btn btn-secondary full-width-btn" onClick={handleConnect} disabled={isLoading}>
              <Database size={18} className="btn-icon" />
              {isLoading ? 'Connecting...' : 'Connect Database'}
            </button>

            {status && (
              <div style={{ marginTop: '1rem' }} className={`alert-box ${status.type}`}>
                {status.type === 'error' && <AlertCircle size={16} />}
                <div>
                  <p>{status.message}</p>
                  {/* Show suggestion if DB not found OR Auth Failed */}
                  {(status.code === 'DB_NOT_FOUND' || status.code === 'AUTH_FAILED') && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                        {status.code === 'AUTH_FAILED'
                          ? "Don't have correct credentials? Create a new user & database:"
                          : "Does this database exist?"}
                      </p>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setShowCreateModal(true)}
                      >
                        <PlusCircle size={14} style={{ marginRight: '4px' }} />
                        Create New Database & User
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Create Database Modal */}
        {showCreateModal && (
          <div className="modal-overlay">
            <div className="modal-card">
              <div className="modal-header">
                <h3>Create New Database & User</h3>
                <button onClick={() => setShowCreateModal(false)} className="btn-icon"><X size={20} /></button>
              </div>
              <div className="modal-body">
                <p className="modal-desc">
                  Provide <strong>Admin</strong> credentials (e.g. postgres) to create a brand new database and a <strong>new user</strong> account for you.
                </p>

                <div className="form-grid">
                  <div className="form-group">
                    <label>Host</label>
                    <input
                      className="input"
                      value={createForm.host}
                      onChange={e => setCreateForm({ ...createForm, host: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Port</label>
                    <input
                      className="input"
                      value={createForm.port}
                      onChange={e => setCreateForm({ ...createForm, port: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Admin User (Existing)</label>
                    <input
                      className="input"
                      value={createForm.admin_user}
                      onChange={e => setCreateForm({ ...createForm, admin_user: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Admin Password</label>
                    <input
                      type="password"
                      className="input"
                      value={createForm.admin_password}
                      onChange={e => setCreateForm({ ...createForm, admin_password: e.target.value })}
                    />
                  </div>

                  <div className="form-group full" style={{ borderTop: '1px solid #e2e8f0', margin: '0.5rem 0' }}></div>

                  <div className="form-group">
                    <label>New DB User</label>
                    <input
                      className="input"
                      value={createForm.new_user}
                      onChange={e => setCreateForm({ ...createForm, new_user: e.target.value })}
                      placeholder="e.g. vantage_user"
                    />
                  </div>
                  <div className="form-group">
                    <label>New DB Password</label>
                    <input
                      type="password"
                      className="input"
                      value={createForm.new_password}
                      onChange={e => setCreateForm({ ...createForm, new_password: e.target.value })}
                    />
                  </div>
                  <div className="form-group full">
                    <label>New Database Name</label>
                    <input
                      className="input"
                      value={createForm.new_db_name}
                      onChange={e => setCreateForm({ ...createForm, new_db_name: e.target.value })}
                    />
                  </div>
                  <div className="form-group full">
                    <label>Your Email (for details)</label>
                    <input
                      type="email"
                      className="input"
                      value={createForm.email}
                      onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                      placeholder="you@company.com"
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-primary full-width-btn"
                  onClick={handleCreateDatabase}
                  disabled={isCreating}
                >
                  {isCreating ? 'Creating Database...' : 'Create & Connect'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="examples-section">
          <h2 className="section-title">Connection String Examples</h2>

          <div className="example-group">
            <div className="example-item">
              <span className="example-label">PostgreSQL</span>
              <code className="example-code">postgresql://user:password@localhost:5432/dbname</code>
            </div>

            <div className="example-item">
              <span className="example-label">MySQL</span>
              <code className="example-code">mysql+pymysql://user:password@localhost:3306/dbname</code>
            </div>

            <div className="example-item">
              <span className="example-label">SQLite</span>
              <code className="example-code">sqlite:///./data.db</code>
            </div>
          </div>
        </div>
        <style>{`
        .db-config-container {
          height: 100%;
          overflow-y: auto;
          background-color: var(--color-bg-primary);
          padding: 3rem;
        }

        .content-container {
          max-width: 800px;
        }

        .page-title {
          font-size: 2rem;
          margin-bottom: 0.5rem;
        }

        .page-subtitle {
          color: var(--color-text-secondary);
          margin-bottom: 2.5rem;
        }

        .config-section {
          margin-bottom: 2.5rem;
        }

        .card {
          background-color: var(--color-bg-secondary);
          padding: 1.5rem;
          border-radius: 12px;
          border: 1px solid var(--color-border);
        }

        .input-with-icon {
          position: relative;
          margin-bottom: 0.5rem;
        }

        .db-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--color-text-muted);
        }

        .input.padded {
          padding-left: 40px;
        }

        .helper-text {
          font-size: 0.85rem;
          color: var(--color-text-muted);
          margin-bottom: 1.5rem;
        }

        .full-width-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
        
        .alert-box {
            padding: 1rem;
            border-radius: 8px;
            display: flex;
            gap: 0.75rem;
            align-items: flex-start;
        }
        .alert-box.error { background: #fee2e2; color: #991b1b; }
        .alert-box.success { background: #dcfce7; color: #166534; }

        .examples-section {
          border: 1px solid var(--color-border);
          border-radius: 12px;
          padding: 1.5rem;
          background-color: white;
        }

        .section-title {
          font-size: 1.1rem;
          margin-bottom: 1.5rem;
        }

        .example-group {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .example-item {
          border: 1px solid var(--color-border);
          border-radius: 8px;
          padding: 1rem;
        }

        .example-label {
          display: block;
          font-weight: 500;
          font-size: 0.9rem;
          margin-bottom: 0.5rem;
          color: var(--color-text-secondary);
        }

        .example-code {
          font-family: monospace;
          background-color: #f8fafc;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          color: #475569;
          font-size: 0.9rem;
          display: block;
        }
        
        /* Modal Styles */
        .modal-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex; justify-content: center; align-items: center;
            z-index: 1000;
        }
        .modal-card {
            background: white; border-radius: 12px; width: 500px;
            max-width: 90%;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        }
        .modal-header {
            padding: 1.25rem; border-bottom: 1px solid #e2e8f0;
            display: flex; justify-content: space-between; align-items: center;
        }
        .modal-header h3 { font-size: 1.1rem; margin: 0; }
        .modal-body { padding: 1.5rem; }
        .modal-desc { font-size: 0.9rem; color: #64748b; margin-bottom: 1.5rem; }
        
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .form-group.full { grid-column: span 2; }
        .form-group label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; }
        
        .modal-footer { padding: 1.25rem; border-top: 1px solid #e2e8f0; }
        
        .btn-icon { background: none; border: none; cursor: pointer; color: #94a3b8; }
        .btn-icon:hover { color: #475569; }
      <style>{`
          .db - config - container {
            height: 100%;
          overflow-y: auto;
          background-color: var(--color-bg-primary);
          padding: 3rem;
        }
        /* ... existing styles ... */
      `}</style>
      </div>
    </div>
  );
};
