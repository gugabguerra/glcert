import { Title, Text, Button, Group, Stack, Badge, Divider, ActionIcon, Center, Loader, Tooltip, Modal, Menu, Anchor, Checkbox } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { IconDownload, IconTrash, IconLink } from '@tabler/icons-react';
import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { authFetch, authFetchJson, downloadFile } from '../api/client';
import { sanitizeFilename } from '../utils/clipboard';
import { useAuth } from '../hooks/useAuth';
import { ShareLinkDialog } from '../components/ShareLinkDialog';

interface CertificateAuthority {
  id: string;
  name: string;
  description: string;
  subject: string;
  createdAt: string;
  expiresAt: string;
  currentVersion: number;
  hasPassphrase: boolean;
  imported: boolean;
  parentCaId?: string | null;
  parentCaName?: string | null;
}

function CADetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const [showDelete, setShowDelete] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);

  const { data: ca, isLoading } = useQuery<CertificateAuthority>({
    queryKey: ['ca', id],
    queryFn: () => authFetchJson(`/api/ca/${id}`),
  });

  const { data: settings } = useQuery<{ smtpHost: string }>({
    queryKey: ['settings'],
    queryFn: () => authFetchJson('/api/settings'),
  });

  const { data: users } = useQuery<Array<{ id: string; name: string; email: string; role: string }>>({
    queryKey: ['users'],
    queryFn: () => authFetchJson('/api/users'),
    enabled: isAdmin,
  });

  const { data: permissions } = useQuery<{ caId: string; userIds: string[] }>({
    queryKey: ['caPermissions', id],
    queryFn: () => authFetchJson(`/api/ca/${id}/permissions`),
    enabled: isAdmin,
  });

  const permissionsMutation = useMutation({
    mutationFn: (userIds: string[]) =>
      authFetchJson(`/api/ca/${id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caPermissions', id] });
      notifications.show({ message: 'Permissions updated', color: 'teal' });
    },
    onError: () => {
      notifications.show({ message: 'Failed to update permissions', color: 'red' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => authFetch(`/api/ca/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cas'] });
      navigate('/ca');
    },
    onError: () => {
      notifications.show({ message: 'Failed to delete CA', color: 'red' });
      setShowDelete(false);
    },
  });

  if (isLoading) return <Center py={80}><Loader /></Center>;
  if (!ca) return <Text>CA not found</Text>;

  const safeName = sanitizeFilename(ca.name);

  const isExpired = new Date(ca.expiresAt) < new Date();
  const daysLeft = Math.ceil((new Date(ca.expiresAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  const isExpiringSoon = !isExpired && daysLeft <= 30;

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title>{ca.name}</Title>
          <Text c="dimmed">{ca.description}</Text>
        </div>
        <Group>
          <Tooltip label="Download CA certificate">
            <ActionIcon
              variant="subtle"
              onClick={() => downloadFile(`/api/ca/${id}/download/cert`, `${safeName}-ca.crt`)}
            >
              <IconDownload size={20} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Download CA private key">
            <ActionIcon
              variant="subtle"
              onClick={() => downloadFile(`/api/ca/${id}/download/key`, `${safeName}-ca.key`)}
            >
              <IconDownload size={20} />
            </ActionIcon>
          </Tooltip>
          {isAdmin && (
            <Tooltip label="Delete CA">
              <ActionIcon
                color="red"
                variant="subtle"
                onClick={() => setShowDelete(true)}
              >
                <IconTrash size={20} />
              </ActionIcon>
            </Tooltip>
          )}
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
          <Text fw={500}>Subject:</Text>
          <Text>{ca.subject}</Text>
        </Group>
        <Group>
          <Text fw={500}>Created:</Text>
          <Text>{new Date(ca.createdAt).toLocaleString()}</Text>
        </Group>
        <Group>
          <Text fw={500}>Expires:</Text>
          <Text>{new Date(ca.expiresAt).toLocaleString()}</Text>
        </Group>
        <Group>
          <Text fw={500}>Version:</Text>
          <Text>v{ca.currentVersion}</Text>
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
          {ca.hasPassphrase && (
            <Badge color="blue" variant="light">Passphrase-protected</Badge>
          )}
          {ca.imported && (
            <Badge color="violet" variant="light">Imported</Badge>
          )}
          {ca.parentCaId && (
            <Badge color="blue" variant="light">Intermediate CA</Badge>
          )}
        </Group>
        {ca.parentCaId && (
          <Group>
            <Text fw={500}>Parent CA:</Text>
            <Anchor component={Link} to={`/ca/${ca.parentCaId}`}>
              {ca.parentCaName || 'Unknown'}
            </Anchor>
          </Group>
        )}
      </Stack>

      <Divider />

      <Group>
        <Button
          variant="default"
          onClick={() => downloadFile(`/api/ca/${id}/download/cert`, `${safeName}-ca.crt`)}
        >
          Download Certificate
        </Button>
        <Button
          variant="default"
          onClick={() => downloadFile(`/api/ca/${id}/download/key`, `${safeName}-ca.key`)}
        >
          Download Private Key
        </Button>
        <Menu shadow="md" width={200}>
          <Menu.Target>
            <Button variant="filled" leftSection={<IconDownload size={16} />}>
              Download Bundle
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => downloadFile(`/api/ca/${id}/download/bundle?format=zip`, `${safeName}-bundle.zip`)}>
              ZIP (.zip)
            </Menu.Item>
            <Menu.Item onClick={() => downloadFile(`/api/ca/${id}/download/bundle?format=tgz`, `${safeName}-bundle.tar.gz`)}>
              Tarball (.tar.gz)
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <Button variant="light" leftSection={<IconLink size={16} />} onClick={() => setShowShareDialog(true)}>
          Temporary Link
        </Button>
      </Group>

      {isAdmin && users && permissions && (
        <>
          <Divider />
          <Title order={4}>Access Control</Title>
          <Text size="sm" c="dimmed">Control which users can access this CA and create certificates under it.</Text>
          <Stack gap="xs" mt="xs">
            {users.filter(u => u.role !== 'admin').map(u => (
              <Checkbox
                key={u.id}
                label={`${u.name || u.email} (${u.role})`}
                checked={permissions.userIds.includes(u.id)}
                onChange={(e) => {
                  const newUserIds = e.currentTarget.checked
                    ? [...permissions.userIds, u.id]
                    : permissions.userIds.filter(id => id !== u.id);
                  permissionsMutation.mutate(newUserIds);
                }}
              />
            ))}
            {users.filter(u => u.role !== 'admin').length === 0 && (
              <Text size="sm" c="dimmed">No non-admin users to assign.</Text>
            )}
          </Stack>
        </>
      )}

      <Modal opened={showDelete} onClose={() => setShowDelete(false)} title="Delete CA">
        <Text>Are you sure you want to delete this CA?</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setShowDelete(false)}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            Delete
          </Button>
        </Group>
      </Modal>

      <ShareLinkDialog
        opened={showShareDialog}
        onClose={() => setShowShareDialog(false)}
        entityType="ca"
        entityId={id!}
        fileOptions={[
          { value: 'certificate', label: 'CA Certificate (ca.crt)' },
          { value: 'key', label: 'CA Private Key (ca.key)' },
          { value: 'bundle_zip', label: 'Bundle (ZIP)' },
          { value: 'bundle_tgz', label: 'Bundle (Tarball)' },
        ]}
        fileNameFor={(fileType) =>
          fileType.includes('bundle')
            ? (fileType.includes('tgz') ? `${safeName}-bundle.tar.gz` : `${safeName}-bundle.zip`)
            : fileType === 'certificate' ? `${safeName}-ca.crt` : `${safeName}-ca.key`
        }
        emailEnabled={!!settings?.smtpHost}
      />
    </Stack>
  );
}

export default CADetail;
