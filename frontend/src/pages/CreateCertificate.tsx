import { Title, TextInput, Select, NumberInput, Button, Stack, Group, Textarea, Text, TagsInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authFetchJson } from '../api';

interface CA {
  id: number;
  name: string;
}

interface Settings {
  organization: string;
  country: string;
  state: string;
  city: string;
  defaultKeyAlgorithm: string;
  defaultRSAKeySize: number;
  defaultValidityDays: number;
}

function CreateCertificate() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: cas = [] } = useQuery<CA[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
  });

  const { data: settings } = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => authFetchJson('/api/settings'),
  });

  const form = useForm({
    initialValues: {
      name: '',
      description: '',
      commonName: '',
      type: 'server',
      certificateAuthorityId: null as number | null,
      dnsNames: [] as string[],
      ipAddresses: [] as string[],
      organization: '',
      country: '',
      state: '',
      city: '',
      keyAlgorithm: 'rsa',
      rsaKeySize: 2048,
      validityDays: 365,
    },
  });

  if (settings && form.values.organization === '' && settings.organization !== '') {
    form.setValues({
      organization: settings.organization,
      country: settings.country,
      state: settings.state,
      city: settings.city,
      keyAlgorithm: settings.defaultKeyAlgorithm || 'rsa',
      rsaKeySize: settings.defaultRSAKeySize || 2048,
      validityDays: settings.defaultValidityDays || 365,
    });
  }

  const caOptions = cas.map((ca) => ({ value: String(ca.id), label: ca.name }));
  const hasCA = cas.length > 0;

  const typeData = hasCA
    ? [
        { value: 'server', label: 'Server' },
        { value: 'client', label: 'Client' },
        { value: 'selfsigned', label: 'Self-Signed' },
      ]
    : [
        { value: 'selfsigned', label: 'Self-Signed' },
      ];

  const mutation = useMutation({
    mutationFn: (values: typeof form.values) => {
      const payload = {
        ...values,
        certificateAuthorityId: values.certificateAuthorityId
          ? Number(values.certificateAuthorityId)
          : null,
      };
      return authFetchJson('/api/certificates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      navigate('/certificates');
    },
  });

  const isSelfSigned = form.values.type === 'selfsigned';

  return (
    <Stack>
      <Title>Create Certificate</Title>

      <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
        <Stack gap="md">
          <Select
            label="Type"
            data={typeData}
            description={!hasCA ? 'Create a CA first to issue Server or Client certificates' : undefined}
            {...form.getInputProps('type')}
          />

          <TextInput
            label="Name"
            placeholder="docker-api-01"
            required
            {...form.getInputProps('name')}
          />
          <Textarea
            label="Description"
            placeholder="Optional description"
            {...form.getInputProps('description')}
          />
          <TextInput
            label="Common Name"
            placeholder="docker-api-01.homelab.local"
            required
            {...form.getInputProps('commonName')}
          />

          {!isSelfSigned && (
            <Select
              label="Certificate Authority"
              data={caOptions}
              placeholder="Select a CA"
              required
              searchable
              {...form.getInputProps('certificateAuthorityId')}
            />
          )}

          <TagsInput
            label="DNS Names"
            placeholder="Add DNS name and press Enter"
            description="e.g., docker-api-01.homelab.local, docker-api.homelab.local"
            {...form.getInputProps('dnsNames')}
          />

          <TagsInput
            label="IP Addresses"
            placeholder="Add IP address and press Enter"
            description="e.g., 192.168.1.100"
            {...form.getInputProps('ipAddresses')}
          />

          <TextInput
            label="Organization"
            placeholder="My Homelab"
            {...form.getInputProps('organization')}
          />
          <Group grow>
            <TextInput label="Country" placeholder="US" {...form.getInputProps('country')} />
            <TextInput label="State" placeholder="California" {...form.getInputProps('state')} />
            <TextInput label="City" placeholder="San Francisco" {...form.getInputProps('city')} />
          </Group>

          <Select
            label="Key Algorithm"
            data={[
              { value: 'rsa', label: 'RSA' },
              { value: 'ecdsa', label: 'ECDSA' },
            ]}
            {...form.getInputProps('keyAlgorithm')}
          />

          {form.values.keyAlgorithm === 'rsa' && (
            <Select
              label="RSA Key Size"
              data={[
                { value: '2048', label: '2048 bits' },
                { value: '4096', label: '4096 bits' },
              ]}
              value={String(form.values.rsaKeySize)}
              onChange={(value) => form.setFieldValue('rsaKeySize', Number(value))}
            />
          )}

          <NumberInput
            label="Validity (days)"
            min={1}
            max={3650}
            {...form.getInputProps('validityDays')}
          />

          {mutation.isError && (
            <Text c="red">Failed to create certificate. Please try again.</Text>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={() => navigate('/certificates')}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Create Certificate
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}

export default CreateCertificate;
