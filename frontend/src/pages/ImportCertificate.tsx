import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Text, TextInput, Textarea, Button, Stack, Group, FileInput, Paper, PasswordInput, Select,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authFetchJson } from '../api/client';

interface CA {
  id: string;
  name: string;
  parentCaId: string | null;
}

function ImportCertificate() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [certPEM, setCertPEM] = useState('');
  const [keyPEM, setKeyPEM] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [caId, setCaId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data: cas = [] } = useQuery<CA[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
  });

  const caOptions = cas.map((ca) => ({
    value: ca.id,
    label: ca.name,
  }));

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
      authFetchJson<{ id: string }>('/api/certificates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          certPem: certPEM,
          keyPem: keyPEM,
          passphrase,
          certificateAuthorityId: caId,
        }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      queryClient.invalidateQueries({ queryKey: ['certGroups'] });
      navigate(`/certificates/${data.id}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Import failed. Check that the certificate is valid and signed by the selected CA.');
    },
  });

  const handleSubmit = () => {
    setError('');
    if (!name.trim()) return setError('Name is required');
    if (!certPEM.trim()) return setError('Certificate file is required');
    if (!keyPEM.trim()) return setError('Private key file is required');
    if (!caId) return setError('Please select a certificate authority');
    mutation.mutate();
  };

  return (
    <Stack>
      <Title>Import Certificate</Title>
      <Text c="dimmed">
        Import a certificate generated externally and link it to an existing CA. The app will verify the certificate was signed by the selected CA.
      </Text>

      <Paper withBorder p="md">
        <Stack gap="md">
          <TextInput
            label="Name"
            placeholder="my-server"
            description="A friendly name for this certificate"
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
          <Select
            label="Certificate Authority"
            placeholder="Select the CA that signed this certificate"
            data={caOptions}
            required
            searchable
            value={caId}
            onChange={setCaId}
          />
          <FileInput
            label="Certificate"
            placeholder="Select cert.pem or cert.crt file"
            accept=".crt,.pem,.cer"
            required
            value={certFile}
            onChange={(file) => {
              setCertFile(file);
              handleFileRead(file, setCertPEM);
            }}
          />
          <FileInput
            label="Private Key"
            placeholder="Select key.pem file"
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
            <Button variant="default" onClick={() => navigate('/certificates')}>
              Cancel
            </Button>
            <Button
              loading={mutation.isPending}
              disabled={!certPEM || !keyPEM || !caId}
              onClick={handleSubmit}
            >
              Import Certificate
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

export default ImportCertificate;
