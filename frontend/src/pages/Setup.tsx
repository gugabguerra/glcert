import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Text, TextInput, PasswordInput, Button, Stack, Paper,
  Stepper, Group, ThemeIcon
} from '@mantine/core';
import { IconShieldLock } from '@tabler/icons-react';
import { useAuth } from '../hooks/useAuth';
import { User } from '../types/user';
import { PasswordStrengthIndicator } from '../components/PasswordStrengthIndicator';

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
      login(data.token, data.user as User);
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
           
            required
          />
          <PasswordInput
            label="Password"
            placeholder="Minimum 6 characters"
            value={password}
            onChange={e => setPassword(e.currentTarget.value)}
           
            required
          />
          <PasswordStrengthIndicator password={password} />
          <PasswordInput
            label="Confirm Password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.currentTarget.value)}
           
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
           
            required
          />
          <PasswordStrengthIndicator password={encryptionPassphrase} />
          <PasswordInput
            label="Confirm Passphrase"
            value={confirmPassphrase}
            onChange={e => setConfirmPassphrase(e.currentTarget.value)}
           
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
            placeholder="My Company Department"
            value={organization}
            onChange={e => setOrganization(e.currentTarget.value)}
           
          />
          <Group grow>
            <TextInput
              label="Country"
              placeholder="US"
              value={country}
              onChange={e => setCountry(e.currentTarget.value)}
             
            />
            <TextInput
              label="State"
              placeholder="California"
              value={state}
              onChange={e => setState(e.currentTarget.value)}
             
            />
          </Group>
          <TextInput
            label="City"
            placeholder="San Francisco"
            value={city}
            onChange={e => setCity(e.currentTarget.value)}
           
          />
          {error && <Text c="red" size="sm">{error}</Text>}
          <Group justify="space-between">
            <Button variant="default" onClick={() => setStep(1)}>Back</Button>
            <Button loading={loading} onClick={handleSubmit}>Complete Setup</Button>
          </Group>
        </Stack>
      )}
    </Paper>
  );
}

export default Setup;
