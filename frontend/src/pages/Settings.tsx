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
  Modal,
  Paper,
  Switch,
  FileInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { authFetchJson, authFetchDownload } from '../api';

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

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupStatus, setBackupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [restoreMessage, setRestoreMessage] = useState('');

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
    <Stack gap='xl' mx='auto'>
      <Title>Settings</Title>

      <Paper withBorder p='lg' style={{ borderLeft: '3px solid var(--mantine-color-teal-5)' }}>
        <Title order={5} mb='md'>Certificate Defaults</Title>
        <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
          <Stack gap='md'>
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
          <TextInput label="From Email" placeholder="noreply@homelab.local" value={smtpFromEmail} onChange={e => setSmtpFromEmail(e.currentTarget.value)} />
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

      <Paper withBorder p='lg' style={{ borderLeft: '3px solid var(--mantine-color-red-5)' }}>
        <Title order={5} c='red' mb='md'>Danger Zone</Title>
        <Stack gap='md'>
          <Group>
            <Button color='teal' variant='filled' onClick={() => { setBackupPassword(''); setBackupStatus('idle'); setShowBackupModal(true); }}>
              Backup Data
            </Button>
            <Button color='orange' variant='filled' onClick={() => { setRestoreFile(null); setRestorePassword(''); setRestoreStatus('idle'); setRestoreMessage(''); setShowRestoreModal(true); }}>
              Restore from Backup
            </Button>
          </Group>
          <Text size='sm' c='dimmed'>
            Factory Reset will permanently delete all certificate authorities, certificates, admin account,
            and settings. You will need to go through setup again.
          </Text>
          <div>
            <Button color='red' variant='filled' onClick={() => { setResetConfirmText(''); setShowResetModal(true); }}>
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

      <Modal
        opened={showBackupModal}
        onClose={() => setShowBackupModal(false)}
        title='Backup Data'
        centered
      >
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            Create an encrypted backup of all your data: certificates, CAs, settings, and encryption keys.
          </Text>
          <PasswordInput
            label='Backup Password'
            placeholder='Enter a strong password'
            value={backupPassword}
            onChange={(e) => setBackupPassword(e.currentTarget.value)}
           
          />
          {backupStatus === 'success' && <Text c='green' size='sm'>Backup downloaded successfully</Text>}
          {backupStatus === 'error' && <Text c='red' size='sm'>Failed to create backup</Text>}
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setShowBackupModal(false)}>Cancel</Button>
            <Button
              color='teal'
              loading={backupStatus === 'loading'}
              disabled={!backupPassword}
              onClick={() => {
                setBackupStatus('loading');
                authFetchDownload('/api/backup/create', { password: backupPassword }, 'glcert-backup.zip')
                  .then(() => setBackupStatus('success'))
                  .catch(() => setBackupStatus('error'));
              }}
            >
              Download Backup
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={showRestoreModal}
        onClose={() => setShowRestoreModal(false)}
        title='Restore from Backup'
        centered
      >
        <Stack gap='md'>
          {restoreStatus !== 'success' ? (
            <>
              <Text size='sm' c='dimmed'>
                Restore CAs, certificates, and settings from a backup. Your admin account and encryption keys are preserved.
              </Text>
              <FileInput
                label='Backup File'
                placeholder='Select .zip backup file'
                accept='.zip'
                value={restoreFile}
                onChange={setRestoreFile}
              />
              <PasswordInput
                label='Backup Password'
                placeholder='Enter backup password'
                value={restorePassword}
                onChange={(e) => setRestorePassword(e.currentTarget.value)}
               
              />
              {restoreStatus === 'error' && <Text c='red' size='sm'>{restoreMessage}</Text>}
              <Group justify='flex-end'>
                <Button variant='default' onClick={() => setShowRestoreModal(false)}>Cancel</Button>
                <Button
                  color='orange'
                  loading={restoreStatus === 'loading'}
                  disabled={!restoreFile || !restorePassword}
                  onClick={() => {
                    setRestoreStatus('loading');
                    const formData = new FormData();
                    formData.append('backup', restoreFile!);
                    formData.append('password', restorePassword);
                    fetch('/api/backup/restore', { method: 'POST', body: formData })
                      .then(async (res) => {
                        if (!res.ok) {
                          const text = await res.text();
                          throw new Error(text);
                        }
                        return res.json();
                      })
                      .then((data) => {
                        setRestoreStatus('success');
                        setRestoreMessage(data.message);
                      })
                      .catch((err) => {
                        setRestoreStatus('error');
                        setRestoreMessage(err.message || 'Restore failed');
                      });
                  }}
                >
                  Restore
                </Button>
              </Group>
            </>
          ) : (
            <>
              <Text c='green' fw={500}>{restoreMessage}</Text>
              <Text size='sm' c='dimmed'>
                Data has been imported. The page will refresh to show the updated data.
              </Text>
              <Group justify='flex-end'>
                <Button onClick={() => {
                  queryClient.invalidateQueries();
                  window.location.href = '/';
                }}>Close</Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}

export default SettingsPage;
