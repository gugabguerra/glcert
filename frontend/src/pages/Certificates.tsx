import { Title, Table, Button, Group, Badge, ActionIcon, Modal, Text, Stack, Anchor, Select, Center, Loader, Tooltip } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import { authFetch, authFetchJson } from '../api';

interface Certificate {
  id: string;
  name: string;
  description: string;
  type: string;
  certificateAuthorityId: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  caName: string;
  caSubject: string;
  expiresAt: string | null;
}

function Certificates() {
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const { data: certs = [], isLoading } = useQuery<Certificate[]>({
    queryKey: ['certificates'],
    queryFn: () => authFetchJson('/api/certificates'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => authFetch(`/api/certificates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      setDeleteId(null);
    },
  });

  const filteredCerts = typeFilter
    ? certs.filter((c) => c.type === typeFilter)
    : certs;

  const [sortKey, setSortKey] = useState<string>('expires');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const isExpired = (expiresAt: string | null) => expiresAt ? new Date(expiresAt) < new Date() : false;
  const isExpiringSoon = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    const expiry = new Date(expiresAt);
    const now = new Date();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    return expiry > now && expiry.getTime() - now.getTime() < thirtyDays;
  };

  const getStatusPriority = (expiresAt: string | null) => {
    if (isExpired(expiresAt)) return 2;
    if (isExpiringSoon(expiresAt)) return 1;
    return 0;
  };

  const sortedData = useMemo(() => {
    return [...filteredCerts].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortKey) {
        case 'name': aVal = a.name; bVal = b.name; break;
        case 'type': aVal = a.type; bVal = b.type; break;
        case 'issuer': aVal = a.caName || a.caSubject || 'Self-Signed'; bVal = b.caName || b.caSubject || 'Self-Signed'; break;
        case 'version': aVal = a.currentVersion; bVal = b.currentVersion; break;
        case 'expires': aVal = a.expiresAt ? new Date(a.expiresAt).getTime() : 0; bVal = b.expiresAt ? new Date(b.expiresAt).getTime() : 0; break;
        case 'status': aVal = getStatusPriority(a.expiresAt); bVal = getStatusPriority(b.expiresAt); break;
        default: aVal = a.expiresAt ? new Date(a.expiresAt).getTime() : 0; bVal = b.expiresAt ? new Date(b.expiresAt).getTime() : 0;
      }
      const dir = sortDirection === 'asc' ? 1 : -1;
      if (aVal < bVal) return -dir;
      if (aVal > bVal) return dir;
      return 0;
    });
  }, [filteredCerts, sortKey, sortDirection]);

  const typeColors: Record<string, string> = {
    server: 'blue',
    client: 'green',
    selfsigned: 'orange',
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title>Certificates</Title>
        <Group>
          <Select
            placeholder="Filter by type"
            data={[
              { value: 'server', label: 'Server' },
              { value: 'client', label: 'Client' },
              { value: 'selfsigned', label: 'Self-Signed' },
            ]}
            value={typeFilter}
            onChange={setTypeFilter}
            clearable
            w={160}
          />
          <Button
            component={Link}
            to="/certificates/new"
            leftSection={<IconPlus size={16} />}
          >
            New Certificate
          </Button>
        </Group>
      </Group>

      {isLoading ? (
        <Center py={80}><Loader /></Center>
      ) : filteredCerts.length === 0 ? (
        <Text c="dimmed">No certificates yet.</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>
                Name {sortKey === 'name' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('type')}>
                Type {sortKey === 'type' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('issuer')}>
                Issuer {sortKey === 'issuer' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('version')}>
                Version {sortKey === 'version' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('expires')}>
                Expires {sortKey === 'expires' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('status')}>
                Status {sortKey === 'status' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedData.map((cert) => (
              <Table.Tr key={cert.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/certificates/${cert.id}`}>
                    {cert.name}
                  </Anchor>
                </Table.Td>
                <Table.Td>
                  <Badge color={typeColors[cert.type] || 'gray'}>
                    {cert.type}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {cert.caName || cert.caSubject
                    ? <Group gap={4}>{cert.caName || cert.caSubject}{!cert.caName && cert.caSubject && <Badge size="xs" color="gray" variant="light">External</Badge>}</Group>
                    : 'Self-Signed'
                  }
                </Table.Td>
                <Table.Td>v{cert.currentVersion}</Table.Td>
                <Table.Td>{cert.expiresAt ? new Date(cert.expiresAt).toLocaleDateString() : '—'}</Table.Td>
                <Table.Td>
                  {cert.expiresAt && (
                    isExpired(cert.expiresAt) ? (
                      <Badge color="red">Expired</Badge>
                    ) : isExpiringSoon(cert.expiresAt) ? (
                      <Badge color="yellow">Expiring Soon</Badge>
                    ) : (
                      <Badge color="green">Active</Badge>
                    )
                  )}
                </Table.Td>
                <Table.Td>
                  <Tooltip label="Delete certificate">
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      onClick={() => setDeleteId(cert.id)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={deleteId !== null} onClose={() => setDeleteId(null)} title="Delete Certificate">
        <Text>Are you sure you want to delete this certificate?</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setDeleteId(null)}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={deleteMutation.isPending}
            onClick={() => deleteId && deleteMutation.mutate(deleteId)}
          >
            Delete
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}

export default Certificates;
