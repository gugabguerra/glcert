import { useState, useEffect } from 'react';
import { Title, Text, Button, Table, Badge, Group, Modal, TextInput, Select, Stack, ActionIcon, Tooltip, Paper, Skeleton } from '@mantine/core';
import { IconPlus, IconTrash, IconEdit } from '@tabler/icons-react';
import { authFetch, authFetchJson } from '../api';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  totpEnabled: boolean;
  createdAt: string;
}

const roleColors: Record<string, string> = { admin: 'red', operator: 'blue', viewer: 'green' };

function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpened, setCreateOpened] = useState(false);
  const [editOpened, setEditOpened] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [editRole, setEditRole] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadUsers = async () => {
    try {
      const data = await authFetchJson<User[]>('/api/users');
      setUsers(data);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const handleCreate = async () => {
    setError('');
    setSubmitting(true);
    try {
      await authFetchJson('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, email: newEmail, password: newPassword, role: newRole }),
      });
      setCreateOpened(false);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('viewer');
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
          <Title order={2}>Users</Title>
          <Text c="dimmed" size="sm">Manage user accounts and roles</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpened(true)}>
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
                    <Tooltip label="Edit role">
                      <ActionIcon variant="subtle" size="sm" onClick={() => { setEditUser(u); setEditRole(u.role); setEditOpened(true); setError(''); }}>
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

      <Modal opened={createOpened} onClose={() => setCreateOpened(false)} title="Create User">
        <Stack gap="md">
          <TextInput label="Name" value={newName} onChange={e => setNewName(e.currentTarget.value)} />
          <TextInput label="Email" type="email" value={newEmail} onChange={e => setNewEmail(e.currentTarget.value)} required />
          <TextInput label="Password" type="password" value={newPassword} onChange={e => setNewPassword(e.currentTarget.value)} required />
          <Select
            label="Role"
            value={newRole}
            onChange={v => setNewRole(v || 'viewer')}
            data={[
              { value: 'admin', label: 'Admin' },
              { value: 'operator', label: 'Operator' },
              { value: 'viewer', label: 'Viewer' },
            ]}
          />
          {error && <Text c="red" size="sm">{error}</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOpened(false)}>Cancel</Button>
            <Button loading={submitting} onClick={handleCreate} disabled={!newEmail || !newPassword}>Create</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={editOpened} onClose={() => setEditOpened(false)} title={`Edit ${editUser?.email}`}>
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
          {error && <Text c="red" size="sm">{error}</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditOpened(false)}>Cancel</Button>
            <Button loading={submitting} onClick={handleUpdateRole}>Save</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export default Users;
