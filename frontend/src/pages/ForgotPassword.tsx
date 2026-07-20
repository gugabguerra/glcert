import { useState } from 'react';
import { Title, Text, TextInput, Button, Stack, Paper, ThemeIcon, Group } from '@mantine/core';
import { IconShieldLock } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {}
    setSubmitted(true);
    setLoading(false);
  };

  return (
    <Paper shadow="md" p="xl" m="auto" maw={400} mt={120}>
      <Group justify="center" mb="md">
        <ThemeIcon size={64} variant="light" color="teal" radius="xl">
          <IconShieldLock size={32} />
        </ThemeIcon>
      </Group>
      <Title order={2} ta="center" mb="xs">Forgot Password</Title>
      <Text c="dimmed" ta="center" mb="lg">
        Enter your email to receive a password reset link.
      </Text>

      {submitted ? (
        <Stack gap="md" ta="center">
          <Text c="dimmed">
            If an account exists with that email, a reset link has been sent.
          </Text>
          <Button component={Link} to="/login" variant="default">
            Back to Login
          </Button>
        </Stack>
      ) : (
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <TextInput
              label="Email"
              placeholder="admin@example.com"
              type="email"
              value={email}
              onChange={e => setEmail(e.currentTarget.value)}
             
              required
            />
            <Button type="submit" fullWidth loading={loading}>
              Send Reset Link
            </Button>
            <Button component={Link} to="/login" variant="subtle" size="sm">
              Back to Login
            </Button>
          </Stack>
        </form>
      )}
    </Paper>
  );
}

export default ForgotPassword;
