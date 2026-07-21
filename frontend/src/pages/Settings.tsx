import {
  Title,
  TextInput,
  PasswordInput,
  Select,
  NumberInput,
  Button,
  Stack,
  Group,
  Center,
  Loader,
  Text,
  Paper,
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
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpFromEmail: string;
  smtpFromName: string;
  emailNotificationsEnabled: boolean;
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
      setNotificationsEnabled(settingsData.notificationsEnabled ?? false);
      setWebhookUrl(settingsData.notificationWebhookUrl ?? '');
      setThresholdDays(settingsData.notificationThresholdDays ?? 30);
      setSmtpHost(settingsData.smtpHost ?? '');
      setSmtpPort(settingsData.smtpPort ?? 587);
      setSmtpUsername(settingsData.smtpUsername ?? '');
      setSmtpFromEmail(settingsData.smtpFromEmail ?? '');
      setSmtpFromName(settingsData.smtpFromName ?? 'GLCert');
      setEmailNotificationsEnabled(settingsData.emailNotificationsEnabled ?? false);
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

  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [thresholdDays, setThresholdDays] = useState(30);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpFromEmail, setSmtpFromEmail] = useState('');
  const [smtpFromName, setSmtpFromName] = useState('GLCert');
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(false);
  const [testEmailStatus, setTestEmailStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

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

  if (isLoading)
    return (
      <Center py={80}>
        <Loader />
      </Center>
    );

  return (
    <Stack gap='xl' mx='auto'>
      <Title>Settings</Title>

      <Paper withBorder p='lg' style={{ borderLeft: '3px solid var(--mantine-color-teal-5)' }}>
        <Title order={5} mb='md'>Certificate Defaults</Title>
        <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
          <Stack gap='md'>
            <TextInput
              label='Organization'
              placeholder='My Company'
              {...form.getInputProps('organization')}
            />
            <Group grow>
              <TextInput label='Country' placeholder='US' {...form.getInputProps('country')} />
              <TextInput label='State' placeholder='California' {...form.getInputProps('state')} />
              <TextInput label='City' placeholder='San Francisco' {...form.getInputProps('city')} />
            </Group>
            <TextInput
              label='Email'
              placeholder='admin@mycompany.com'
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
      </Paper>

      <Paper withBorder p='lg' style={{ borderLeft: '3px solid var(--mantine-color-teal-5)' }}>
        <Title order={5} mb='md'>Notifications</Title>
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
            {testStatus === 'success' && <Text c='green' size='sm'>Test sent successfully</Text>}
            {testStatus === 'error' && <Text c='red' size='sm'>Failed to send test</Text>}
          </Group>
          <Group justify='flex-end'>
            <Button loading={notificationMutation.isPending} onClick={() => notificationMutation.mutate()}>
              Save Notification Settings
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder p='lg' style={{ borderLeft: '3px solid var(--mantine-color-teal-5)' }}>
        <Title order={5} mb='md'>Email</Title>
        <Stack gap='md'>
          <TextInput label="SMTP Host" placeholder="smtp.gmail.com" value={smtpHost} onChange={e => setSmtpHost(e.currentTarget.value)} />
          <NumberInput label="SMTP Port" min={1} max={65535} value={smtpPort} onChange={v => setSmtpPort(Number(v) || 587)} />
          <TextInput label="SMTP Username" placeholder="your@email.com" value={smtpUsername} onChange={e => setSmtpUsername(e.currentTarget.value)} />
          <PasswordInput label="SMTP Password" value={smtpPassword} onChange={e => setSmtpPassword(e.currentTarget.value)} placeholder="Leave empty to keep current" />
          <TextInput label="From Email" placeholder="noreply@mycompany.com" value={smtpFromEmail} onChange={e => setSmtpFromEmail(e.currentTarget.value)} />
          <TextInput label="From Name" placeholder="GLCert" value={smtpFromName} onChange={e => setSmtpFromName(e.currentTarget.value)} />
          <Switch label="Send expiration alerts via email" checked={emailNotificationsEnabled} onChange={e => setEmailNotificationsEnabled(e.currentTarget.checked)} />
          <Group justify="space-between">
            <Button variant="light" loading={testEmailStatus === 'loading'} disabled={!smtpHost || !smtpFromEmail} onClick={() => {
              setTestEmailStatus('loading');
              authFetchJson('/api/notifications/test-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: smtpFromEmail }),
              }).then(() => setTestEmailStatus('success')).catch(() => setTestEmailStatus('error'));
            }}>Send Test Email</Button>
            {testEmailStatus === 'success' && <Text c="green" size="sm">Test email sent</Text>}
            {testEmailStatus === 'error' && <Text c="red" size="sm">Failed to send test email</Text>}
          </Group>
          <Group justify="flex-end">
            <Button loading={notificationMutation.isPending} onClick={() => {
              authFetchJson('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ...form.values,
                  notificationsEnabled,
                  notificationWebhookUrl: webhookUrl,
                  notificationThresholdDays: thresholdDays,
                  smtpHost, smtpPort, smtpUsername, smtpPassword: smtpPassword || '',
                  smtpFromEmail, smtpFromName, emailNotificationsEnabled,
                }),
              }).then(() => {
                queryClient.invalidateQueries({ queryKey: ['settings'] });
                setSmtpPassword('');
              });
            }}>Save Email Settings</Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

export default SettingsPage;
