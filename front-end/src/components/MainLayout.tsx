
import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export const MainLayout: React.FC = () => {
    return (
        <div className="app-layout">
            <Sidebar />
            <main className="app-main">
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
                }
            `}</style>
        </div>
    );
};
