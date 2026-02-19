import React from 'react';
import { MessageSquare, Table, Upload, Settings, LogOut, Sparkles, Clock, BarChart2, Database } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../services/api';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen = false, onClose }) => {
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

  const handleNavClick = (path: string) => {
    navigate(path);
    if (onClose) onClose(); // Close drawer on mobile selection
  };

  const handleLogout = () => {
    navigate('/');
    if (onClose) onClose();
  }

  return (
    <>
      {/* Mobile Overlay */}
      <div
        className={`sidebar-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
      />

      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
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
          <button className={`nav-item ${isActive('/chat') ? 'active' : ''}`} onClick={() => handleNavClick('/chat')}>
            <MessageSquare size={18} />
            <span>Chat Code</span>
          </button>
          <button className={`nav-item ${isActive('/data') ? 'active' : ''}`} onClick={() => handleNavClick('/data')}>
            <Database size={18} />
            <span>Data Management</span>
          </button>
          <button className={`nav-item ${isActive('/analytics') ? 'active' : ''}`} onClick={() => handleNavClick('/analytics')}>
            <BarChart2 size={18} />
            <span>Analytics</span>
          </button>

          <div className="nav-divider" style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '0.5rem 0' }}></div>

          <button className={`nav-item ${isActive('/tables') ? 'active' : ''}`} onClick={() => handleNavClick('/tables')}>
            <Table size={18} />
            <span>Tables</span>
          </button>
          <button className={`nav-item ${isActive('/database-config') ? 'active' : ''}`} onClick={() => handleNavClick('/database-config')}>
            <Settings size={18} />
            <span>Configuration</span>
          </button>
          <button className={`nav-item ${isActive('/scheduled-reports') ? 'active' : ''}`} onClick={() => handleNavClick('/scheduled-reports')}>
            <Clock size={18} />
            <span>Scheduled Reports</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item logout" onClick={handleLogout}>
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>

        <style>{`
        .sidebar {
          width: 260px;
          height: 100vh;
          background-color: var(--sidebar-bg);
          border-right: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          padding: 1.5rem;
          flex-shrink: 0;
          transition: transform 0.3s ease-in-out;
          z-index: 1001; /* Above overlay */
        }
        
        .sidebar-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.3s;
            pointer-events: none;
        }

        @media (max-width: 768px) {
            .sidebar {
                position: fixed;
                top: 0;
                left: 0;
                bottom: 0;
                transform: translateX(-100%);
            }
            .sidebar.open {
                transform: translateX(0);
                box-shadow: 2px 0 8px rgba(0,0,0,0.2);
            }
            .sidebar-overlay {
                display: block;
            }
            .sidebar-overlay.open {
                opacity: 1;
                pointer-events: auto;
            }
        }

        /* Existing Styles ... */
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
          color: var(--sidebar-text);
        }

        .user-info {
          padding-left: 0.25rem;
        }
        
        .username {
          color: var(--sidebar-text-muted);
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
          color: var(--sidebar-text-muted);
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 0.95rem;
          text-align: left;
          width: 100%;
          transition: all 0.2s;
        }

        .nav-item:hover {
          background-color: var(--sidebar-hover);
          color: var(--sidebar-text);
        }

        .nav-item.active {
          background-color: var(--sidebar-active);
          color: white;
        }
        
        .sidebar-footer {
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 1rem;
        }
        
        .logout:hover {
          color: #ef4444; 
          background-color: rgba(239, 68, 68, 0.1);
        }
      `}</style>
      </div>
    </>
  );
};
