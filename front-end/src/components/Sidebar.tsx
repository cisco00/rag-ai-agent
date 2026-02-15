import React from 'react';
import { MessageSquare, Table, Upload, Settings, LogOut, Sparkles, Clock, BarChart2, Database } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../services/api';

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  const [orgName, setOrgName] = React.useState('Organization');

  React.useEffect(() => {
    const fetchOrgInfo = async () => {
      const savedName = localStorage.getItem('vantage_org_name');
      if (savedName) {
        setOrgName(savedName);
      }

      const apiKey = localStorage.getItem('vantage_api_key');
      if (apiKey) {
        try {
          // Fetch fresh stats which includes org_name
          const stats = await api.getStats(apiKey);
          if (stats.org_name) {
            setOrgName(stats.org_name);
            if (stats.org_name !== savedName) {
              localStorage.setItem('vantage_org_name', stats.org_name);
            }
          }
        } catch (e) {
          console.error("Failed to refresh org name", e);
        }
      }
    };

    fetchOrgInfo();
  }, []);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="logo-section">
          <div className="sidebar-logo-icon">
            <Sparkles size={16} color="white" />
          </div>
          <span className="sidebar-brand">Vantage AI</span>
        </div>
        <div className="user-info">
          <span className="username">{orgName}</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button className={`nav-item ${isActive('/chat') ? 'active' : ''}`} onClick={() => navigate('/chat')}>
          <MessageSquare size={18} />
          <span>Chat Code</span>
        </button>
        <button className={`nav-item ${isActive('/data') ? 'active' : ''}`} onClick={() => navigate('/data')}>
          <Database size={18} />
          <span>Data Sources</span>
        </button>
        <button className={`nav-item ${isActive('/analytics') ? 'active' : ''}`} onClick={() => navigate('/analytics')}>
          <BarChart2 size={18} />
          <span>Analytics</span>
        </button>

        <div className="nav-divider" style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '0.5rem 0' }}></div>

        <button className={`nav-item ${isActive('/query') ? 'active' : ''}`} onClick={() => navigate('/query')}>
          <MessageSquare size={18} />
          <span>Legacy Query</span>
        </button>
        <button className={`nav-item ${isActive('/tables') ? 'active' : ''}`} onClick={() => navigate('/tables')}>
          <Table size={18} />
          <span>Tables</span>
        </button>
        <button className={`nav-item ${isActive('/import') ? 'active' : ''}`} onClick={() => navigate('/import')}>
          <Upload size={18} />
          <span>Import Files</span>
        </button>
        <button className={`nav-item ${isActive('/database-config') ? 'active' : ''}`} onClick={() => navigate('/database-config')}>
          <Settings size={18} />
          <span>Configuration</span>
        </button>
        <button className={`nav-item ${isActive('/scheduled-reports') ? 'active' : ''}`} onClick={() => navigate('/scheduled-reports')}>
          <Clock size={18} />
          <span>Scheduled Reports</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <button className="nav-item logout" onClick={() => navigate('/')}>
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </div>

      <style>{`
        .sidebar {
          width: 260px;
          height: 100vh;
          background-color: var(--sidebar-bg); /* Updated */
          border-right: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          padding: 1.5rem;
          flex-shrink: 0;
        }

        .sidebar-header {
          margin-bottom: 2.5rem;
        }

        .logo-section {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .sidebar-logo-icon {
          background-color: var(--color-primary);
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sidebar-brand {
          font-weight: 600;
          font-size: 1.1rem;
          color: var(--sidebar-text); /* Updated */
        }

        .user-info {
          padding-left: 0.25rem;
        }
        
        .username {
          color: var(--sidebar-text-muted); /* Updated */
          font-size: 0.85rem;
        }

        .sidebar-nav {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          flex: 1;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          border-radius: 8px;
          color: var(--sidebar-text-muted); /* Updated */
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 0.95rem;
          text-align: left;
          width: 100%;
          transition: all 0.2s;
        }

        .nav-item:hover {
          background-color: var(--sidebar-hover); /* Updated */
          color: var(--sidebar-text); /* Updated */
        }

        .nav-item.active {
          background-color: var(--sidebar-active); /* Updated */
          color: white;
        }
        
        .sidebar-footer {
          border-top: 1px solid rgba(255,255,255,0.1); /* Updated border for dark bg */
          padding-top: 1rem;
        }
        
        .logout:hover {
          color: #ef4444; 
          background-color: rgba(239, 68, 68, 0.1);
        }
      `}</style>
    </div>
  );
};
