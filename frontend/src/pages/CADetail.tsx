import { Title, Text, Button, Group, Stack, Badge, Divider, ActionIcon, Center, Loader, Tooltip, TextInput, Modal, Radio, Menu, Code, Box } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { IconDownload, IconTrash, IconLink, IconClipboard } from '@tabler/icons-react';
import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { authFetch, authFetchJson, downloadFile } from '../api';
import { copyToClipboard, sanitizeFilename } from '../utils/clipboard';

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
}

function CADetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareFileType, setShareFileType] = useState<string>('bundle_zip');
  const [showShareResult, setShowShareResult] = useState(false);
  const [shareResult, setShareResult] = useState<{ url: string; fileType: string } | null>(null);

  const { data: ca, isLoading } = useQuery<CertificateAuthority>({
    queryKey: ['ca', id],
    queryFn: () => authFetchJson(`/api/ca/${id}`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => authFetch(`/api/ca/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cas'] });
      navigate('/ca');
    },
  });

  const shareMutation = useMutation({
    mutationFn: (fileType: string) =>
      authFetchJson<{ token: string; expires_at: string; file_type: string }>(`/api/share/ca/${id}`, {
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
          <Tooltip label="Delete CA">
            <ActionIcon
              color="red"
              variant="subtle"
              onClick={() => setShowDelete(true)}
            >
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
        </Group>
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

      <Modal opened={showShareDialog} onClose={() => setShowShareDialog(false)} title="Create Share Link">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">Select what to share. The link expires in 15 minutes and can only be used once.</Text>
          <Radio.Group value={shareFileType} onChange={setShareFileType}>
            <Stack gap="xs" mt="xs">
              <Radio value="certificate" label="CA Certificate (ca.crt)" />
              <Radio value="key" label="CA Private Key (ca.key)" />
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
            : shareResult.fileType === 'certificate' ? `${safeName}-ca.crt` : `${safeName}-ca.key`;
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

export default CADetail;
