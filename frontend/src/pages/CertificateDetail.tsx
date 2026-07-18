import { Title, Text, Button, Group, Stack, Badge, Divider, ActionIcon, Table, Modal, Center, Loader, SimpleGrid, Paper } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { IconDownload, IconTrash, IconRefresh, IconHistory, IconEye } from '@tabler/icons-react';
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
  commonName: string;
  dnsNames: string[];
  ipAddresses: string[];
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
  const [detailVersion, setDetailVersion] = useState<CertificateVersion | null>(null);

  const { data: cert, isLoading } = useQuery<Certificate>({
    queryKey: ['certificate', id],
    queryFn: () => authFetchJson(`/api/certificates/${id}`),
  });

  const { data: versions = [], isLoading: versionsLoading } = useQuery<CertificateVersion[]>({
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

  if (isLoading) return <Center py={80}><Loader /></Center>;
  if (!cert) return <Text>Certificate not found</Text>;

  const typeColors: Record<string, string> = {
    server: 'blue',
    client: 'green',
    selfsigned: 'orange',
  };

  const detailVersionData = detailVersion ? versions.find(v => v.id === detailVersion.id) ?? detailVersion : null;

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
          <Text fw={500}>Common Name:</Text>
          <Text>{cert.commonName || '—'}</Text>
        </Group>
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
        {cert.dnsNames && cert.dnsNames.length > 0 && (
          <Group>
            <Text fw={500}>DNS Names:</Text>
            <Text>{cert.dnsNames.join(', ')}</Text>
          </Group>
        )}
        {cert.ipAddresses && cert.ipAddresses.length > 0 && (
          <Group>
            <Text fw={500}>IP Addresses:</Text>
            <Text>{cert.ipAddresses.join(', ')}</Text>
          </Group>
        )}
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

      {versionsLoading ? (
        <Center py={40}><Loader size="sm" /></Center>
      ) : versions.length === 0 ? (
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
                      <ActionIcon
                        variant="subtle"
                        color="blue"
                        title="View details"
                        onClick={() => setDetailVersion(v)}
                      >
                        <IconEye size={16} />
                      </ActionIcon>
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

      <Modal
        opened={detailVersionData !== null}
        onClose={() => setDetailVersion(null)}
        title={`Certificate Details — v${detailVersionData?.version}`}
        size="lg"
      >
        {detailVersionData && (
          <Stack gap="md">
            <SimpleGrid cols={2}>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">Version</Text>
                <Text fw={500}>v{detailVersionData.version}</Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">Status</Text>
                <Text fw={500}>
                  {detailVersionData.revoked ? (
                    <Badge color="red">Revoked</Badge>
                  ) : new Date(detailVersionData.expiresAt) < new Date() ? (
                    <Badge color="red">Expired</Badge>
                  ) : detailVersionData.version === cert.currentVersion ? (
                    <Badge color="green">Current</Badge>
                  ) : (
                    <Badge color="gray">Superseded</Badge>
                  )}
                </Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">Public Key Algorithm</Text>
                <Text fw={500}>{detailVersionData.publicKeyAlgorithm}</Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">Signature Algorithm</Text>
                <Text fw={500}>{detailVersionData.signatureAlgorithm}</Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">Issuer</Text>
                <Text fw={500}>{cert.caName || 'Self-Signed'}</Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">Common Name</Text>
                <Text fw={500}>{cert.commonName || '—'}</Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">Serial Number</Text>
                <Text fw={500} size="sm" style={{ wordBreak: 'break-all' }}>{detailVersionData.serialNumber || '—'}</Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">Fingerprint</Text>
                <Text fw={500} size="sm" style={{ wordBreak: 'break-all' }}>{detailVersionData.fingerprint || '—'}</Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">Created</Text>
                <Text fw={500}>{new Date(detailVersionData.createdAt).toLocaleString()}</Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">Expires</Text>
                <Text fw={500}>{new Date(detailVersionData.expiresAt).toLocaleString()}</Text>
              </Paper>
            </SimpleGrid>

            {cert.dnsNames && cert.dnsNames.length > 0 && (
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed" mb={4}>DNS Names</Text>
                <Group gap={4}>
                  {cert.dnsNames.map((name) => (
                    <Badge key={name} variant="light">{name}</Badge>
                  ))}
                </Group>
              </Paper>
            )}

            {cert.ipAddresses && cert.ipAddresses.length > 0 && (
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed" mb={4}>IP Addresses</Text>
                <Group gap={4}>
                  {cert.ipAddresses.map((ip) => (
                    <Badge key={ip} variant="light" color="teal">{ip}</Badge>
                  ))}
                </Group>
              </Paper>
            )}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

export default CertificateDetail;
