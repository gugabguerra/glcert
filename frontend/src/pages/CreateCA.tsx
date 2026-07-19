import { Title, TextInput, Select, NumberInput, Button, Stack, Group, Textarea, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authFetchJson } from '../api';

interface Settings {
  organization: string;
  country: string;
  state: string;
  city: string;
  email: string;
  defaultKeyAlgorithm: string;
  defaultRSAKeySize: number;
  defaultValidityDays: number;
}

function CreateCA() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: settings } = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => authFetchJson('/api/settings'),
  });

  const form = useForm({
    initialValues: {
      name: '',
      description: '',
      commonName: '',
      organization: '',
      country: '',
      state: '',
      city: '',
      email: '',
      keyAlgorithm: 'rsa',
      rsaKeySize: 2048,
      validityDays: 3650,
    },
  });

  if (settings && form.values.organization === '' && settings.organization !== '') {
    form.setValues({
      organization: settings.organization,
      country: settings.country,
      state: settings.state,
      city: settings.city,
      email: settings.email,
      keyAlgorithm: settings.defaultKeyAlgorithm || 'rsa',
      rsaKeySize: settings.defaultRSAKeySize || 2048,
      validityDays: settings.defaultValidityDays || 3650,
    });
  }

  const mutation = useMutation({
    mutationFn: (values: typeof form.values) =>
      authFetchJson('/api/ca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cas'] });
      navigate('/ca');
    },
  });

  return (
    <Stack>
      <Title>Create Certificate Authority</Title>

      <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
        <Stack gap="md">
          <TextInput
            label="Name"
            placeholder="HomeLab"
            description="A friendly name for this CA"
            required
            autoComplete="off"
            {...form.getInputProps('name')}
          />
          <Textarea
            label="Description"
            placeholder="Optional description"
            autoComplete="off"
            {...form.getInputProps('description')}
          />
          <TextInput
            label="Common Name"
            placeholder="HomeLab CA"
            required
            autoComplete="off"
            {...form.getInputProps('commonName')}
          />

          <TextInput
            label="Organization"
            placeholder="My Homelab"
            autoComplete="off"
            {...form.getInputProps('organization')}
          />
          <Group grow>
            <TextInput
              label="Country"
              placeholder="US"
              autoComplete="off"
              {...form.getInputProps('country')}
            />
            <TextInput
              label="State"
              placeholder="California"
              autoComplete="off"
              {...form.getInputProps('state')}
            />
            <TextInput
              label="City"
              placeholder="San Francisco"
              autoComplete="off"
              {...form.getInputProps('city')}
            />
          </Group>
          <TextInput
            label="Email"
            placeholder="admin@homelab.local"
            autoComplete="off"
            {...form.getInputProps('email')}
          />

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
            <Text c="red">Failed to create CA. Please try again.</Text>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={() => navigate('/ca')}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Create CA
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}

export default CreateCA;
