import { Title, Table, Button, Group, Badge, ActionIcon, Modal, Text, Stack, Anchor, Center, Loader, Tooltip } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { IconTrash, IconPlus, IconUpload } from '@tabler/icons-react';
import { authFetch, authFetchJson } from '../api';

interface CertificateAuthority {
  id: string;
  name: string;
  description: string;
  subject: string;
  createdAt: string;
  expiresAt: string;
  currentVersion: number;
  parentCaId?: string | null;
}

interface TreeNode {
  ca: CertificateAuthority;
  children: TreeNode[];
  depth: number;
  prefix: string;
}

function buildTree(cas: CertificateAuthority[]): TreeNode[] {
  const byId = new Map<string, CertificateAuthority>();
  const childrenMap = new Map<string, CertificateAuthority[]>();
  const roots: CertificateAuthority[] = [];

  for (const ca of cas) {
    byId.set(ca.id, ca);
    if (ca.parentCaId) {
      const siblings = childrenMap.get(ca.parentCaId) || [];
      siblings.push(ca);
      childrenMap.set(ca.parentCaId, siblings);
    } else {
      roots.push(ca);
    }
  }

  function buildNodes(nodes: CertificateAuthority[], depth: number, parentPrefix: string): TreeNode[] {
    return nodes.map((ca, i) => {
      const last = i === nodes.length - 1;
      const connector = last ? '└── ' : '├── ';
      const prefix = depth === 0 ? '' : parentPrefix + connector;
      const childPrefix = depth === 0 ? '' : parentPrefix + (last ? '    ' : '│   ');
      const children = childrenMap.get(ca.id) || [];
      return {
        ca,
        children: buildNodes(children, depth + 1, childPrefix),
        depth,
        prefix,
      };
    });
  }

  return buildNodes(roots, 0, '');
}

function TreeRow({ node, onDelete }: { node: TreeNode; onDelete: (id: string) => void }) {
  const isExpired = new Date(node.ca.expiresAt) < new Date();
  const daysLeft = Math.ceil((new Date(node.ca.expiresAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  const isExpiringSoon = !isExpired && daysLeft <= 30;

  return (
    <>
      <Table.Tr>
        <Table.Td>
          <Anchor component={Link} to={`/ca/${node.ca.id}`}>
            <span style={{ fontFamily: 'monospace', whiteSpace: 'pre' }}>{node.prefix}</span>
            {node.ca.name}
          </Anchor>
          {node.depth > 0 && (
            <Badge color="violet" variant="light" size="xs" ml="xs">Intermediate</Badge>
          )}
        </Table.Td>
        <Table.Td>{node.ca.subject}</Table.Td>
        <Table.Td>{new Date(node.ca.createdAt).toLocaleDateString()}</Table.Td>
        <Table.Td>{new Date(node.ca.expiresAt).toLocaleDateString()}</Table.Td>
        <Table.Td>v{node.ca.currentVersion}</Table.Td>
        <Table.Td>
          {isExpired ? (
            <Badge color="red">Expired</Badge>
          ) : isExpiringSoon ? (
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
              onClick={() => onDelete(node.ca.id)}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Table.Td>
      </Table.Tr>
      {node.children.map((child) => (
        <TreeRow key={child.ca.id} node={child} onDelete={onDelete} />
      ))}
    </>
  );
}

function CertificateAuthorities() {
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: cas = [], isLoading } = useQuery<CertificateAuthority[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => authFetch(`/api/ca/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cas'] });
      setDeleteId(null);
    },
    onError: () => {
      alert('Failed to delete CA');
    },
  });

  const tree = useMemo(() => buildTree(cas), [cas]);

  return (
    <Stack>
      <Group justify="space-between">
        <Title>Certificate Authorities</Title>
        <Group>
          <Button
            component={Link}
            to="/ca/import"
            variant="default"
            leftSection={<IconUpload size={16} />}
          >
            Import CA
          </Button>
          <Button
            component={Link}
            to="/ca/new"
            leftSection={<IconPlus size={16} />}
          >
            New CA
          </Button>
        </Group>
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
            {tree.map((node) => (
              <TreeRow key={node.ca.id} node={node} onDelete={(id) => setDeleteId(id)} />
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
