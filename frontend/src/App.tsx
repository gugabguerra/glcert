import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell, Title, Group, Box, Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import CertificateAuthorities from './pages/CertificateAuthorities';
import CreateCA from './pages/CreateCA';
import CADetail from './pages/CADetail';
import Certificates from './pages/Certificates';
import CreateCertificate from './pages/CreateCertificate';
import CertificateDetail from './pages/CertificateDetail';

function AppRoutes() {
  const { isAuthenticated, isSetupComplete, logout } = useAuth();

  if (isSetupComplete === false) return <Setup />;
  if (!isAuthenticated) return <Login />;

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md">
          <Title order={3} style={{ cursor: 'pointer' }}>
            <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
              GLCert
            </Link>
          </Title>
          <Box component="nav" style={{ flex: 1 }}>
            <Link to="/" style={{ marginRight: 16, color: 'inherit', textDecoration: 'none' }}>
              Dashboard
            </Link>
            <Link to="/ca" style={{ marginRight: 16, color: 'inherit', textDecoration: 'none' }}>
              CAs
            </Link>
            <Link to="/certificates" style={{ marginRight: 16, color: 'inherit', textDecoration: 'none' }}>
              Certificates
            </Link>
            <Link to="/settings" style={{ color: 'inherit', textDecoration: 'none' }}>
              Settings
            </Link>
          </Box>
          <Button variant="subtle" size="sm" onClick={logout}>
            Sign Out
          </Button>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ca" element={<CertificateAuthorities />} />
          <Route path="/ca/new" element={<CreateCA />} />
          <Route path="/ca/:id" element={<CADetail />} />
          <Route path="/certificates" element={<Certificates />} />
          <Route path="/certificates/new" element={<CreateCertificate />} />
          <Route path="/certificates/:id" element={<CertificateDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
