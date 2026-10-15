import { Title, Text, Button, Group, Stack, Badge, Divider, ActionIcon, Table, Modal, Center, Loader, SimpleGrid, Paper, Tooltip, TextInput, NumberInput, Menu, Combobox, InputBase, useCombobox, CloseButton } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { IconDownload, IconTrash, IconRefresh, IconHistory, IconEye, IconLink, IconCopy } from '@tabler/icons-react';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { authFetch, authFetchJson, downloadFile } from '../api/client';
import { sanitizeFilename } from '../utils/clipboard';
import { ShareLinkDialog } from '../components/ShareLinkDialog';

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
  groupName: string;
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
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [regenerateValidity, setRegenerateValidity] = useState(365);
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');

  const { data: cert, isLoading } = useQuery<Certificate>({
    queryKey: ['certificate', id],
    queryFn: () => authFetchJson(`/api/certificates/${id}`),
  });

  const { data: settings } = useQuery<{ smtpHost: string }>({
    queryKey: ['settings'],
    queryFn: () => authFetchJson('/api/settings'),
  });

  const { data: versions = [], isLoading: versionsLoading } = useQuery<CertificateVersion[]>({
    queryKey: ['certificateVersions', id],
    queryFn: () => authFetchJson(`/api/certificates/${id}/versions`),
  });

  const { data: groups = [] } = useQuery<{ name: string; count: number }[]>({
    queryKey: ['certGroups'],
    queryFn: () => authFetchJson('/api/certificates/groups'),
  });

  const groupCombobox = useCombobox({
    onDropdownClose: () => groupCombobox.resetSelectedOption(),
  });

  const groupNames = groups.map((g) => g.name).filter((n) => n !== '');
  const exactGroupMatch = groupNames.some((name) => name === groupSearch);
  const filteredGroups = exactGroupMatch
    ? groupNames
    : groupNames.filter((name) => name.toLowerCase().includes(groupSearch.toLowerCase().trim()));

  useEffect(() => {
    if (editingGroup) {
      setGroupSearch(cert?.groupName || '');
    }
  }, [editingGroup, cert?.groupName]);

  const clearGroupEdit = useCallback(() => {
    setEditingGroup(false);
    setGroupSearch(cert?.groupName || '');
  }, [cert?.groupName]);

  const updateGroupMutation = useMutation({
    mutationFn: (groupName: string) =>
      authFetchJson(`/api/certificates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate', id] });
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      queryClient.invalidateQueries({ queryKey: ['certGroups'] });
      setEditingGroup(false);
    },
  });

  const updateDescriptionMutation = useMutation({
    mutationFn: (description: string) =>
      authFetchJson(`/api/certificates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName: cert?.groupName || '', description }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate', id] });
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      setEditingDescription(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => authFetch(`/api/certificates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      queryClient.invalidateQueries({ queryKey: ['certGroups'] });
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

  const typeLabels: Record<string, string> = {
    server: 'Server',
    client: 'Client',
    serverclient: 'Server + Client',
    selfsigned: 'Self-Signed',
  };

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Group>
            <Title>{cert.name}</Title>
            <Badge color={typeColors[cert.type] || 'gray'}>{typeLabels[cert.type] || cert.type}</Badge>
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
        {editingDescription ? (
          <Group>
            <Text fw={500}>Description:</Text>
            <TextInput
              size="sm"
              value={descriptionValue}
              onChange={(e) => setDescriptionValue(e.currentTarget.value)}
              onBlur={() => {
                if (descriptionValue !== cert.description) {
                  updateDescriptionMutation.mutate(descriptionValue);
                } else {
                  setEditingDescription(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
                if (e.key === 'Escape') {
                  setDescriptionValue(cert.description || '');
                  setEditingDescription(false);
                }
              }}
              autoFocus
              style={{ width: 300 }}
            />
          </Group>
        ) : (
          <Group>
            <Text fw={500}>Description:</Text>
            <Text
              c={cert.description ? undefined : 'dimmed'}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setDescriptionValue(cert.description || '');
                setEditingDescription(true);
              }}
            >
              {cert.description || 'Click to add'}
            </Text>
          </Group>
        )}
        {editingGroup ? (
          <Group>
            <Text fw={500}>Group:</Text>
            <Combobox
              store={groupCombobox}
              withinPortal
              onOptionSubmit={(val) => {
                const newGroup = val === '$create' ? groupSearch : val;
                updateGroupMutation.mutate(newGroup);
                groupCombobox.closeDropdown();
              }}
            >
              <Combobox.Target>
                <InputBase
                  size="sm"
                  placeholder="e.g., web-servers"
                  rightSection={
                    groupSearch ? (
                      <CloseButton size="sm" onClick={clearGroupEdit} />
                    ) : (
                      <Combobox.Chevron />
                    )
                  }
                  rightSectionPointerEvents="none"
                  value={groupSearch}
                  onChange={(event) => {
                    groupCombobox.openDropdown();
                    groupCombobox.updateSelectedOptionIndex();
                    setGroupSearch(event.currentTarget.value);
                  }}
                  onClick={() => groupCombobox.openDropdown()}
                  onBlur={() => {
                    groupCombobox.closeDropdown();
                    setGroupSearch(cert.groupName || '');
                    setEditingGroup(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      const newGroup = exactGroupMatch ? groupSearch : groupSearch.trim();
                      if (newGroup) {
                        updateGroupMutation.mutate(newGroup);
                      } else {
                        updateGroupMutation.mutate('');
                      }
                    }
                    if (event.key === 'Escape') {
                      clearGroupEdit();
                    }
                  }}
                  style={{ width: 220 }}
                />
              </Combobox.Target>
              <Combobox.Dropdown>
                <Combobox.Options>
                  {filteredGroups.map((name) => (
                    <Combobox.Option value={name} key={name}>
                      {name}
                    </Combobox.Option>
                  ))}
                  {!exactGroupMatch && groupSearch.trim().length > 0 && (
                    <Combobox.Option value="$create">+ Create "{groupSearch}"</Combobox.Option>
                  )}
                </Combobox.Options>
              </Combobox.Dropdown>
            </Combobox>
          </Group>
        ) : (
          <Group>
            <Text fw={500}>Group:</Text>
            {cert.groupName ? (
              <Badge
                variant="light"
                style={{ cursor: 'pointer' }}
                onClick={() => setEditingGroup(true)}
              >
                {cert.groupName}
              </Badge>
            ) : (
              <Badge
                variant="dashed"
                color="gray"
                style={{ cursor: 'pointer' }}
                onClick={() => setEditingGroup(true)}
              >
                + Group
              </Badge>
            )}
          </Group>
        )}
        <Group>
          <Text fw={500}>Issuer:</Text>
          {cert.caName || cert.caSubject
            ? <Text>{cert.caName || cert.caSubject}</Text>
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
                {!cert.caName && cert.caSubject && <Badge color="gray" variant="light">Orphan</Badge>}
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
        <Group>
          <Button
            leftSection={<IconCopy size={16} />}
            variant="light"
            disabled={!cert.caName && !!cert.caSubject}
            onClick={() => {
              const currentVersion = versions.find(v => v.version === cert.currentVersion);
              const params = new URLSearchParams();
              if (cert.commonName) params.set('commonName', cert.commonName);
              if (cert.type) params.set('type', cert.type);
              if (cert.certificateAuthorityId) params.set('caId', cert.certificateAuthorityId);
              if (cert.dnsNames?.length) params.set('dnsNames', JSON.stringify(cert.dnsNames));
              if (cert.ipAddresses?.length) params.set('ipAddresses', JSON.stringify(cert.ipAddresses));
              if (cert.groupName) params.set('groupName', cert.groupName);
              if (currentVersion) {
                if (currentVersion.publicKeyAlgorithm) {
                  const alg = currentVersion.publicKeyAlgorithm.toLowerCase();
                  if (alg.startsWith('rsa')) params.set('keyAlgorithm', 'rsa');
                  else if (alg.startsWith('ecdsa') || alg.startsWith('ec')) params.set('keyAlgorithm', 'ecdsa');
                }
                if (currentVersion.expiresAt && currentVersion.createdAt) {
                  const days = Math.round((new Date(currentVersion.expiresAt).getTime() - new Date(currentVersion.createdAt).getTime()) / 86400000);
                  if (days > 0) params.set('validityDays', String(days));
                }
              }
              navigate(`/certificates/new?${params.toString()}`);
            }}
          >
            Use as template
          </Button>
          <Button
            leftSection={<IconRefresh size={16} />}
            variant="light"
            loading={regenerateMutation.isPending}
            disabled={!cert.caName && !!cert.caSubject}
            onClick={() => setShowRegenerate(true)}
          >
            Regenerate
          </Button>
        </Group>
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

      <ShareLinkDialog
        opened={showShareDialog}
        onClose={() => setShowShareDialog(false)}
        entityType="certificate"
        entityId={id!}
        fileOptions={[
          { value: 'certificate', label: 'Certificate (cert.pem)' },
          { value: 'key', label: 'Private Key (key.pem)' },
          ...(cert.caName ? [{ value: 'ca', label: 'CA Certificate (ca.pem)' }] : []),
          { value: 'bundle_zip', label: 'Bundle (ZIP)' },
          { value: 'bundle_tgz', label: 'Bundle (Tarball)' },
        ]}
        fileNameFor={(fileType) =>
          fileType.includes('bundle')
            ? (fileType.includes('tgz') ? `${safeName}-bundle.tar.gz` : `${safeName}-bundle.zip`)
            : fileType === 'ca' ? `${safeName}-ca.pem` : `${safeName}-${fileType}.pem`
        }
        emailEnabled={!!settings?.smtpHost}
      />
    </Stack>
  );
}

export default CertificateDetail;
