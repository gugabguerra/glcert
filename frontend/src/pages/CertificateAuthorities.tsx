import { Title, Table, Button, Group, Badge, ActionIcon, Modal, Text, Stack, Anchor, Center, Loader, Tooltip } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import { authFetch, authFetchJson } from '../api';

interface CertificateAuthority {
  id: number;
  name: string;
  description: string;
  subject: string;
  createdAt: string;
  expiresAt: string;
  currentVersion: number;
}

function CertificateAuthorities() {
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: cas = [], isLoading } = useQuery<CertificateAuthority[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => authFetch(`/api/ca/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cas'] });
      setDeleteId(null);
    },
  });

  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const isExpired = (expiresAt: string) => new Date(expiresAt) < new Date();
  const isExpiringSoon = (expiresAt: string) => {
    const expiry = new Date(expiresAt);
    const now = new Date();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    return expiry > now && expiry.getTime() - now.getTime() < thirtyDays;
  };

  const getStatusPriority = (expiresAt: string) => {
    if (isExpired(expiresAt)) return 2;
    if (isExpiringSoon(expiresAt)) return 1;
    return 0;
  };

  const sortedData = useMemo(() => {
    return [...cas].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortKey) {
        case 'name': aVal = a.name; bVal = b.name; break;
        case 'subject': aVal = a.subject; bVal = b.subject; break;
        case 'created': aVal = new Date(a.createdAt).getTime(); bVal = new Date(b.createdAt).getTime(); break;
        case 'expires': aVal = new Date(a.expiresAt).getTime(); bVal = new Date(b.expiresAt).getTime(); break;
        case 'version': aVal = a.currentVersion; bVal = b.currentVersion; break;
        case 'status': aVal = getStatusPriority(a.expiresAt); bVal = getStatusPriority(b.expiresAt); break;
        default: aVal = a.name; bVal = b.name;
      }
      const dir = sortDirection === 'asc' ? 1 : -1;
      if (aVal < bVal) return -dir;
      if (aVal > bVal) return dir;
      return 0;
    });
  }, [cas, sortKey, sortDirection]);

  return (
    <Stack>
      <Group justify="space-between">
        <Title>Certificate Authorities</Title>
        <Button
          component={Link}
          to="/ca/new"
          leftSection={<IconPlus size={16} />}
        >
          New CA
        </Button>
      </Group>

      {isLoading ? (
        <Center py={80}><Loader /></Center>
      ) : cas.length === 0 ? (
        <Text c="dimmed">No certificate authorities yet. Create one to get started.</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>
                Name {sortKey === 'name' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('subject')}>
                Subject {sortKey === 'subject' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('created')}>
                Created {sortKey === 'created' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('expires')}>
                Expires {sortKey === 'expires' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('version')}>
                Version {sortKey === 'version' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('status')}>
                Status {sortKey === 'status' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedData.map((ca) => (
              <Table.Tr key={ca.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/ca/${ca.id}`}>
                    {ca.name}
                  </Anchor>
                </Table.Td>
                <Table.Td>{ca.subject}</Table.Td>
                <Table.Td>{new Date(ca.createdAt).toLocaleDateString()}</Table.Td>
                <Table.Td>{new Date(ca.expiresAt).toLocaleDateString()}</Table.Td>
                <Table.Td>v{ca.currentVersion}</Table.Td>
                <Table.Td>
                  {isExpired(ca.expiresAt) ? (
                    <Badge color="red">Expired</Badge>
                  ) : isExpiringSoon(ca.expiresAt) ? (
                    <Badge color="yellow">Expiring Soon</Badge>
                  ) : (
                    <Badge color="green">Active</Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Tooltip label="Delete certificate authority">
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      onClick={() => setDeleteId(ca.id)}
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

      <Modal opened={deleteId !== null} onClose={() => setDeleteId(null)} title="Delete CA">
        <Text>Are you sure you want to delete this certificate authority?</Text>
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

export default CertificateAuthorities;
