import {
  Title,
  TextInput,
  Select,
  NumberInput,
  Button,
  Stack,
  Group,
  Center,
  Loader,
  Text,
  Modal,
  useMantineColorScheme,
  SimpleGrid,
  Paper,
  Divider,
  Switch,
} from '@mantine/core';
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
  notificationsEnabled: boolean;
  notificationWebhookUrl: string;
  notificationThresholdDays: number;
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const { setColorScheme, colorScheme } = useMantineColorScheme();

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
      setNotificationsEnabled(settingsData.notificationsEnabled ?? false);
      setWebhookUrl(settingsData.notificationWebhookUrl ?? '');
      setThresholdDays(settingsData.notificationThresholdDays ?? 30);
    }
  }, [settingsData]);

  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
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
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [thresholdDays, setThresholdDays] = useState(30);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

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

  const testNotificationMutation = useMutation({
    mutationFn: () =>
      authFetchJson('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl }),
      }),
    onSuccess: () => setTestStatus('success'),
    onError: () => setTestStatus('error'),
  });

  const notificationMutation = useMutation({
    mutationFn: () =>
      authFetchJson('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form.values,
          notificationsEnabled,
          notificationWebhookUrl: webhookUrl,
          notificationThresholdDays: thresholdDays,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
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

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');

  const resetMutation = useMutation({
    mutationFn: () =>
      authFetchJson('/api/admin/factory-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      localStorage.removeItem('auth_token');
      window.location.reload();
    },
  });

  const handleFactoryReset = () => {
    resetMutation.mutate();
  };

  if (isLoading)
    return (
      <Center py={80}>
        <Loader />
      </Center>
    );

  return (
    <Stack>
      <Title>Settings</Title>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing='xl' verticalSpacing='xl'>
        {/* Left Column */}
        <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
          <Stack gap='md'>
            <Title order={4}>Certificate Defaults</Title>
            <TextInput
              label='Organization'
              placeholder='My Homelab'
              {...form.getInputProps('organization')}
            />
            <Group grow>
              <TextInput label='Country' placeholder='US' {...form.getInputProps('country')} />
              <TextInput label='State' placeholder='California' {...form.getInputProps('state')} />
              <TextInput label='City' placeholder='San Francisco' {...form.getInputProps('city')} />
            </Group>
            <TextInput
              label='Email'
              placeholder='admin@homelab.local'
              {...form.getInputProps('email')}
            />
            <Select
              label='Default Key Algorithm'
              data={[
                { value: 'rsa', label: 'RSA' },
                { value: 'ecdsa', label: 'ECDSA' },
                { value: 'ed25519', label: 'Ed25519' },
              ]}
              {...form.getInputProps('defaultKeyAlgorithm')}
            />
            {form.values.defaultKeyAlgorithm === 'rsa' && (
              <Select
                label='RSA Key Size'
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
                label='ECDSA Curve'
                data={[
                  { value: 'P-256', label: 'P-256' },
                  { value: 'P-384', label: 'P-384' },
                  { value: 'P-521', label: 'P-521' },
                ]}
                {...form.getInputProps('defaultECDSACurve')}
              />
            )}
            <NumberInput
              label='Default Validity (days)'
              min={1}
              max={3650}
              {...form.getInputProps('defaultValidityDays')}
            />
            <Group justify='flex-end'>
              <Button type='submit' loading={mutation.isPending || isLoading}>
                Save Settings
              </Button>
            </Group>
          </Stack>
        </form>

        {/* Right Column */}
        <Stack gap='xl'>
          <Paper withBorder p='md'>
            <Title order={5} mb='md'>
              Appearance
            </Title>
            <Select
              label='Theme'
              data={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'auto', label: 'System' },
              ]}
              value={colorScheme}
              onChange={(value) => {
                if (value) {
                  setColorScheme(value as 'light' | 'dark' | 'auto');
                  localStorage.setItem('glcert-color-scheme', value);
                }
              }}
            />
          </Paper>

          <Paper withBorder p='md'>
            <Title order={5} mb='md'>
              Notifications
            </Title>
            <Stack gap='md'>
              <Switch
                label='Enable expiration notifications'
                checked={notificationsEnabled}
                onChange={(event) => setNotificationsEnabled(event.currentTarget.checked)}
              />
              <TextInput
                label='Webhook URL'
                placeholder='discord://token@webhookid'
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.currentTarget.value)}
                disabled={!notificationsEnabled}
              />
              <NumberInput
                label='Warning threshold (days)'
                min={1}
                max={365}
                value={thresholdDays}
                onChange={(value) => setThresholdDays(Number(value) || 30)}
                disabled={!notificationsEnabled}
              />
              <Group justify='space-between'>
                <Button
                  variant='light'
                  loading={testNotificationMutation.isPending}
                  disabled={!notificationsEnabled || !webhookUrl}
                  onClick={() => {
                    setTestStatus('idle');
                    testNotificationMutation.mutate();
                  }}
                >
                  Send Test Notification
                </Button>
                {testStatus === 'success' && (
                  <Text c='green' size='sm'>
                    Test sent successfully
                  </Text>
                )}
                {testStatus === 'error' && (
                  <Text c='red' size='sm'>
                    Failed to send test
                  </Text>
                )}
              </Group>
              <Group justify='flex-end'>
                <Button
                  loading={notificationMutation.isPending}
                  onClick={() => notificationMutation.mutate()}
                >
                  Save Notification Settings
                </Button>
              </Group>
            </Stack>
          </Paper>

          <Paper withBorder p='md'>
            <Title order={5} mb='md'>
              Security
            </Title>
            <Stack gap='md'>
              <TextInput
                label='Current Password'
                type='password'
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.currentTarget.value)}
              />
              <TextInput
                label='New Password'
                type='password'
                value={newPassword}
                onChange={(e) => setNewPassword(e.currentTarget.value)}
              />
              <TextInput
                label='Confirm New Password'
                type='password'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              />
              {passwordError && (
                <Text c='red' size='sm'>
                  {passwordError}
                </Text>
              )}
              {passwordSuccess && (
                <Text c='green' size='sm'>
                  {passwordSuccess}
                </Text>
              )}
              <Group justify='flex-end'>
                <Button
                  variant='filled'
                  color='blue'
                  loading={passwordMutation.isPending}
                  onClick={handlePasswordSubmit}
                >
                  Change Password
                </Button>
              </Group>
            </Stack>
          </Paper>
        </Stack>
      </SimpleGrid>

      <Divider m='xl'></Divider>
      <Paper withBorder p='md' style={{ borderColor: 'var(--mantine-color-red-5)' }}>
        <Title order={5} c='red' mb='md'>
          Danger Zone
        </Title>
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            This will permanently delete all certificate authorities, certificates, admin account,
            and settings. You will need to go through setup again.
          </Text>
          <div>
            <Button
              color='red'
              variant='filled'
              onClick={() => {
                setResetConfirmText('');
                setShowResetModal(true);
              }}
            >
              Factory Reset
            </Button>
          </div>
        </Stack>
      </Paper>

      <Modal
        opened={showResetModal}
        onClose={() => setShowResetModal(false)}
        title='Factory Reset'
        centered
      >
        <Stack gap='md'>
          <Text size='sm'>This action cannot be undone. All data will be permanently deleted.</Text>
          <TextInput
            label='Type RESET to confirm'
            placeholder='RESET'
            value={resetConfirmText}
            onChange={(e) => setResetConfirmText(e.currentTarget.value)}
          />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setShowResetModal(false)}>
              Cancel
            </Button>
            <Button
              color='red'
              loading={resetMutation.isPending}
              disabled={resetConfirmText !== 'RESET'}
              onClick={handleFactoryReset}
            >
              Factory Reset
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export default SettingsPage;
