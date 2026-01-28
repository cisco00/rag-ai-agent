
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CreateOrganization } from './pages/CreateOrganization';
import { DatabaseConfig } from './pages/DatabaseConfig';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ScheduledReports } from './pages/ScheduledReports';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/create-org" element={<CreateOrganization />} />
        <Route path="/database-config" element={<DatabaseConfig />} />
        <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<Dashboard />} />
        <Route path="/query" element={<Dashboard />} />
        <Route path="/tables" element={<Dashboard />} />
        <Route path="/import" element={<Dashboard />} />
        <Route path="/scheduled-reports" element={<ScheduledReports />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
