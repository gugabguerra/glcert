import { Title, Text, Button, Group, Stack, Badge, Divider, ActionIcon, Table, Modal } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { IconDownload, IconTrash, IconRefresh, IconHistory } from '@tabler/icons-react';
import { useState } from 'react';
import { authFetch, authFetchJson, downloadFile } from '../api';

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

interface CertificateVersion {
  id: number;
  certificateId: number;
  version: number;
  storagePath: string;
  serialNumber: string;
  fingerprint: string;
  signatureAlgorithm: string;
  publicKeyAlgorithm: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
}

function CertificateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [deleteVersionNum, setDeleteVersionNum] = useState<number | null>(null);

  const { data: cert, isLoading } = useQuery<Certificate>({
    queryKey: ['certificate', id],
    queryFn: () => authFetchJson(`/api/certificates/${id}`),
  });

  const { data: versions = [] } = useQuery<CertificateVersion[]>({
    queryKey: ['certificateVersions', id],
    queryFn: () => authFetchJson(`/api/certificates/${id}/versions`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => authFetch(`/api/certificates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      navigate('/certificates');
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () =>
      authFetchJson(`/api/certificates/${id}/regenerate`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate', id] });
      queryClient.invalidateQueries({ queryKey: ['certificateVersions', id] });
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (version: number) =>
      authFetch(`/api/certificates/${id}/versions/${version}/restore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate', id] });
      queryClient.invalidateQueries({ queryKey: ['certificateVersions', id] });
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
    },
  });

  const deleteVersionMutation = useMutation({
    mutationFn: (version: number) =>
      authFetch(`/api/certificates/${id}/versions/${version}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate', id] });
      queryClient.invalidateQueries({ queryKey: ['certificateVersions', id] });
      setDeleteVersionNum(null);
    },
  });

  if (isLoading) return <Text>Loading...</Text>;
  if (!cert) return <Text>Certificate not found</Text>;

  const typeColors: Record<string, string> = {
    server: 'blue',
    client: 'green',
    selfsigned: 'orange',
  };

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Group>
            <Title>{cert.name}</Title>
            <Badge color={typeColors[cert.type] || 'gray'}>{cert.type}</Badge>
          </Group>
          <Text c="dimmed">{cert.description}</Text>
        </div>
        <Group>
          <ActionIcon variant="subtle" onClick={() => downloadFile(`/api/certificates/${id}/download/cert`, `cert-${id}-cert.pem`)}>
            <IconDownload size={20} />
          </ActionIcon>
          <ActionIcon variant="subtle" onClick={() => downloadFile(`/api/certificates/${id}/download/key`, `cert-${id}-key.pem`)}>
            <IconDownload size={20} />
          </ActionIcon>
          {cert.caName && (
            <ActionIcon variant="subtle" onClick={() => downloadFile(`/api/certificates/${id}/download/ca`, `cert-${id}-ca.pem`)}>
              <IconDownload size={20} />
            </ActionIcon>
          )}
          <ActionIcon color="red" variant="subtle" onClick={() => setShowDelete(true)}>
            <IconTrash size={20} />
          </ActionIcon>
        </Group>
      </Group>

      <Divider />

      <Stack gap="xs">
        <Group>
          <Text fw={500}>Issuer:</Text>
          <Text>{cert.caName || 'Self-Signed'}</Text>
        </Group>
        <Group>
          <Text fw={500}>Created:</Text>
          <Text>{new Date(cert.createdAt).toLocaleString()}</Text>
        </Group>
        <Group>
          <Text fw={500}>Current Version:</Text>
          <Text>v{cert.currentVersion}</Text>
        </Group>
      </Stack>

      <Divider />

      <Group justify="space-between">
        <Title order={4}>Version History</Title>
        <Button
          leftSection={<IconRefresh size={16} />}
          variant="light"
          loading={regenerateMutation.isPending}
          onClick={() => regenerateMutation.mutate()}
        >
          Regenerate
        </Button>
      </Group>

      {versions.length === 0 ? (
        <Text c="dimmed">No versions found.</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Version</Table.Th>
              <Table.Th>Algorithm</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th>Expires</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {versions.map((v) => {
              const isCurrent = v.version === cert.currentVersion;
              return (
                <Table.Tr key={v.id}>
                  <Table.Td>v{v.version}</Table.Td>
                  <Table.Td>{v.publicKeyAlgorithm}</Table.Td>
                  <Table.Td>{new Date(v.createdAt).toLocaleDateString()}</Table.Td>
                  <Table.Td>{new Date(v.expiresAt).toLocaleDateString()}</Table.Td>
                  <Table.Td>
                    {v.revoked ? (
                      <Badge color="red">Revoked</Badge>
                    ) : new Date(v.expiresAt) < new Date() ? (
                      <Badge color="red">Expired</Badge>
                    ) : isCurrent ? (
                      <Badge color="green">Current</Badge>
                    ) : (
                      <Badge color="gray">Superseded</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      {!isCurrent && !v.revoked && (
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          title="Restore this version"
                          onClick={() => restoreMutation.mutate(v.version)}
                        >
                          <IconHistory size={16} />
                        </ActionIcon>
                      )}
                      {!isCurrent && versions.length > 1 && (
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          title="Delete this version"
                          onClick={() => setDeleteVersionNum(v.version)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      <Divider />

      <Group>
        <Button variant="default" onClick={() => downloadFile(`/api/certificates/${id}/download/cert`, `cert-${id}-cert.pem`)}>
          Download Certificate (cert.pem)
        </Button>
        <Button variant="default" onClick={() => downloadFile(`/api/certificates/${id}/download/key`, `cert-${id}-key.pem`)}>
          Download Private Key (key.pem)
        </Button>
        {cert.caName && (
          <Button variant="default" onClick={() => downloadFile(`/api/certificates/${id}/download/ca`, `cert-${id}-ca.pem`)}>
            Download CA (ca.pem)
          </Button>
        )}
        <Button variant="filled" onClick={() => downloadFile(`/api/certificates/${id}/download/bundle`, `cert-${id}-bundle.zip`)}>
          Download Bundle (ZIP)
        </Button>
      </Group>

      <Modal opened={showDelete} onClose={() => setShowDelete(false)} title="Delete Certificate">
        <Text>Are you sure? This will delete all versions.</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setShowDelete(false)}>Cancel</Button>
          <Button color="red" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            Delete
          </Button>
        </Group>
      </Modal>

      <Modal opened={deleteVersionNum !== null} onClose={() => setDeleteVersionNum(null)} title="Delete Version">
        <Text>Are you sure you want to delete version {deleteVersionNum}?</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setDeleteVersionNum(null)}>Cancel</Button>
          <Button
            color="red"
            loading={deleteVersionMutation.isPending}
            onClick={() => deleteVersionNum && deleteVersionMutation.mutate(deleteVersionNum)}
          >
            Delete
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}

export default CertificateDetail;
