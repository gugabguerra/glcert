import { Title, TextInput, Select, NumberInput, Button, Stack, Group, Center, Loader } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { authFetchJson } from '../api';

interface Settings {
  id: number;
  organization: string;
  country: string;
  state: string;
  city: string;
  email: string;
  defaultKeyAlgorithm: string;
  defaultRSAKeySize: number;
  defaultECDSACurve: string;
  defaultValidityDays: number;
}

function SettingsPage() {
  const queryClient = useQueryClient();

  const form = useForm({
    initialValues: {
      organization: '',
      country: '',
      state: '',
      city: '',
      email: '',
      defaultKeyAlgorithm: 'rsa',
      defaultRSAKeySize: 2048,
      defaultECDSACurve: 'P-256',
      defaultValidityDays: 365,
    },
  });

  const { data: settingsData, isLoading } = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => authFetchJson('/api/settings'),
  });

  useEffect(() => {
    if (settingsData) {
      form.setValues(settingsData);
    }
  }, [settingsData]);

  const mutation = useMutation({
    mutationFn: (values: Omit<Settings, 'id' | 'createdAt' | 'updatedAt'>) =>
      authFetchJson('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  if (isLoading) return <Center py={80}><Loader /></Center>;

  return (
    <Stack>
      <Title>Settings</Title>

      <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
        <Stack gap="md">
          <TextInput
            label="Organization"
            placeholder="My Homelab"
            {...form.getInputProps('organization')}
          />
          <Group grow>
            <TextInput
              label="Country"
              placeholder="US"
              {...form.getInputProps('country')}
            />
            <TextInput
              label="State"
              placeholder="California"
              {...form.getInputProps('state')}
            />
            <TextInput
              label="City"
              placeholder="San Francisco"
              {...form.getInputProps('city')}
            />
          </Group>
          <TextInput
            label="Email"
            placeholder="admin@homelab.local"
            {...form.getInputProps('email')}
          />

          <Select
            label="Default Key Algorithm"
            data={[
              { value: 'rsa', label: 'RSA' },
              { value: 'ecdsa', label: 'ECDSA' },
              { value: 'ed25519', label: 'Ed25519' },
            ]}
            {...form.getInputProps('defaultKeyAlgorithm')}
          />

          {form.values.defaultKeyAlgorithm === 'rsa' && (
            <Select
              label="RSA Key Size"
              data={[
                { value: '2048', label: '2048 bits' },
                { value: '4096', label: '4096 bits' },
              ]}
              value={String(form.values.defaultRSAKeySize)}
              onChange={(value) => form.setFieldValue('defaultRSAKeySize', Number(value))}
            />
          )}

          {form.values.defaultKeyAlgorithm === 'ecdsa' && (
            <Select
              label="ECDSA Curve"
              data={[
                { value: 'P-256', label: 'P-256' },
                { value: 'P-384', label: 'P-384' },
                { value: 'P-521', label: 'P-521' },
              ]}
              {...form.getInputProps('defaultECDSACurve')}
            />
          )}

          <NumberInput
            label="Default Validity (days)"
            min={1}
            max={3650}
            {...form.getInputProps('defaultValidityDays')}
          />

          <Group justify="flex-end">
            <Button type="submit" loading={mutation.isPending || isLoading}>
              Save Settings
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}

export default SettingsPage;
