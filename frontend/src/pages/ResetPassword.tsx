import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Title, Text, PasswordInput, Button, Stack, Paper, ThemeIcon, Group } from '@mantine/core';
import { IconShieldLock } from '@tabler/icons-react';

function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <Paper shadow="md" p="xl" m="auto" maw={400} mt={120}>
        <Title order={2} ta="center" mb="xs">Invalid Link</Title>
        <Text c="dimmed" ta="center">This password reset link is invalid or missing a token.</Text>
      </Paper>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        setError('Reset link has expired or is invalid');
        setLoading(false);
        return;
      }
      setSuccess(true);
    } catch {
      setError('Connection failed');
      setLoading(false);
    }
  };

  return (
    <Paper shadow="md" p="xl" m="auto" maw={400} mt={120}>
      <Group justify="center" mb="md">
        <ThemeIcon size={64} variant="light" color="teal" radius="xl">
          <IconShieldLock size={32} />
        </ThemeIcon>
      </Group>
      <Title order={2} ta="center" mb="xs">Reset Password</Title>
      <Text c="dimmed" ta="center" mb="lg">Enter your new password below.</Text>

      {success ? (
        <Stack gap="md" ta="center">
          <Text c="green">Password updated successfully.</Text>
          <Button fullWidth onClick={() => navigate('/login')}>
            Sign In
          </Button>
        </Stack>
      ) : (
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <PasswordInput
              label="New Password"
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
            <Button type="submit" fullWidth loading={loading}>
              Reset Password
            </Button>
          </Stack>
        </form>
      )}
    </Paper>
  );
}

export default ResetPassword;
