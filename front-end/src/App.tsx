
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CreateOrganization } from './pages/CreateOrganization';
import { DatabaseConfig } from './pages/DatabaseConfig';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ScheduledReports } from './pages/ScheduledReports';
import { ChatPage } from './pages/ChatPage';
import { DataPage } from './pages/DataPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { MainLayout } from './components/MainLayout';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/create-org" element={<CreateOrganization />} />

        {/* New Features Layout */}
        <Route element={<MainLayout />}>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Route>

        {/* Existing Routes (Dashboard handles its own Sidebar) */}
        <Route path="/database-config" element={<DatabaseConfig />} />
        <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<Dashboard />} />
        <Route path="/query" element={<Dashboard />} />
        <Route path="/tables" element={<Dashboard />} />
        <Route path="/import" element={<Dashboard />} />
        <Route path="/history" element={<Dashboard />} />
        <Route path="/scheduled-reports" element={<ScheduledReports />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
