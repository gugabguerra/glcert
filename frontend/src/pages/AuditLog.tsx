import { useState, useEffect } from 'react';
import { Title, Text, Table, Badge, Group, Select, Pagination, Paper, Skeleton } from '@mantine/core';
import { authFetchJson } from '../api';

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

const actionColors: Record<string, string> = {
  'certificate.create': 'green',
  'certificate.delete': 'red',
  'certificate.regenerate': 'blue',
  'certificate.import': 'cyan',
  'ca.create': 'green',
  'ca.delete': 'red',
  'ca.import': 'cyan',
  'ca.permissions.update': 'yellow',
  'user.create': 'green',
  'user.delete': 'red',
  'user.role_change': 'yellow',
  'settings.update': 'gray',
  'factory_reset': 'red',
  'backup.create': 'blue',
  'backup.restore': 'yellow',
  'auth.login': 'gray',
  'auth.password_change': 'yellow',
};

const actionLabels: Record<string, string> = {
  'certificate.create': 'Cert Created',
  'certificate.delete': 'Cert Deleted',
  'certificate.regenerate': 'Cert Regenerated',
  'certificate.import': 'Cert Imported',
  'ca.create': 'CA Created',
  'ca.delete': 'CA Deleted',
  'ca.import': 'CA Imported',
  'ca.permissions.update': 'CA Permissions Updated',
  'user.create': 'User Created',
  'user.delete': 'User Deleted',
  'user.role_change': 'Role Changed',
  'settings.update': 'Settings Updated',
  'factory_reset': 'Factory Reset',
  'backup.create': 'Backup Created',
  'backup.restore': 'Backup Restored',
  'auth.login': 'Login',
  'auth.password_change': 'Password Changed',
};

function AuditLog() {
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
      .then(data => {
        setEntries(data.entries || []);
        setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, actionFilter]);

  const totalPages = Math.ceil(total / 50);

  if (loading) return <Skeleton height={400} />;

  return (
    <>
      <Group justify="space-between" mb="lg">
        <div>
          <Title order={2}>Audit Log</Title>
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

export default AuditLog;
