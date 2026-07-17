import { Title, Table, Button, Group, Badge, ActionIcon, Modal, Text, Stack, Anchor, Select } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import { authFetch, authFetchJson } from '../api';

interface Certificate {
  id: number;
  name: string;
  description: string;
  type: string;
  certificateAuthorityId: number | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  caName: string;
}

function Certificates() {
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const { data: certs = [], isLoading } = useQuery<Certificate[]>({
    queryKey: ['certificates'],
    queryFn: () => authFetchJson('/api/certificates'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => authFetch(`/api/certificates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      setDeleteId(null);
    },
  });

  const filteredCerts = typeFilter
    ? certs.filter((c) => c.type === typeFilter)
    : certs;

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
        <Text>Loading...</Text>
      ) : filteredCerts.length === 0 ? (
        <Text c="dimmed">No certificates yet.</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Issuer</Table.Th>
              <Table.Th>Version</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filteredCerts.map((cert) => (
              <Table.Tr key={cert.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/certificates/${cert.id}`}>
                    {cert.name}
                  </Anchor>
                </Table.Td>
                <Table.Td>{cert.description}</Table.Td>
                <Table.Td>
                  <Badge color={typeColors[cert.type] || 'gray'}>
                    {cert.type}
                  </Badge>
                </Table.Td>
                <Table.Td>{cert.caName || 'Self-Signed'}</Table.Td>
                <Table.Td>v{cert.currentVersion}</Table.Td>
                <Table.Td>
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    onClick={() => setDeleteId(cert.id)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
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
