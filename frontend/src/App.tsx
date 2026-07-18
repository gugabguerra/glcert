import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppShell, Title, Group, Box, Button, NavLink, ActionIcon, Tooltip, useMantineColorScheme } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconShield, IconCertificate, IconSettings, IconSun, IconMoon, IconDeviceDesktop } from '@tabler/icons-react';
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
  const location = useLocation();

  if (isSetupComplete === false) return <Setup />;
  if (!isAuthenticated) return <Login />;

  const { setColorScheme, colorScheme } = useMantineColorScheme();

  const cycleColorScheme = () => {
    const next = colorScheme === 'dark' ? 'light' : colorScheme === 'light' ? 'auto' : 'dark';
    setColorScheme(next);
    localStorage.setItem('glcert-color-scheme', next);
  };

  const ColorSchemeIcon = colorScheme === 'dark' ? IconSun : colorScheme === 'light' ? IconMoon : IconDeviceDesktop;

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md">
          <Group gap="xs" style={{ cursor: 'pointer' }}>
            <Link to="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconShield size={24} color="var(--mantine-color-teal-6)" />
              <Title order={3}>GLCert</Title>
            </Link>
          </Group>
          <Box component="nav" style={{ flex: 1, display: 'flex', gap: 4 }}>
            <NavLink component={Link} to="/" label="Dashboard" leftSection={<IconSettings size={18} />} active={location.pathname === '/'} />
            <NavLink component={Link} to="/ca" label="CAs" leftSection={<IconShield size={18} />} active={location.pathname.startsWith('/ca')} />
            <NavLink component={Link} to="/certificates" label="Certificates" leftSection={<IconCertificate size={18} />} active={location.pathname.startsWith('/certificates')} />
            <NavLink component={Link} to="/settings" label="Settings" leftSection={<IconSettings size={18} />} active={location.pathname === '/settings'} />
          </Box>
          <Tooltip label={`Theme: ${colorScheme === 'dark' ? 'Light' : colorScheme === 'light' ? 'Dark' : 'Light'}`}>
            <ActionIcon variant="subtle" size="lg" onClick={cycleColorScheme}>
              <ColorSchemeIcon size={20} />
            </ActionIcon>
          </Tooltip>
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
