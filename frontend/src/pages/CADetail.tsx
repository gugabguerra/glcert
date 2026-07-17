import { Title, Text, Button, Group, Stack, Badge, Divider, ActionIcon } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { IconDownload, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { Modal } from '@mantine/core';
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

  if (isLoading) return <Text>Loading...</Text>;
  if (!ca) return <Text>CA not found</Text>;

  const isExpired = new Date(ca.expiresAt) < new Date();

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title>{ca.name}</Title>
          <Text c="dimmed">{ca.description}</Text>
        </div>
        <Group>
          <ActionIcon
            variant="subtle"
            onClick={() => downloadFile(`/api/ca/${id}/download/cert`, `ca-${id}-cert.pem`)}
          >
            <IconDownload size={20} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            onClick={() => downloadFile(`/api/ca/${id}/download/key`, `ca-${id}-key.pem`)}
          >
            <IconDownload size={20} />
          </ActionIcon>
          <ActionIcon
            color="red"
            variant="subtle"
            onClick={() => setShowDelete(true)}
          >
            <IconTrash size={20} />
          </ActionIcon>
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
    </Stack>
  );
}

export default CADetail;
