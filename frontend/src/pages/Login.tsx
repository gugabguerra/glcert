import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Title, Text, TextInput, PasswordInput, PinInput, Button, Stack, Paper, Group, Anchor, Image, useComputedColorScheme } from '@mantine/core';
import { useAuth } from '../hooks/useAuth';
import { User } from '../types/user';

function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const computedColorScheme = useComputedColorScheme('light');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [partialToken, setPartialToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setError('Invalid email or password');
        setLoading(false);
        return;
      }

      const data = await res.json();

      if (data.partialToken) {
        setPartialToken(data.partialToken);
        setLoading(false);
        return;
      }

      login(data.token, data.user as User);
      navigate('/');
    } catch {
      setError('Connection failed');
      setLoading(false);
    }
  };

  const handleTOTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partialToken, code: totpCode }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Invalid code');
        setLoading(false);
        return;
      }

      const data = await res.json();
      login(data.token, data.user as User);
      navigate('/');
    } catch {
      setError('Connection failed');
      setLoading(false);
    }
  };

  if (partialToken) {
    return (
      <Paper shadow="md" p="xl" m="auto" maw={400} mt={120}>
        <Group justify="center" mb="md">
          <Image
            src={computedColorScheme === 'dark' ? '/glcert-logo-dark.png' : '/glcert-logo-light.png'}
            h={64}
            fit="contain"
          />
        </Group>
        <Title order={2} ta="center" mb="xs">Two-Factor Authentication</Title>
        <Text c="dimmed" ta="center" mb="lg">Enter the 6-digit code from your authenticator app</Text>

        <form onSubmit={handleTOTPSubmit}>
          <Stack gap="md">
            <Group justify="center">
              <PinInput
                length={6}
                value={totpCode}
                onChange={setTotpCode}
                size="lg"
              />
            </Group>
            {error && <Text c="red" size="sm" ta="center">{error}</Text>}
            <Button type="submit" fullWidth loading={loading} disabled={totpCode.length !== 6}>
              Verify
            </Button>
            <Anchor component="button" onClick={() => { setPartialToken(''); setTotpCode(''); }} size="sm" ta="center">
              Back to login
            </Anchor>
          </Stack>
        </form>
      </Paper>
    );
  }

  return (
    <Paper shadow="md" p="xl" m="auto" maw={400} mt={120}>
      <Group justify="center" mb="md">
        <Image
          src={computedColorScheme === 'dark' ? '/glcert-logo-dark.png' : '/glcert-logo-light.png'}
          h={64}
          fit="contain"
        />
      </Group>
      <Title order={2} ta="center" mb="xs">GLCert</Title>
      <Text c="dimmed" ta="center" mb="lg">Sign in to manage your certificates</Text>

      <form onSubmit={handleCredentialsSubmit}>
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
            placeholder="Your password"
            value={password}
            onChange={e => setPassword(e.currentTarget.value)}
           
            required
          />
          <Anchor component={Link} to="/forgot-password" size="sm">
            Forgot Password?
          </Anchor>
          {error && <Text c="red" size="sm">{error}</Text>}
          <Button type="submit" fullWidth loading={loading}>
            Sign In
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}

export default Login;
