import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Text, TextInput, PasswordInput, Button, Stack, Paper,
  Stepper, Group, ThemeIcon, FileInput, Anchor
} from '@mantine/core';
import { IconShieldLock } from '@tabler/icons-react';
import { useAuth } from '../auth';

function Setup() {
  const { login, setSetupComplete } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [encryptionPassphrase, setEncryptionPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [organization, setOrganization] = useState('');
  const [country, setCountry] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [showRestore, setShowRestore] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [restoreMessage, setRestoreMessage] = useState('');

  const validateStep0 = () => {
    if (!email.trim() || !email.includes('@')) return setError('Valid email is required');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (password !== confirmPassword) return setError('Passwords do not match');
    setError('');
    setStep(1);
  };

  const validateStep1 = () => {
    if (encryptionPassphrase.length < 8) return setError('Passphrase must be at least 8 characters');
    if (encryptionPassphrase !== confirmPassphrase) return setError('Passphrases do not match');
    setError('');
    setStep(2);
  };

  const handleSubmit = async () => {
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          encryptionPassphrase,
          organization,
          country,
          state,
          city,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        setError(text || 'Setup failed');
        setLoading(false);
        return;
      }

      const data = await res.json();
      login(data.token);
      setSetupComplete(true);
      navigate('/');
    } catch {
      setError('Connection failed');
      setLoading(false);
    }
  };

  return (
    <Paper shadow="md" p="xl" m="auto" maw={500} mt={80}>
      <Group justify="center" mb="md">
        <ThemeIcon size={64} variant="light" color="teal" radius="xl">
          <IconShieldLock size={32} />
        </ThemeIcon>
      </Group>
      <Title order={2} ta="center" mb="lg">Welcome to GLCert</Title>
      <Text c="dimmed" ta="center" mb="xl">Set up your PKI manager</Text>

      {!showRestore ? (
        <>
          <Stepper active={step} mb="xl">
            <Stepper.Step label="Admin Account" description="Login credentials" />
            <Stepper.Step label="Encryption" description="Passphrase setup" />
            <Stepper.Step label="Settings" description="Organization details" />
          </Stepper>

      {step === 0 && (
        <Stack gap="md">
          <TextInput
            label="Email"
            placeholder="admin@example.com"
            type="email"
            value={email}
            onChange={e => setEmail(e.currentTarget.value)}
            autoComplete="email"
            required
          />
          <PasswordInput
            label="Password"
            placeholder="Minimum 6 characters"
            value={password}
            onChange={e => setPassword(e.currentTarget.value)}
            autoComplete="new-password"
            required
          />
          <PasswordInput
            label="Confirm Password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.currentTarget.value)}
            autoComplete="new-password"
            required
          />
          {error && <Text c="red" size="sm">{error}</Text>}
          <Group justify="flex-end">
            <Button onClick={validateStep0}>Next</Button>
          </Group>
        </Stack>
      )}

      {step === 1 && (
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This passphrase encrypts your certificate private keys. You will need to provide your admin password on each login to unlock them.
          </Text>
          <PasswordInput
            label="Encryption Passphrase"
            placeholder="Minimum 8 characters"
            value={encryptionPassphrase}
            onChange={e => setEncryptionPassphrase(e.currentTarget.value)}
            autoComplete="off"
            required
          />
          <PasswordInput
            label="Confirm Passphrase"
            value={confirmPassphrase}
            onChange={e => setConfirmPassphrase(e.currentTarget.value)}
            autoComplete="off"
            required
          />
          {error && <Text c="red" size="sm">{error}</Text>}
          <Group justify="space-between">
            <Button variant="default" onClick={() => setStep(0)}>Back</Button>
            <Button onClick={validateStep1}>Next</Button>
          </Group>
        </Stack>
      )}

      {step === 2 && (
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            These defaults are used when generating certificates. You can change them later.
          </Text>
          <TextInput
            label="Organization"
            placeholder="My Company"
            value={organization}
            onChange={e => setOrganization(e.currentTarget.value)}
            autoComplete="organization"
          />
          <Group grow>
            <TextInput
              label="Country"
              placeholder="US"
              value={country}
              onChange={e => setCountry(e.currentTarget.value)}
              autoComplete="country-name"
            />
            <TextInput
              label="State"
              placeholder="California"
              value={state}
              onChange={e => setState(e.currentTarget.value)}
              autoComplete="address-level1"
            />
          </Group>
          <TextInput
            label="City"
            placeholder="San Francisco"
            value={city}
            onChange={e => setCity(e.currentTarget.value)}
            autoComplete="address-level2"
          />
          {error && <Text c="red" size="sm">{error}</Text>}
          <Group justify="space-between">
            <Button variant="default" onClick={() => setStep(1)}>Back</Button>
            <Button loading={loading} onClick={handleSubmit}>Complete Setup</Button>
          </Group>
        </Stack>
      )}
        </>
      ) : (
        <Stack gap="md">
          {restoreStatus !== 'success' ? (
            <>
              <Text size="sm" c="dimmed">
                Restore all your certificates, CAs, and settings from a backup file.
              </Text>
              <FileInput
                label="Backup File"
                placeholder="Select .zip backup file"
                accept=".zip"
                value={restoreFile}
                onChange={setRestoreFile}
              />
              <PasswordInput
                label="Backup Password"
                placeholder="Enter backup password"
                value={restorePassword}
                onChange={e => setRestorePassword(e.currentTarget.value)}
                autoComplete="off"
              />
              {restoreStatus === 'error' && <Text c="red" size="sm">{restoreMessage}</Text>}
              <Group justify="space-between">
                <Button variant="default" onClick={() => setShowRestore(false)}>Back</Button>
                <Button
                  color="orange"
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
              <Text c="green" fw={500}>{restoreMessage}</Text>
              <Text size="sm" c="dimmed">
                The server is restarting. Wait a moment, then refresh the page to log in.
              </Text>
            </>
          )}
        </Stack>
      )}

      {!showRestore && (
        <Text ta="center" mt="md" size="sm">
          Have a backup? <Anchor component="button" size="sm" onClick={() => setShowRestore(true)}>Restore from backup</Anchor>
        </Text>
      )}
    </Paper>
  );
}

export default Setup;
