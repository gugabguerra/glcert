import { useState, useEffect } from 'react';
import {
  Title, Text, Button, Table, Badge, Group, Modal, TextInput, PasswordInput, Select, Stack,
  ActionIcon, Tooltip, Paper, Skeleton, Tabs, Pagination, FileInput, Divider,
} from '@mantine/core';
import { IconPlus, IconTrash, IconEdit, IconKey } from '@tabler/icons-react';
import { authFetch, authFetchJson, authFetchDownload } from '../api';
import { PasswordStrengthIndicator } from '../components/PasswordStrengthIndicator';

// ── Types ──────────────────────────────────────────────────────────────────

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  totpEnabled: boolean;
  createdAt: string;
}

interface CA {
  id: string;
  name: string;
  description: string;
}

interface AuditEntry {
  id: number;
  userId: string | null;
  userEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: string;
  createdAt: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const roleColors: Record<string, string> = { admin: 'red', operator: 'blue', viewer: 'green' };

const actionColors: Record<string, string> = {
  'certificate.create': 'green', 'certificate.delete': 'red', 'certificate.regenerate': 'blue',
  'certificate.import': 'cyan', 'ca.create': 'green', 'ca.delete': 'red', 'ca.import': 'cyan',
  'ca.permissions.update': 'yellow', 'user.create': 'green', 'user.delete': 'red',
  'user.role_change': 'yellow', 'user.password_reset': 'yellow', 'settings.update': 'gray',
  'factory_reset': 'red', 'backup.create': 'blue', 'backup.restore': 'yellow',
};

const actionLabels: Record<string, string> = {
  'certificate.create': 'Cert Created', 'certificate.delete': 'Cert Deleted',
  'certificate.regenerate': 'Cert Regenerated', 'certificate.import': 'Cert Imported',
  'ca.create': 'CA Created', 'ca.delete': 'CA Deleted', 'ca.import': 'CA Imported',
  'ca.permissions.update': 'CA Permissions Updated', 'user.create': 'User Created',
  'user.delete': 'User Deleted', 'user.role_change': 'Role Changed',
  'user.password_reset': 'Password Reset', 'settings.update': 'Settings Updated',
  'factory_reset': 'Factory Reset', 'backup.create': 'Backup Created',
  'backup.restore': 'Backup Restored',
};

// ── User Management ────────────────────────────────────────────────────────

function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpened, setCreateOpened] = useState(false);
  const [editOpened, setEditOpened] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);

  // Create form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newConfirmPassword, setNewConfirmPassword] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [newCAIds, setNewCAIds] = useState<string[]>([]);

  // Edit form
  const [editRole, setEditRole] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');

  const [cas, setCas] = useState<CA[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadUsers = async () => {
    try {
      const data = await authFetchJson<User[]>('/api/users');
      setUsers(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const loadCAs = async () => {
    try {
      const data = await authFetchJson<CA[]>('/api/ca/');
      setCas(data);
    } catch { /* ignore */ }
  };

  useEffect(() => { loadUsers(); loadCAs(); }, []);

  const resetCreateForm = () => {
    setNewName(''); setNewEmail(''); setNewPassword(''); setNewConfirmPassword('');
    setNewRole('viewer'); setNewCAIds([]); setError('');
  };

  const handleCreate = async () => {
    setError('');
    if (newPassword !== newConfirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      const created: User = await authFetchJson('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, email: newEmail, password: newPassword, role: newRole }),
      });

      if (newRole !== 'admin' && newCAIds.length > 0) {
        for (const caId of newCAIds) {
          try {
            const current = await authFetchJson<{ userIds: string[] }>(`/api/ca/${caId}/permissions`);
            const updated = [...new Set([...(current.userIds || []), created.id])];
            await authFetchJson(`/api/ca/${caId}/permissions`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userIds: updated }),
            });
          } catch { /* continue with next CA */ }
        }
      }

      setCreateOpened(false);
      resetCreateForm();
      loadUsers();
    } catch (e: any) {
      setError(e.message || 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateRole = async () => {
    if (!editUser) return;
    setError('');
    setSubmitting(true);
    try {
      await authFetchJson(`/api/users/${editUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: editRole }),
      });
      setEditOpened(false);
      loadUsers();
    } catch (e: any) {
      setError(e.message || 'Failed to update user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!editUser) return;
    setError('');
    if (resetPassword !== resetConfirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/users/${editUser.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPassword }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to reset password');
      }
      setResetPassword('');
      setResetConfirmPassword('');
      setEditOpened(false);
    } catch (e: any) {
      setError(e.message || 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Delete user ${user.email}?`)) return;
    try {
      const res = await authFetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to delete user');
      }
      loadUsers();
    } catch (e: any) {
      alert(e.message || 'Failed to delete user');
    }
  };

  if (loading) return <Skeleton height={400} />;

  return (
    <>
      <Group justify="space-between" mb="lg">
        <div>
          <Title order={3}>User Management</Title>
          <Text c="dimmed" size="sm">Manage user accounts, roles, and permissions</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => { resetCreateForm(); setCreateOpened(true); }}>
          Add User
        </Button>
      </Group>

      <Paper withBorder p="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>2FA</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map(u => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.name || '—'}</Table.Td>
                <Table.Td>{u.email}</Table.Td>
                <Table.Td>
                  <Badge color={roleColors[u.role]} variant="light" size="sm">{u.role}</Badge>
                </Table.Td>
                <Table.Td>{u.totpEnabled ? 'Enabled' : '—'}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Tooltip label="Edit user">
                      <ActionIcon variant="subtle" size="sm" onClick={() => {
                        setEditUser(u); setEditRole(u.role);
                        setResetPassword(''); setResetConfirmPassword(''); setError('');
                        setEditOpened(true);
                      }}>
                        <IconEdit size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete user">
                      <ActionIcon variant="subtle" size="sm" color="red" onClick={() => handleDelete(u)}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      {/* ── Create User Modal ── */}
      <Modal opened={createOpened} onClose={() => setCreateOpened(false)} title="Create User" size="md">
        <Stack gap="md">
          <TextInput label="Name" value={newName} onChange={e => setNewName(e.currentTarget.value)} />
          <TextInput label="Email" type="email" value={newEmail} onChange={e => setNewEmail(e.currentTarget.value)} required />
          <PasswordInput label="Password" value={newPassword} onChange={e => setNewPassword(e.currentTarget.value)} required />
          <PasswordStrengthIndicator password={newPassword} />
          <PasswordInput label="Confirm Password" value={newConfirmPassword} onChange={e => setNewConfirmPassword(e.currentTarget.value)} required />
          <Select
            label="Role"
            value={newRole}
            onChange={v => { setNewRole(v || 'viewer'); setNewCAIds([]); }}
            data={[
              { value: 'admin', label: 'Admin' },
              { value: 'operator', label: 'Operator' },
              { value: 'viewer', label: 'Viewer' },
            ]}
          />
          {newRole !== 'admin' && cas.length > 0 && (
            <Select
              label="CA Access"
              placeholder="Select CAs this user can access"
              data={cas.map(ca => ({ value: ca.id, label: ca.name }))}
              value={null}
              onChange={v => { if (v && !newCAIds.includes(v)) setNewCAIds([...newCAIds, v]); }}
              searchable
            />
          )}
          {newRole !== 'admin' && newCAIds.length > 0 && (
            <Group gap="xs">
              {newCAIds.map(caId => {
                const ca = cas.find(c => c.id === caId);
                return (
                  <Badge key={caId} variant="light" color="teal" pr={3}>
                    {ca?.name || caId}
                    <ActionIcon size="xs" variant="subtle" color="teal" onClick={() => setNewCAIds(newCAIds.filter(id => id !== caId))} ml={4}>
                      <IconTrash size={10} />
                    </ActionIcon>
                  </Badge>
                );
              })}
            </Group>
          )}
          {error && <Text c="red" size="sm">{error}</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOpened(false)}>Cancel</Button>
            <Button
              loading={submitting}
              onClick={handleCreate}
              disabled={!newEmail || !newPassword || !newConfirmPassword || newPassword !== newConfirmPassword}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Edit User Modal ── */}
      <Modal opened={editOpened} onClose={() => setEditOpened(false)} title={`Edit ${editUser?.email}`} size="md">
        <Stack gap="md">
          <Select
            label="Role"
            value={editRole}
            onChange={v => setEditRole(v || 'viewer')}
            data={[
              { value: 'admin', label: 'Admin' },
              { value: 'operator', label: 'Operator' },
              { value: 'viewer', label: 'Viewer' },
            ]}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditOpened(false)}>Cancel</Button>
            <Button loading={submitting} onClick={handleUpdateRole}>Save Role</Button>
          </Group>

          <Divider label="Reset Password" labelPosition="left" />
          <PasswordInput label="New Password" value={resetPassword} onChange={e => setResetPassword(e.currentTarget.value)} placeholder="Leave empty to skip" />
          <PasswordStrengthIndicator password={resetPassword} />
          {resetPassword && (
            <PasswordInput label="Confirm New Password" value={resetConfirmPassword} onChange={e => setResetConfirmPassword(e.currentTarget.value)} />
          )}
          {error && <Text c="red" size="sm">{error}</Text>}
          <Group justify="flex-end">
            <Button
              color="orange"
              leftSection={<IconKey size={16} />}
              loading={submitting}
              disabled={!resetPassword || !resetConfirmPassword || resetPassword !== resetConfirmPassword}
              onClick={handleResetPassword}
            >
              Set Password
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

// ── Audit Log ──────────────────────────────────────────────────────────────

function AuditLogSection() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (actionFilter) params.set('action', actionFilter);
    authFetchJson<{ entries: AuditEntry[]; total: number }>(`/api/audit?${params}`)
      .then(data => { setEntries(data.entries || []); setTotal(data.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, actionFilter]);

  const totalPages = Math.ceil(total / 50);

  if (loading) return <Skeleton height={400} />;

  return (
    <>
      <Group justify="space-between" mb="lg">
        <div>
          <Title order={3}>Audit Log</Title>
          <Text c="dimmed" size="sm">System activity history</Text>
        </div>
        <Select
          placeholder="All actions"
          value={actionFilter}
          onChange={v => { setActionFilter(v); setPage(1); }}
          clearable
          data={Object.entries(actionLabels).map(([value, label]) => ({ value, label }))}
          w={250}
        />
      </Group>

      <Paper withBorder p="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>User</Table.Th>
              <Table.Th>Action</Table.Th>
              <Table.Th>Entity</Table.Th>
              <Table.Th>Details</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entries.map(e => (
              <Table.Tr key={e.id}>
                <Table.Td>{new Date(e.createdAt).toLocaleString()}</Table.Td>
                <Table.Td>{e.userEmail || '—'}</Table.Td>
                <Table.Td>
                  <Badge color={actionColors[e.action] || 'gray'} variant="light" size="sm">
                    {actionLabels[e.action] || e.action}
                  </Badge>
                </Table.Td>
                <Table.Td>{e.entityType ? `${e.entityType}` : '—'}</Table.Td>
                <Table.Td c="dimmed">{e.details || '—'}</Table.Td>
              </Table.Tr>
            ))}
            {entries.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5} ta="center" c="dimmed">No entries found</Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
        {totalPages > 1 && (
          <Group justify="center" mt="md">
            <Pagination value={page} onChange={setPage} total={totalPages} />
          </Group>
        )}
      </Paper>
    </>
  );
}

// ── Danger Zone ────────────────────────────────────────────────────────────

function DangerZone() {
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupStatus, setBackupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [restoreMessage, setRestoreMessage] = useState('');

  const handleFactoryReset = async () => {
    try {
      await authFetchJson('/api/admin/factory-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      localStorage.removeItem('auth_token');
      window.location.reload();
    } catch { /* ignore */ }
  };

  return (
    <>
      <Paper withBorder p="lg" style={{ borderLeft: '3px solid var(--mantine-color-red-5)' }}>
        <Title order={3} c="red" mb="md">Danger Zone</Title>
        <Stack gap="md">
          <Group>
            <Button color="teal" variant="filled" onClick={() => { setBackupPassword(''); setBackupStatus('idle'); setShowBackupModal(true); }}>
              Backup Data
            </Button>
            <Button color="orange" variant="filled" onClick={() => { setRestoreFile(null); setRestorePassword(''); setRestoreStatus('idle'); setRestoreMessage(''); setShowRestoreModal(true); }}>
              Restore from Backup
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            Factory Reset will permanently delete all certificate authorities, certificates, admin account,
            and settings. You will need to go through setup again.
          </Text>
          <div>
            <Button color="red" variant="filled" onClick={() => { setResetConfirmText(''); setShowResetModal(true); }}>
              Factory Reset
            </Button>
          </div>
        </Stack>
      </Paper>

      <Modal opened={showResetModal} onClose={() => setShowResetModal(false)} title="Factory Reset" centered>
        <Stack gap="md">
          <Text size="sm">This action cannot be undone. All data will be permanently deleted.</Text>
          <TextInput label="Type RESET to confirm" placeholder="RESET" value={resetConfirmText} onChange={e => setResetConfirmText(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setShowResetModal(false)}>Cancel</Button>
            <Button color="red" loading={false} disabled={resetConfirmText !== 'RESET'} onClick={handleFactoryReset}>
              Factory Reset
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={showBackupModal} onClose={() => setShowBackupModal(false)} title="Backup Data" centered>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Create an encrypted backup of all your data: certificates, CAs, settings, and encryption keys.
          </Text>
          <PasswordInput label="Backup Password" placeholder="Enter a strong password" value={backupPassword} onChange={e => setBackupPassword(e.currentTarget.value)} />
          {backupStatus === 'success' && <Text c="green" size="sm">Backup downloaded successfully</Text>}
          {backupStatus === 'error' && <Text c="red" size="sm">Failed to create backup</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setShowBackupModal(false)}>Cancel</Button>
            <Button
              color="teal"
              loading={backupStatus === 'loading'}
              disabled={!backupPassword}
              onClick={() => {
                setBackupStatus('loading');
                authFetchDownload('/api/backup/create', { password: backupPassword }, 'glcert-backup.zip')
                  .then(() => setBackupStatus('success'))
                  .catch(() => setBackupStatus('error'));
              }}
            >
              Download Backup
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={showRestoreModal} onClose={() => setShowRestoreModal(false)} title="Restore from Backup" centered>
        <Stack gap="md">
          {restoreStatus !== 'success' ? (
            <>
              <Text size="sm" c="dimmed">
                Restore CAs, certificates, and settings from a backup. Your admin account and encryption keys are preserved.
              </Text>
              <FileInput label="Backup File" placeholder="Select .zip backup file" accept=".zip" value={restoreFile} onChange={setRestoreFile} />
              <PasswordInput label="Backup Password" placeholder="Enter backup password" value={restorePassword} onChange={e => setRestorePassword(e.currentTarget.value)} />
              {restoreStatus === 'error' && <Text c="red" size="sm">{restoreMessage}</Text>}
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setShowRestoreModal(false)}>Cancel</Button>
                <Button
                  color="orange"
                  loading={restoreStatus === 'loading'}
                  disabled={!restoreFile || !restorePassword}
                  onClick={() => {
                    setRestoreStatus('loading');
                    const formData = new FormData();
                    formData.append('backup', restoreFile!);
                    formData.append('password', restorePassword);
                    authFetch('/api/backup/restore', { method: 'POST', body: formData })
                      .then(async res => { if (!res.ok) throw new Error(await res.text()); return res.json(); })
                      .then(data => { setRestoreStatus('success'); setRestoreMessage(data.message); })
                      .catch(err => { setRestoreStatus('error'); setRestoreMessage(err.message || 'Restore failed'); });
                  }}
                >
                  Restore
                </Button>
              </Group>
            </>
          ) : (
            <>
              <Text c="green" fw={500}>{restoreMessage}</Text>
              <Text size="sm" c="dimmed">Data has been imported. The page will refresh to show the updated data.</Text>
              <Group justify="flex-end">
                <Button onClick={() => { window.location.href = '/'; }}>Close</Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

function Administration() {
  return (
    <Stack gap="xl">
      <Title>Administration</Title>
      <Tabs defaultValue="users">
        <Tabs.List>
          <Tabs.Tab value="users">Users</Tabs.Tab>
          <Tabs.Tab value="audit">Audit Log</Tabs.Tab>
          <Tabs.Tab value="danger">Danger Zone</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="users" pt="md">
          <UserManagement />
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          <AuditLogSection />
        </Tabs.Panel>

        <Tabs.Panel value="danger" pt="md">
          <DangerZone />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export default Administration;
