import { Title, Text, Button, Group, Stack, Badge, Divider, ActionIcon, Table, Modal, Center, Loader, SimpleGrid, Paper, Tooltip, TextInput, NumberInput, Radio, Menu, Code, Box } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { IconDownload, IconTrash, IconRefresh, IconHistory, IconEye, IconLink, IconClipboard } from '@tabler/icons-react';
import { useState, useMemo } from 'react';
import { notifications } from '@mantine/notifications';
import { authFetch, authFetchJson, downloadFile } from '../api';
import { copyToClipboard, sanitizeFilename } from '../utils/clipboard';

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
  commonName: string;
  dnsNames: string[];
  ipAddresses: string[];
}

interface CertificateVersion {
  id: string;
  certificateId: string;
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
  const [sortKey, setSortKey] = useState<string>('version');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareFileType, setShareFileType] = useState<string>('bundle_zip');
  const [showShareResult, setShowShareResult] = useState(false);
  const [shareResult, setShareResult] = useState<{ url: string; fileType: string } | null>(null);
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [regenerateValidity, setRegenerateValidity] = useState(365);

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
      authFetch(`/api/certificates/${id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validityDays: regenerateValidity }),
      }),
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

  const shareMutation = useMutation({
    mutationFn: (fileType: string) =>
      authFetchJson<{ token: string; expires_at: string; file_type: string }>(`/api/share/certificate/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileType }),
      }),
    onSuccess: (data) => {
      const url = `${window.location.origin}/api/share/${data.token}`;
      setShareResult({ url, fileType: data.file_type });
      setShowShareResult(true);
    },
  });

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const sortedVersions = useMemo(() => {
    return [...versions].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortKey) {
        case 'version': aVal = a.version; bVal = b.version; break;
        case 'algorithm': aVal = a.publicKeyAlgorithm; bVal = b.publicKeyAlgorithm; break;
        case 'created': aVal = new Date(a.createdAt).getTime(); bVal = new Date(b.createdAt).getTime(); break;
        case 'expires': aVal = new Date(a.expiresAt).getTime(); bVal = new Date(b.expiresAt).getTime(); break;
        case 'status':
          const statusPriority = (v: CertificateVersion) => {
            if (v.revoked) return 3;
            if (new Date(v.expiresAt) < new Date()) return 2;
            if (v.version === cert?.currentVersion) return 0;
            return 1;
          };
          aVal = statusPriority(a); bVal = statusPriority(b); break;
        default: aVal = a.version; bVal = b.version;
      }
      const dir = sortDirection === 'asc' ? 1 : -1;
      if (aVal < bVal) return -dir;
      if (aVal > bVal) return dir;
      return 0;
    });
  }, [versions, sortKey, sortDirection, cert?.currentVersion]);

  const detailVersionData = detailVersion ? versions.find(v => v.id === detailVersion.id) ?? detailVersion : null;

  if (isLoading) return <Center py={80}><Loader /></Center>;
  if (!cert) return <Text>Certificate not found</Text>;

  const safeName = sanitizeFilename(cert.name);

  const typeColors: Record<string, string> = {
    server: 'blue',
    client: 'green',
    serverclient: 'purple',
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
          <Tooltip label="Download certificate">
            <ActionIcon variant="subtle" onClick={() => downloadFile(`/api/certificates/${id}/download/cert`, `${safeName}-cert.pem`)}>
              <IconDownload size={20} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Download private key">
            <ActionIcon variant="subtle" onClick={() => downloadFile(`/api/certificates/${id}/download/key`, `${safeName}-key.pem`)}>
              <IconDownload size={20} />
            </ActionIcon>
          </Tooltip>
          {cert.caName && (
            <Tooltip label="Download CA certificate">
              <ActionIcon variant="subtle" onClick={() => downloadFile(`/api/certificates/${id}/download/ca`, `${safeName}-ca.pem`)}>
                <IconDownload size={20} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label="Delete certificate">
            <ActionIcon color="red" variant="subtle" onClick={() => setShowDelete(true)}>
              <IconTrash size={20} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Temporary share link">
            <ActionIcon variant="subtle" onClick={() => setShowShareDialog(true)}>
              <IconLink size={20} />
            </ActionIcon>
          </Tooltip>
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
          {cert.caName || cert.caSubject
            ? <Group gap={4}>{cert.caName || cert.caSubject}{!cert.caName && cert.caSubject && <Badge size="xs" color="gray" variant="light">External</Badge>}</Group>
            : <Text>Self-Signed</Text>
          }
        </Group>
        <Group>
          <Text fw={500}>Created:</Text>
          <Text>{new Date(cert.createdAt).toLocaleString()}</Text>
        </Group>
        {(() => {
          const currentVersion = versions.find(v => v.version === cert.currentVersion);
          if (!currentVersion) return null;
          const expiresAt = new Date(currentVersion.expiresAt);
          const now = new Date();
          const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          const isExpired = expiresAt < now;
          const isExpiringSoon = !isExpired && daysLeft <= 30;
          return (
            <>
              <Group>
                <Text fw={500}>Expires:</Text>
                <Text>{expiresAt.toLocaleString()}</Text>
              </Group>
              <Group>
                <Text fw={500}>Status:</Text>
                {isExpired ? (
                  <Badge color="red">Expired</Badge>
                ) : isExpiringSoon ? (
                  <Badge color="yellow">Expiring Soon</Badge>
                ) : (
                  <Badge color="green">Active</Badge>
                )}
              </Group>
            </>
          );
        })()}
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
          onClick={() => setShowRegenerate(true)}
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
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('version')}>
                Version {sortKey === 'version' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('algorithm')}>
                Algorithm {sortKey === 'algorithm' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('created')}>
                Created {sortKey === 'created' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
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
            {sortedVersions.map((v) => {
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
                      <Tooltip label="View details">
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          onClick={() => setDetailVersion(v)}
                        >
                          <IconEye size={16} />
                        </ActionIcon>
                      </Tooltip>
                      {!isCurrent && !v.revoked && (
                        <Tooltip label="Restore version">
                          <ActionIcon
                            variant="subtle"
                            color="blue"
                            onClick={() => restoreMutation.mutate(v.version)}
                          >
                            <IconHistory size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {!isCurrent && versions.length > 1 && (
                        <Tooltip label="Delete version">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() => setDeleteVersionNum(v.version)}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
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
        <Button variant="default" onClick={() => downloadFile(`/api/certificates/${id}/download/cert`, `${safeName}-cert.pem`)}>
          Download Certificate (cert.pem)
        </Button>
        <Button variant="default" onClick={() => downloadFile(`/api/certificates/${id}/download/key`, `${safeName}-key.pem`)}>
          Download Private Key (key.pem)
        </Button>
        {cert.caName && (
          <Button variant="default" onClick={() => downloadFile(`/api/certificates/${id}/download/ca`, `${safeName}-ca.pem`)}>
            Download CA (ca.pem)
          </Button>
        )}
        <Menu shadow="md" width={200}>
          <Menu.Target>
            <Button variant="filled" leftSection={<IconDownload size={16} />}>
              Download Bundle
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => downloadFile(`/api/certificates/${id}/download/bundle?format=zip`, `${safeName}-bundle.zip`)}>
              ZIP (.zip)
            </Menu.Item>
            <Menu.Item onClick={() => downloadFile(`/api/certificates/${id}/download/bundle?format=tgz`, `${safeName}-bundle.tar.gz`)}>
              Tarball (.tar.gz)
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <Button variant="light" leftSection={<IconLink size={16} />} onClick={() => setShowShareDialog(true)}>
          Temporary Link
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

      <Modal opened={showRegenerate} onClose={() => setShowRegenerate(false)} title="Regenerate Certificate">
        <Text mb="md">This will create a new version of this certificate. The current version will be superseded.</Text>
        <NumberInput
          label="Validity (days)"
          min={1}
          max={3650}
          value={regenerateValidity}
          onChange={(value) => setRegenerateValidity(Number(value) || 365)}
        />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setShowRegenerate(false)}>Cancel</Button>
          <Button
            loading={regenerateMutation.isPending}
            onClick={() => {
              regenerateMutation.mutate();
              setShowRegenerate(false);
            }}
          >
            Regenerate
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
                {cert.caName || cert.caSubject
                  ? <Group gap={4}><Text fw={500}>{cert.caName || cert.caSubject}</Text>{!cert.caName && cert.caSubject && <Badge size="xs" color="gray" variant="light">External</Badge>}</Group>
                  : <Text fw={500}>Self-Signed</Text>
                }
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

      <Modal opened={showShareDialog} onClose={() => setShowShareDialog(false)} title="Create Share Link">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">Select what to share. The link expires in 15 minutes and can only be used once.</Text>
          <Radio.Group value={shareFileType} onChange={setShareFileType}>
            <Stack gap="xs" mt="xs">
              <Radio value="certificate" label="Certificate (cert.pem)" />
              <Radio value="key" label="Private Key (key.pem)" />
              {cert.caName && <Radio value="ca" label="CA Certificate (ca.pem)" />}
              <Radio value="bundle_zip" label="Bundle (ZIP)" />
              <Radio value="bundle_tgz" label="Bundle (Tarball)" />
            </Stack>
          </Radio.Group>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setShowShareDialog(false)}>Cancel</Button>
            <Button loading={shareMutation.isPending} onClick={() => shareMutation.mutate(shareFileType)}>
              Generate Link
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={showShareResult} onClose={() => { setShowShareResult(false); setShareResult(null); }} title="Share Link Ready" size="lg">
        {shareResult && (() => {
          const dlName = shareResult.fileType.includes('bundle')
            ? (shareResult.fileType.includes('tgz') ? `${safeName}-bundle.tar.gz` : `${safeName}-bundle.zip`)
            : shareResult.fileType === 'ca' ? `${safeName}-ca.pem` : `${safeName}-${shareResult.fileType}.pem`;
          const closeAll = () => { setShowShareResult(false); setShareResult(null); setShowShareDialog(false); };
          return (
            <Stack gap="md">
              <TextInput
                value={shareResult.url}
                readOnly
                onClick={(e) => (e.target as HTMLInputElement).select()}
                rightSection={
                  <ActionIcon variant="subtle" color="teal" onClick={async () => {
                    const ok = await copyToClipboard(shareResult.url);
                    notifications.show({ message: ok ? 'URL copied!' : 'Failed to copy', color: ok ? 'teal' : 'red' });
                    if (ok) closeAll();
                  }}>
                    <IconClipboard size={16} />
                  </ActionIcon>
                }
              />
              <Box>
                <Text size="xs" c="dimmed" mb={4}>wget command</Text>
                <Group gap="xs">
                  <Code flex={1} p="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {`wget -O ${dlName} "${shareResult.url}"`}
                  </Code>
                  <ActionIcon variant="subtle" color="teal" onClick={async () => {
                    const cmd = `wget -O ${dlName} "${shareResult.url}"`;
                    const ok = await copyToClipboard(cmd);
                    notifications.show({ message: ok ? 'wget command copied!' : 'Failed to copy', color: ok ? 'teal' : 'red' });
                    if (ok) closeAll();
                  }}>
                    <IconClipboard size={16} />
                  </ActionIcon>
                </Group>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" mb={4}>curl command</Text>
                <Group gap="xs">
                  <Code flex={1} p="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {`curl -L -o ${dlName} "${shareResult.url}"`}
                  </Code>
                  <ActionIcon variant="subtle" color="teal" onClick={async () => {
                    const cmd = `curl -L -o ${dlName} "${shareResult.url}"`;
                    const ok = await copyToClipboard(cmd);
                    notifications.show({ message: ok ? 'curl command copied!' : 'Failed to copy', color: ok ? 'teal' : 'red' });
                    if (ok) closeAll();
                  }}>
                    <IconClipboard size={16} />
                  </ActionIcon>
                </Group>
              </Box>
              <Text size="xs" c="dimmed">This link expires in 15 minutes, can only be used once, and requires no authentication.</Text>
            </Stack>
          );
        })()}
      </Modal>
    </Stack>
  );
}

export default CertificateDetail;
