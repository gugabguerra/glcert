import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AppLayout } from './components/shell/AppLayout';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Timeline from './pages/Timeline';
import Settings from './pages/Settings';
import Users from './pages/Users';
import AuditLog from './pages/AuditLog';
import UserProfile from './pages/UserProfile';
import TwoFactorSetup from './pages/TwoFactorSetup';
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

// Old Administration links: ?tab=audit went to the audit log, everything else to users.
function LegacyAdminRedirect() {
  const [params] = useSearchParams();
  return <Navigate to={params.get('tab') === 'audit' ? '/audit' : '/users'} replace />;
}

// Only the auth hook runs before the early returns; everything else that needs hooks lives in
// AppLayout, so signing in or out never changes this component's hook order.
function AppRoutes() {
  const { isAuthenticated, isSetupComplete } = useAuth();

  if (isSetupComplete === false) return <Setup />;
  // Signed out: the password reset pages must stay reachable (the reset link arrives by email).
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route
          path="/"
          element={
            <ViewerRoute>
              <Timeline />
            </ViewerRoute>
          }
        />
        <Route
          path="/ca"
          element={
            <ViewerRoute>
              <CertificateAuthorities />
            </ViewerRoute>
          }
        />
        <Route
          path="/ca/new"
          element={
            <AdminRoute>
              <CreateCA />
            </AdminRoute>
          }
        />
        <Route
          path="/ca/import"
          element={
            <AdminRoute>
              <ImportCA />
            </AdminRoute>
          }
        />
        <Route
          path="/ca/:id"
          element={
            <ViewerRoute>
              <CADetail />
            </ViewerRoute>
          }
        />
        <Route path="/certificates" element={<Certificates />} />
        <Route
          path="/certificates/new"
          element={
            <OperatorRoute>
              <CreateCertificate />
            </OperatorRoute>
          }
        />
        <Route
          path="/certificates/import"
          element={
            <OperatorRoute>
              <ImportCertificate />
            </OperatorRoute>
          }
        />
        <Route path="/certificates/:id" element={<CertificateDetail />} />
        <Route
          path="/settings"
          element={
            <AdminRoute>
              <Settings />
            </AdminRoute>
          }
        />
        <Route
          path="/users"
          element={
            <AdminRoute>
              <Users />
            </AdminRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <AdminRoute>
              <AuditLog />
            </AdminRoute>
          }
        />
        <Route path="/admin" element={<LegacyAdminRedirect />} />
        <Route path="/profile" element={<UserProfile />} />
        <Route path="/profile/two-factor" element={<TwoFactorSetup />} />
      </Route>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
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
