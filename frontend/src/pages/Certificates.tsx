import {
  Title,
  Table,
  Button,
  Group,
  Badge,
  ActionIcon,
  Modal,
  Text,
  Stack,
  Box,
  Select,
  Center,
  Loader,
  Tooltip,
  Menu,
} from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { IconTrash, IconPlus, IconDownload, IconLink, IconCertificate, IconUpload, IconShieldCheck } from '@tabler/icons-react';
import { authFetch, authFetchJson, downloadFile } from '../api';
import { sanitizeFilename } from '../utils/clipboard';

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
  groupName: string;
}

interface CertificateAuthority {
  id: string;
  name: string;
  subject: string;
  createdAt: string;
  expiresAt: string;
  currentVersion: number;
  parentCaId?: string | null;
}

interface CertGroup {
  name: string;
  count: number;
}

interface CertTreeNode {
  kind: 'ca' | 'cert';
  id: string;
  name: string;
  prefix: string;
  depth: number;
  children: CertTreeNode[];
  ca?: CertificateAuthority;
  cert?: Certificate;
}

function buildCertTree(cas: CertificateAuthority[], certs: Certificate[]): CertTreeNode[] {
  const caChildrenMap = new Map<string, CertificateAuthority[]>();
  const roots: CertificateAuthority[] = [];
  const certsByCaId = new Map<string, Certificate[]>();
  const orphanCerts: Certificate[] = [];

  for (const ca of cas) {
    if (ca.parentCaId) {
      const siblings = caChildrenMap.get(ca.parentCaId) || [];
      siblings.push(ca);
      caChildrenMap.set(ca.parentCaId, siblings);
    } else {
      roots.push(ca);
    }
  }

  for (const cert of certs) {
    if (cert.certificateAuthorityId) {
      const list = certsByCaId.get(cert.certificateAuthorityId) || [];
      list.push(cert);
      certsByCaId.set(cert.certificateAuthorityId, list);
    } else {
      orphanCerts.push(cert);
    }
  }

  function buildCaNodes(nodes: CertificateAuthority[], depth: number, parentPrefix: string): CertTreeNode[] {
    return nodes.map((ca, i) => {
      const last = i === nodes.length - 1;
      const connector = last ? '└── ' : '├── ';
      const prefix = depth === 0 ? '' : parentPrefix + connector;
      const childPrefix = depth === 0 ? '' : parentPrefix + (last ? '    ' : '│   ');

      const childCAs = caChildrenMap.get(ca.id) || [];
      const caCerts = certsByCaId.get(ca.id) || [];

      const children: CertTreeNode[] = [
        ...buildCaNodes(childCAs, depth + 1, childPrefix),
        ...caCerts.map((cert, j) => {
          const certLast = j === caCerts.length - 1 && childCAs.length === 0;
          const certConnector = certLast ? '└── ' : '├── ';
          return {
            kind: 'cert' as const,
            id: cert.id,
            name: cert.name,
            prefix: childPrefix + certConnector,
            depth: depth + 1,
            children: [],
            cert,
          };
        }),
      ];

      return {
        kind: 'ca' as const,
        id: ca.id,
        name: ca.name,
        prefix,
        depth,
        children,
        ca,
      };
    });
  }

  const caRoots = buildCaNodes(roots, 0, '');

  const orphanNodes: CertTreeNode[] = orphanCerts.map((cert) => ({
    kind: 'cert' as const,
    id: cert.id,
    name: cert.name,
    prefix: '',
    depth: 0,
    children: [],
    cert,
  }));

  return [...caRoots, ...orphanNodes];
}

function CertTreeRow({
  node,
  onDelete,
  isExpired,
  isExpiringSoon,
  bundleMutation,
  bundleMenuId,
  setBundleMenuId,
  navigate,
}: {
  node: CertTreeNode;
  onDelete: (id: string) => void;
  isExpired: (expiresAt: string | null) => boolean;
  isExpiringSoon: (expiresAt: string | null) => boolean;
  bundleMutation: any;
  bundleMenuId: string | null;
  setBundleMenuId: (id: string | null) => void;
  navigate: (path: string) => void;
}) {
  if (node.kind === 'ca') {
    const ca = node.ca!;
    const expExpired = new Date(ca.expiresAt) < new Date();
    const daysLeft = Math.ceil((new Date(ca.expiresAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    const expExpiringSoon = !expExpired && daysLeft <= 30;

    return (
      <>
        <Table.Tr>
          <Table.Td colSpan={4}>
            <span style={{ fontFamily: 'monospace', whiteSpace: 'pre', fontSize: '18px', paddingLeft: '4px' }}>{node.prefix}</span>
            <Box style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'gray', textDecoration: 'none' }}>
              <IconShieldCheck size={16} />
              {ca.name}
            </Box>
            {node.depth > 0 && (
              <Badge color='violet' variant='light' size='xs' ml='xs'>Intermediate</Badge>
            )}
          </Table.Td>
          <Table.Td>v{ca.currentVersion}</Table.Td>
          <Table.Td>{new Date(ca.expiresAt).toLocaleDateString()}</Table.Td>
          <Table.Td>
            {expExpired ? (
              <Badge color='red'>Expired</Badge>
            ) : expExpiringSoon ? (
              <Badge color='yellow'>Expiring Soon</Badge>
            ) : (
              <Badge color='green'>Active</Badge>
            )}
          </Table.Td>
          <Table.Td />
        </Table.Tr>
        {node.children.map((child) => (
          <CertTreeRow
            key={child.id}
            node={child}
            onDelete={onDelete}
            isExpired={isExpired}
            isExpiringSoon={isExpiringSoon}
            bundleMutation={bundleMutation}
            bundleMenuId={bundleMenuId}
            setBundleMenuId={setBundleMenuId}
            navigate={navigate}
          />
        ))}
      </>
    );
  }

  const cert = node.cert!;
  return (
    <Table.Tr>
      <Table.Td colSpan={4}>
        <span style={{ fontFamily: 'monospace', whiteSpace: 'pre', fontSize: '18px', paddingLeft: '4px' }}>{node.prefix}</span>
        <Box component={Link} to={`/certificates/${cert.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--mantine-color-teal-6)', textDecoration: 'none' }}>
          <IconCertificate size={16} />
          {cert.name}
        </Box>
      </Table.Td>
      <Table.Td>v{cert.currentVersion}</Table.Td>
      <Table.Td>
        {cert.expiresAt ? new Date(cert.expiresAt).toLocaleDateString() : '—'}
      </Table.Td>
      <Table.Td>
        {cert.expiresAt &&
          (isExpired(cert.expiresAt) ? (
            <Badge color='red'>Expired</Badge>
          ) : isExpiringSoon(cert.expiresAt) ? (
            <Badge color='yellow'>Expiring Soon</Badge>
          ) : (
            <Badge color='green'>Active</Badge>
          ))}
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
          <Menu shadow='md' width={180} opened={bundleMenuId === cert.id} onChange={(open) => !open && setBundleMenuId(null)}>
            <Menu.Target>
              <Tooltip label='Download bundle'>
                <ActionIcon variant='subtle' onClick={() => setBundleMenuId(cert.id)}>
                  <IconDownload size={16} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => bundleMutation.mutate({ id: cert.id, format: 'zip' })}>
                ZIP (.zip)
              </Menu.Item>
              <Menu.Item onClick={() => bundleMutation.mutate({ id: cert.id, format: 'tgz' })}>
                Tarball (.tar.gz)
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Tooltip label='Temporary share link'>
            <ActionIcon variant='subtle' onClick={() => navigate(`/certificates/${cert.id}`)}>
              <IconLink size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label='Delete certificate'>
            <ActionIcon color='red' variant='subtle' onClick={() => onDelete(cert.id)}>
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

function Certificates() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [bundleMenuId, setBundleMenuId] = useState<string | null>(null);

  const { data: groups = [] } = useQuery<CertGroup[]>({
    queryKey: ['certGroups'],
    queryFn: () => authFetchJson('/api/certificates/groups'),
  });

  const { data: certs = [], isLoading } = useQuery<Certificate[]>({
    queryKey: ['certificates', groupFilter],
    queryFn: () => {
      const url = groupFilter ? `/api/certificates?group=${encodeURIComponent(groupFilter)}` : '/api/certificates';
      return authFetchJson(url);
    },
  });

  const { data: cas = [] } = useQuery<CertificateAuthority[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => authFetch(`/api/certificates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      queryClient.invalidateQueries({ queryKey: ['certGroups'] });
      setDeleteId(null);
    },
  });

  const bundleMutation = useMutation({
    mutationFn: ({ id, format }: { id: string; format: string }) => {
      const cert = certs.find((c) => c.id === id);
      const safeName = sanitizeFilename(cert?.name || 'certificate');
      const ext = format === 'tgz' ? 'tar.gz' : 'zip';
      return downloadFile(
        `/api/certificates/${id}/download/bundle?format=${format}`,
        `${safeName}-bundle.${ext}`,
      );
    },
    onSettled: () => setBundleMenuId(null),
  });

  const isTreeMode = !typeFilter && !groupFilter;

  const filteredCerts = typeFilter ? certs.filter((c) => c.type === typeFilter) : certs;

  const [sortKey, setSortKey] = useState<string>('expires');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const isExpired = (expiresAt: string | null) =>
    expiresAt ? new Date(expiresAt) < new Date() : false;
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
        case 'name':
          aVal = a.name;
          bVal = b.name;
          break;
        case 'type':
          aVal = a.type;
          bVal = b.type;
          break;
        case 'group':
          aVal = a.groupName || '';
          bVal = b.groupName || '';
          break;
        case 'issuer':
          aVal = a.caName || a.caSubject || 'Self-Signed';
          bVal = b.caName || b.caSubject || 'Self-Signed';
          break;
        case 'version':
          aVal = a.currentVersion;
          bVal = b.currentVersion;
          break;
        case 'expires':
          aVal = a.expiresAt ? new Date(a.expiresAt).getTime() : 0;
          bVal = b.expiresAt ? new Date(b.expiresAt).getTime() : 0;
          break;
        case 'status':
          aVal = getStatusPriority(a.expiresAt);
          bVal = getStatusPriority(b.expiresAt);
          break;
        default:
          aVal = a.expiresAt ? new Date(a.expiresAt).getTime() : 0;
          bVal = b.expiresAt ? new Date(b.expiresAt).getTime() : 0;
      }
      const dir = sortDirection === 'asc' ? 1 : -1;
      if (aVal < bVal) return -dir;
      if (aVal > bVal) return dir;
      return 0;
    });
  }, [filteredCerts, sortKey, sortDirection]);

  const tree = useMemo(() => {
    if (!isTreeMode) return [];
    return buildCertTree(cas, certs);
  }, [cas, certs, isTreeMode]);

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
      <Group justify='space-between'>
        <Title>Certificates</Title>
        <Group>
          <Select
            placeholder='Filter by type'
            data={[
              { value: 'server', label: 'Server' },
              { value: 'client', label: 'Client' },
              { value: 'serverclient', label: 'Server + Client' },
              { value: 'selfsigned', label: 'Self-Signed' },
            ]}
            value={typeFilter}
            onChange={setTypeFilter}
            clearable
            w={160}
          />
          {groups.length > 0 && (
            <Select
              placeholder='Filter by group'
              data={groups.map((g) => ({ value: g.name, label: `${g.name} (${g.count})` }))}
              value={groupFilter}
              onChange={setGroupFilter}
              clearable
              w={180}
            />
          )}
          {groupFilter && (
            <Tooltip label='Download all certificates in this group'>
              <ActionIcon variant='light' color='teal' size='lg' onClick={() => {
                const name = encodeURIComponent(groupFilter);
                downloadFile(`/api/certificates/download/group?name=${name}&format=zip`, `${groupFilter}.zip`);
              }}>
                <IconDownload size={20} />
              </ActionIcon>
            </Tooltip>
          )}
          <Button component={Link} to='/certificates/import' variant='light' leftSection={<IconUpload size={16} />}>
            Import
          </Button>
          <Button component={Link} to='/certificates/new' leftSection={<IconPlus size={16} />}>
            New Certificate
          </Button>
        </Group>
      </Group>

      {isLoading ? (
        <Center py={80}>
          <Loader />
        </Center>
      ) : certs.length === 0 ? (
        <Text c='dimmed'>No certificates yet.</Text>
      ) : isTreeMode ? (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Group</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Issuer</Table.Th>
              <Table.Th>Version</Table.Th>
              <Table.Th>Expires</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tree.map((node) => (
              <CertTreeRow
                key={node.id}
                node={node}
                onDelete={(id) => { setDeleteId(id); }}
                isExpired={isExpired}
                isExpiringSoon={isExpiringSoon}
                bundleMutation={bundleMutation}
                bundleMenuId={bundleMenuId}
                setBundleMenuId={setBundleMenuId}
                navigate={navigate}
              />
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>
                Name {sortKey === 'name' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleSort('group')}>
                Group {sortKey === 'group' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
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
                  <Box component={Link} to={`/certificates/${cert.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--mantine-color-teal-6)', textDecoration: 'none' }}>
                      <IconCertificate size={16} />
                      {cert.name}
                  </Box>
                </Table.Td>
                <Table.Td>
                  {cert.groupName ? <Badge variant='light'>{cert.groupName}</Badge> : '—'}
                </Table.Td>
                <Table.Td>
                  <Badge color={typeColors[cert.type] || 'gray'}>{typeLabels[cert.type] || cert.type}</Badge>
                </Table.Td>
                <Table.Td>
                  {cert.caName || cert.caSubject ? (
                    <Group gap={4}>
                      {cert.caName || cert.caSubject}
                      {!cert.caName && cert.caSubject && (
                        <Badge size='xs' color='gray' variant='light'>
                          Orphan
                        </Badge>
                      )}
                    </Group>
                  ) : (
                    'Self-Signed'
                  )}
                </Table.Td>
                <Table.Td>v{cert.currentVersion}</Table.Td>
                <Table.Td>
                  {cert.expiresAt ? new Date(cert.expiresAt).toLocaleDateString() : '—'}
                </Table.Td>
                <Table.Td>
                  {cert.expiresAt &&
                    (isExpired(cert.expiresAt) ? (
                      <Badge color='red'>Expired</Badge>
                    ) : isExpiringSoon(cert.expiresAt) ? (
                      <Badge color='yellow'>Expiring Soon</Badge>
                    ) : (
                      <Badge color='green'>Active</Badge>
                    ))}
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <Menu shadow="md" width={180} opened={bundleMenuId === cert.id} onChange={(open) => !open && setBundleMenuId(null)}>
                      <Menu.Target>
                        <Tooltip label='Download bundle'>
                          <ActionIcon variant='subtle' onClick={() => setBundleMenuId(cert.id)}>
                            <IconDownload size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => bundleMutation.mutate({ id: cert.id, format: 'zip' })}>
                          ZIP (.zip)
                        </Menu.Item>
                        <Menu.Item onClick={() => bundleMutation.mutate({ id: cert.id, format: 'tgz' })}>
                          Tarball (.tar.gz)
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                    <Tooltip label='Temporary share link'>
                      <ActionIcon variant='subtle' onClick={() => navigate(`/certificates/${cert.id}`)}>
                        <IconLink size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label='Delete certificate'>
                      <ActionIcon color='red' variant='subtle' onClick={() => setDeleteId(cert.id)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal
        opened={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title='Delete Certificate'
      >
        <Text>Are you sure you want to delete this certificate?</Text>
        <Group justify='flex-end' mt='md'>
          <Button variant='default' onClick={() => setDeleteId(null)}>
            Cancel
          </Button>
          <Button
            color='red'
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
