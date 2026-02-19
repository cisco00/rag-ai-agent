
import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export const MainLayout: React.FC = () => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

    return (
        <div className="app-layout">
            <Sidebar isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />

            <main className="app-main">
                <button
                    className="mobile-menu-btn"
                    onClick={() => setIsMobileMenuOpen(true)}
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="3" y1="12" x2="21" y2="12"></line>
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <line x1="3" y1="18" x2="21" y2="18"></line>
                    </svg>
                </button>
                <Outlet />
            </main>
            <style>{`
                .app-layout {
                    display: flex;
                    width: 100vw;
                    height: 100vh;
                    overflow: hidden;
                    background-color: var(--bg-primary, #f8fafc);
                }
                .app-main {
                    flex: 1;
                    overflow: hidden;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                }
                .mobile-menu-btn {
                    display: none;
                    position: absolute;
                    top: 1rem;
                    left: 1rem;
                    z-index: 50;
                    background: white;
                    border: 1px solid var(--color-border);
                    border-radius: 8px;
                    padding: 0.5rem;
                    cursor: pointer;
                    color: var(--color-text-primary);
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                }
                @media (max-width: 768px) {
                    .mobile-menu-btn {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    /* Add padding to top of main content to account for the button/header area */
                    .app-main {
                        padding-top: 0; /* Let pages handle their own padding, but button is floating */
                    }
                }
            `}</style>
        </div>
    );
};
