import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Title, Text, TextInput, PasswordInput, Button, Stack, Paper, ThemeIcon, Group } from '@mantine/core';
import { IconShieldLock } from '@tabler/icons-react';
import { useAuth } from '../auth';

function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        setError('Invalid username or password');
        setLoading(false);
        return;
      }

      const data = await res.json();
      login(data.token);
      navigate('/');
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
      <Title order={2} ta="center" mb="xs">GLCert</Title>
      <Text c="dimmed" ta="center" mb="lg">Sign in to manage your certificates</Text>

      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Username"
            placeholder="admin"
            value={username}
            onChange={e => setUsername(e.currentTarget.value)}
            required
          />
          <PasswordInput
            label="Password"
            placeholder="Your password"
            value={password}
            onChange={e => setPassword(e.currentTarget.value)}
            required
          />
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
