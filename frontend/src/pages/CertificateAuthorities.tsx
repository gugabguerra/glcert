import { Title, Table, Button, Group, Badge, ActionIcon, Modal, Text, Stack, Anchor, Center, Loader } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
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

  const isExpired = (expiresAt: string) => new Date(expiresAt) < new Date();
  const isExpiringSoon = (expiresAt: string) => {
    const expiry = new Date(expiresAt);
    const now = new Date();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    return expiry > now && expiry.getTime() - now.getTime() < thirtyDays;
  };

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
              <Table.Th>Name</Table.Th>
              <Table.Th>Subject</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th>Expires</Table.Th>
              <Table.Th>Version</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {cas.map((ca) => (
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
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    onClick={() => setDeleteId(ca.id)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
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
