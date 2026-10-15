import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Text, TextInput, Textarea, Button, Stack, Group, FileInput, Paper, PasswordInput,
} from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetchJson } from '../api/client';

function ImportCA() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [certPEM, setCertPEM] = useState('');
  const [keyPEM, setKeyPEM] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');

  const handleFileRead = (file: File | null, setter: (val: string) => void) => {
    if (!file) {
      setter('');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setter(e.target?.result as string);
    };
    reader.readAsText(file);
  };

  const mutation = useMutation({
    mutationFn: () =>
      authFetchJson<{ id: string }>('/api/ca/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          certPem: certPEM,
          keyPem: keyPEM,
          passphrase,
        }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cas'] });
      navigate(`/ca/${data.id}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Import failed. Check that the certificate is a valid CA.');
    },
  });

  const handleSubmit = () => {
    setError('');
    if (!name.trim()) return setError('Name is required');
    if (!certPEM.trim()) return setError('Certificate file is required');
    if (!keyPEM.trim()) return setError('Private key file is required');
    mutation.mutate();
  };

  return (
    <Stack>
      <Title>Import Certificate Authority</Title>
      <Text c="dimmed">
        Import a CA certificate generated externally. Encrypted private keys are supported.
      </Text>

      <Paper withBorder p="md">
        <Stack gap="md">
          <TextInput
            label="Name"
            placeholder="External CA"
            description="A friendly name for this CA (used as directory name)"
            required
            value={name}
            onChange={e => setName(e.currentTarget.value)}
           
          />
          <Textarea
            label="Description"
            placeholder="Optional description"
            value={description}
            onChange={e => setDescription(e.currentTarget.value)}
           
          />
          <FileInput
            label="CA Certificate"
            placeholder="Select ca.crt file"
            accept=".crt,.pem,.cer"
            required
            value={certFile}
            onChange={(file) => {
              setCertFile(file);
              handleFileRead(file, setCertPEM);
            }}
          />
          <FileInput
            label="CA Private Key"
            placeholder="Select ca.key file"
            accept=".key,.pem"
            required
            value={keyFile}
            onChange={(file) => {
              setKeyFile(file);
              handleFileRead(file, setKeyPEM);
            }}
          />
          {keyFile && (
            <PasswordInput
              label="Key Passphrase"
              placeholder="If the key is encrypted, enter its passphrase"
              value={passphrase}
              onChange={e => setPassphrase(e.currentTarget.value)}
             
            />
          )}
          <Text size="xs" c="dimmed">
            Encrypted keys (PKCS#8 or legacy PEM) are supported.
          </Text>

          {error && <Text c="red" size="sm">{error}</Text>}

          <Group justify="flex-end">
            <Button variant="default" onClick={() => navigate('/ca')}>
              Cancel
            </Button>
            <Button
              loading={mutation.isPending}
              disabled={!certPEM}
              onClick={handleSubmit}
            >
              Import CA
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

export default ImportCA;
