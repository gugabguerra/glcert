import { Title, TextInput, Select, NumberInput, Button, Stack, Group, Center, Loader, Divider, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const passwordMutation = useMutation({
    mutationFn: (values: { currentPassword: string; newPassword: string }) =>
      authFetchJson('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      setPasswordError('');
      setPasswordSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: () => {
      setPasswordSuccess('');
      setPasswordError('Invalid current password');
    },
  });

  const handlePasswordSubmit = () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All fields are required');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordError('New password must differ from current password');
      return;
    }

    passwordMutation.mutate({ currentPassword, newPassword });
  };

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

      <Divider my="xl" />

      <Title order={4}>Change Password</Title>
      <Stack gap="md" maw={400}>
        <TextInput
          label="Current Password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.currentTarget.value)}
        />
        <TextInput
          label="New Password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.currentTarget.value)}
        />
        <TextInput
          label="Confirm New Password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.currentTarget.value)}
        />
        {passwordError && <Text c="red" size="sm">{passwordError}</Text>}
        {passwordSuccess && <Text c="green" size="sm">{passwordSuccess}</Text>}
        <Group justify="flex-end">
          <Button
            variant="filled"
            color="blue"
            loading={passwordMutation.isPending}
            onClick={handlePasswordSubmit}
          >
            Change Password
          </Button>
        </Group>
      </Stack>
    </Stack>
  );
}

export default SettingsPage;
