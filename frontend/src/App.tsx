import { useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AppShell, Group, Box, NavLink, ActionIcon, useMantineColorScheme, useComputedColorScheme, Burger, Drawer, Divider, Stack, Space, Image } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Link } from 'react-router-dom';
import { IconShield, IconCertificate, IconSettings, IconSun, IconMoon, IconDeviceDesktop, IconLogout, IconUser, IconAdjustments } from '@tabler/icons-react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Administration from './pages/Administration';
import UserProfile from './pages/UserProfile';
import CertificateAuthorities from './pages/CertificateAuthorities';
import CreateCA from './pages/CreateCA';
import ImportCA from './pages/ImportCA';
import CADetail from './pages/CADetail';
import Certificates from './pages/Certificates';
import CreateCertificate from './pages/CreateCertificate';
import ImportCertificate from './pages/ImportCertificate';
import CertificateDetail from './pages/CertificateDetail';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { hasRole } = useAuth();
  if (!hasRole('admin')) return <Navigate to="/" />;
  return <>{children}</>;
}

function OperatorRoute({ children }: { children: React.ReactNode }) {
  const { hasRole } = useAuth();
  if (!hasRole('admin', 'operator')) return <Navigate to="/" />;
  return <>{children}</>;
}

function ViewerRoute({ children }: { children: React.ReactNode }) {
  const { hasRole } = useAuth();
  if (hasRole('viewer')) return <Navigate to="/certificates" />;
  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated, isSetupComplete, logout, hasRole } = useAuth();
  const location = useLocation();

  if (isSetupComplete === false) return <Setup />;
  if (!isAuthenticated) return <Login />;

  const { setColorScheme, colorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light');
  const [drawerOpened, setDrawerOpened] = useState(false);
  const [profileOpened, setProfileOpened] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const navigate = useNavigate();

  const openProfile = () => {
    if (isMobile) {
      navigate('/profile');
    } else {
      setProfileOpened(true);
    }
    setDrawerOpened(false);
  };

  const cycleColorScheme = () => {
    const next = colorScheme === 'dark' ? 'light' : colorScheme === 'light' ? 'auto' : 'dark';
    setColorScheme(next);
    localStorage.setItem('glcert-color-scheme', next);
  };

  const ColorSchemeIcon = colorScheme === 'dark' ? IconMoon : colorScheme === 'light' ? IconSun : IconDeviceDesktop;

  const navLinks = (
    <>
      {!hasRole('viewer') && (
        <>
          <NavLink component={Link} to="/" label="Dashboard" leftSection={<IconSettings size={18} />} active={location.pathname === '/'} onClick={() => setDrawerOpened(false)} />
          <NavLink component={Link} to="/ca" label="CAs" leftSection={<IconShield size={18} />} active={location.pathname.startsWith('/ca')} onClick={() => setDrawerOpened(false)} />
        </>
      )}
      <NavLink component={Link} to="/certificates" label="Certificates" leftSection={<IconCertificate size={18} />} active={location.pathname.startsWith('/certificates')} onClick={() => setDrawerOpened(false)} />
      {hasRole('admin') && (
        <>
          <NavLink component={Link} to="/settings" label="Settings" leftSection={<IconSettings size={18} />} active={location.pathname === '/settings'} onClick={() => setDrawerOpened(false)} />
          <NavLink component={Link} to="/admin" label="Administration" leftSection={<IconAdjustments size={18} />} active={location.pathname === '/admin'} onClick={() => setDrawerOpened(false)} />
        </>
      )}
    </>
  );

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={drawerOpened} onClick={() => setDrawerOpened(!drawerOpened)} display={isMobile ? 'block' : 'none'} />
          <Group gap="xs" style={{ cursor: 'pointer' }}>
            <Link to="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Image
                src={computedColorScheme === 'dark' ? '/glcert-logo-dark.png' : '/glcert-logo-light.png'}
                h={32}
                fit="contain"
              />
            </Link>
          </Group>
          <Box component="nav" style={{ flex: 1, display: 'flex', gap: 4 }} display={isMobile ? 'none' : 'flex'}>
            {navLinks}
          </Box>
          {!isMobile && (
            <Space>
              <ActionIcon variant="subtle" size="lg" onClick={cycleColorScheme}>
                <ColorSchemeIcon size={20} />
              </ActionIcon>
              <ActionIcon variant="subtle" size="lg" onClick={openProfile} ml="10">
                <IconUser size={20} />
              </ActionIcon>
              <ActionIcon variant="subtle" size="lg" onClick={logout} ml="10">
                <IconLogout size={20} />
              </ActionIcon>
            </Space>
          )}
        </Group>
      </AppShell.Header>

      <Drawer opened={drawerOpened} onClose={() => setDrawerOpened(false)} position="right" size="sm" title={
        <Group gap="xs">
          <Image
            src={computedColorScheme === 'dark' ? '/glcert-logo-dark.png' : '/glcert-logo-light.png'}
            h={24}
            fit="contain"
          />
        </Group>
      }>
        <Stack gap="xs">
          {navLinks}
          <Divider my="sm" />
          <NavLink
            label={`Theme: ${colorScheme === 'dark' ? 'Light' : colorScheme === 'light' ? 'Dark' : 'Auto'}`}
            leftSection={<ColorSchemeIcon size={18} />}
            onClick={() => { cycleColorScheme(); setDrawerOpened(false); }}
          />
          <NavLink
            label="Profile"
            leftSection={<IconUser size={18} />}
            onClick={openProfile}
          />
          <NavLink
            label="Sign Out"
            leftSection={<IconLogout size={18} />}
            onClick={() => { logout(); setDrawerOpened(false); }}
            color="red"
          />
        </Stack>
      </Drawer>

      <Drawer opened={profileOpened} onClose={() => setProfileOpened(false)} position="right" size="800">
        <UserProfile />
      </Drawer>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<ViewerRoute><Dashboard /></ViewerRoute>} />
          <Route path="/ca" element={<ViewerRoute><CertificateAuthorities /></ViewerRoute>} />
          <Route path="/ca/new" element={<AdminRoute><CreateCA /></AdminRoute>} />
          <Route path="/ca/import" element={<AdminRoute><ImportCA /></AdminRoute>} />
          <Route path="/ca/:id" element={<ViewerRoute><CADetail /></ViewerRoute>} />
          <Route path="/certificates" element={<Certificates />} />
          <Route path="/certificates/new" element={<OperatorRoute><CreateCertificate /></OperatorRoute>} />
          <Route path="/certificates/import" element={<OperatorRoute><ImportCertificate /></OperatorRoute>} />
          <Route path="/certificates/:id" element={<CertificateDetail />} />
          <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
          <Route path="/admin" element={<AdminRoute><Administration /></AdminRoute>} />
          <Route path="/profile" element={<UserProfile />} />
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
