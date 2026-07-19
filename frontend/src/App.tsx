import { useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppShell, Title, Group, Box, Button, NavLink, ActionIcon, Tooltip, useMantineColorScheme, Burger, Drawer, Divider, Stack } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Link } from 'react-router-dom';
import { IconShield, IconCertificate, IconSettings, IconSun, IconMoon, IconDeviceDesktop, IconLogout } from '@tabler/icons-react';
import { AuthProvider, useAuth } from './auth';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import CertificateAuthorities from './pages/CertificateAuthorities';
import CreateCA from './pages/CreateCA';
import ImportCA from './pages/ImportCA';
import CADetail from './pages/CADetail';
import Certificates from './pages/Certificates';
import CreateCertificate from './pages/CreateCertificate';
import CertificateDetail from './pages/CertificateDetail';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';

function AppRoutes() {
  const { isAuthenticated, isSetupComplete, logout } = useAuth();
  const location = useLocation();

  if (isSetupComplete === false) return <Setup />;
  if (!isAuthenticated) return <Login />;

  const { setColorScheme, colorScheme } = useMantineColorScheme();
  const [drawerOpened, setDrawerOpened] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const cycleColorScheme = () => {
    const next = colorScheme === 'dark' ? 'light' : colorScheme === 'light' ? 'auto' : 'dark';
    setColorScheme(next);
    localStorage.setItem('glcert-color-scheme', next);
  };

  const ColorSchemeIcon = colorScheme === 'dark' ? IconSun : colorScheme === 'light' ? IconMoon : IconDeviceDesktop;

  const navLinks = (
    <>
      <NavLink component={Link} to="/" label="Dashboard" leftSection={<IconSettings size={18} />} active={location.pathname === '/'} onClick={() => setDrawerOpened(false)} />
      <NavLink component={Link} to="/ca" label="CAs" leftSection={<IconShield size={18} />} active={location.pathname.startsWith('/ca')} onClick={() => setDrawerOpened(false)} />
      <NavLink component={Link} to="/certificates" label="Certificates" leftSection={<IconCertificate size={18} />} active={location.pathname.startsWith('/certificates')} onClick={() => setDrawerOpened(false)} />
      <NavLink component={Link} to="/settings" label="Settings" leftSection={<IconSettings size={18} />} active={location.pathname === '/settings'} onClick={() => setDrawerOpened(false)} />
    </>
  );

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={drawerOpened} onClick={() => setDrawerOpened(!drawerOpened)} display={isMobile ? 'block' : 'none'} />
          <Group gap="xs" style={{ cursor: 'pointer' }}>
            <Link to="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconShield size={24} color="var(--mantine-color-teal-6)" />
              <Title order={3}>GLCert</Title>
            </Link>
          </Group>
          <Box component="nav" style={{ flex: 1, display: 'flex', gap: 4 }} display={isMobile ? 'none' : 'flex'}>
            {navLinks}
          </Box>
          <Tooltip label={`Theme: ${colorScheme === 'dark' ? 'Light' : colorScheme === 'light' ? 'Dark' : 'Light'}`}>
            <ActionIcon variant="subtle" size="lg" onClick={cycleColorScheme}>
              <ColorSchemeIcon size={20} />
            </ActionIcon>
          </Tooltip>
          {!isMobile && (
            <Button variant="subtle" size="sm" onClick={logout}>
              Sign Out
            </Button>
          )}
        </Group>
      </AppShell.Header>

      <Drawer opened={drawerOpened} onClose={() => setDrawerOpened(false)} position="right" size="sm" title="GLCert">
        <Stack gap="xs">
          {navLinks}
          <Divider my="sm" />
          <NavLink
            label={`Theme: ${colorScheme === 'dark' ? 'Light' : colorScheme === 'light' ? 'Dark' : 'Auto'}`}
            leftSection={<ColorSchemeIcon size={18} />}
            onClick={() => { cycleColorScheme(); setDrawerOpened(false); }}
          />
          <NavLink
            label="Sign Out"
            leftSection={<IconLogout size={18} />}
            onClick={() => { logout(); setDrawerOpened(false); }}
            color="red"
          />
        </Stack>
      </Drawer>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ca" element={<CertificateAuthorities />} />
          <Route path="/ca/new" element={<CreateCA />} />
          <Route path="/ca/import" element={<ImportCA />} />
          <Route path="/ca/:id" element={<CADetail />} />
          <Route path="/certificates" element={<Certificates />} />
          <Route path="/certificates/new" element={<CreateCertificate />} />
          <Route path="/certificates/:id" element={<CertificateDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
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
