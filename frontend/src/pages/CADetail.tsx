import { Title, Text, Button, Group, Stack, Badge, Divider, ActionIcon, Center, Loader, Tooltip, TextInput, Modal } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { IconDownload, IconTrash, IconLink } from '@tabler/icons-react';
import { useState } from 'react';
import { authFetch, authFetchJson, downloadFile } from '../api';

interface CertificateAuthority {
  id: number;
  name: string;
  description: string;
  subject: string;
  createdAt: string;
  expiresAt: string;
  currentVersion: number;
}

function CADetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [shareLinkUrl, setShareLinkUrl] = useState<string | null>(null);

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
    mutationFn: () =>
      authFetchJson<{ token: string; expires_at: string }>(`/api/share/ca/${id}`, { method: 'POST' }),
    onSuccess: (data) => {
      const url = `${window.location.origin}/api/share/${data.token}`;
      setShareLinkUrl(url);
    },
  });

  if (isLoading) return <Center py={80}><Loader /></Center>;
  if (!ca) return <Text>CA not found</Text>;

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
              onClick={() => downloadFile(`/api/ca/${id}/download/cert`, `ca-${id}-cert.pem`)}
            >
              <IconDownload size={20} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Download CA private key">
            <ActionIcon
              variant="subtle"
              onClick={() => downloadFile(`/api/ca/${id}/download/key`, `ca-${id}-key.pem`)}
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
            <ActionIcon variant="subtle" onClick={() => shareMutation.mutate()}>
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
        </Group>
      </Stack>

      <Divider />

      <Group>
        <Button
          variant="default"
          onClick={() => downloadFile(`/api/ca/${id}/download/cert`, `ca-${id}-cert.pem`)}
        >
          Download Certificate
        </Button>
        <Button
          variant="default"
          onClick={() => downloadFile(`/api/ca/${id}/download/key`, `ca-${id}-key.pem`)}
        >
          Download Private Key
        </Button>
        <Button
          variant="filled"
          onClick={() => downloadFile(`/api/ca/${id}/download/bundle`, `ca-${id}-bundle.zip`)}
        >
          Download Bundle (ZIP)
        </Button>
        <Button variant="light" leftSection={<IconLink size={16} />} onClick={() => shareMutation.mutate()}>
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

      <Modal opened={shareLinkUrl !== null} onClose={() => setShareLinkUrl(null)} title="Temporary Share Link">
        <Stack gap="sm">
          <Text size="sm">This link expires in 15 minutes, can only be used once, and requires no authentication.</Text>
          <TextInput
            value={shareLinkUrl || ''}
            readOnly
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <Group justify="flex-end">
            <Button
              variant="light"
              onClick={() => {
                if (shareLinkUrl) navigator.clipboard.writeText(shareLinkUrl);
              }}
            >
              Copy Link
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export default CADetail;
