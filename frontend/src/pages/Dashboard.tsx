import { Title, Text, SimpleGrid, Stack, Anchor, Table, Badge, Center, Loader, Paper, ThemeIcon, Group } from '@mantine/core';
import { IconShieldCheck, IconCertificate, IconClock, IconAlertTriangle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { authFetchJson } from '../api';

interface DashboardStats {
  caCount: number;
  certificateCount: number;
  expiringSoon: number;
  expired: number;
}

interface Certificate {
  id: number;
  name: string;
  type: string;
  caName: string;
  caSubject: string;
  currentVersion: number;
}

function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: () => authFetchJson('/api/dashboard'),
  });

  const { data: certs = [] } = useQuery<Certificate[]>({
    queryKey: ['certificates'],
    queryFn: () => authFetchJson('/api/certificates'),
  });

  const typeColors: Record<string, string> = {
    server: 'blue',
    client: 'green',
    serverclient: 'purple',
    selfsigned: 'orange',
  };

  const typeLabels: Record<string, string> = {
    server: 'Server',
    client: 'Client',
    serverclient: 'Server + Client',
    selfsigned: 'Self-Signed',
  };

  if (statsLoading) return <Center py={80}><Loader /></Center>;

  return (
    <Stack>
      <Title>Dashboard</Title>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <Paper p="lg" withBorder>
          <Group>
            <ThemeIcon size="lg" variant="light" color="teal">
              <IconShieldCheck size={24} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Certificate Authorities</Text>
              <Text fw={700} size="xl">{stats?.caCount ?? '—'}</Text>
            </div>
          </Group>
        </Paper>
        <Paper p="lg" withBorder>
          <Group>
            <ThemeIcon size="lg" variant="light" color="blue">
              <IconCertificate size={24} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Certificates</Text>
              <Text fw={700} size="xl">{stats?.certificateCount ?? '—'}</Text>
            </div>
          </Group>
        </Paper>
        <Paper p="lg" withBorder>
          <Group>
            <ThemeIcon size="lg" variant="light" color="yellow">
              <IconClock size={24} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Expiring Soon</Text>
              <Text fw={700} size="xl">{stats?.expiringSoon ?? '—'}</Text>
            </div>
          </Group>
        </Paper>
        <Paper p="lg" withBorder>
          <Group>
            <ThemeIcon size="lg" variant="light" color="red">
              <IconAlertTriangle size={24} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Expired</Text>
              <Text fw={700} size="xl">{stats?.expired ?? '—'}</Text>
            </div>
          </Group>
        </Paper>
      </SimpleGrid>

      {certs.length > 0 && (
        <>
          <Title order={4}>Recent Certificates</Title>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Issuer</Table.Th>
                <Table.Th>Version</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {certs.slice(0, 5).map((cert) => (
                <Table.Tr key={cert.id}>
                  <Table.Td>
                    <Anchor component={Link} to={`/certificates/${cert.id}`}>
                      {cert.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={typeColors[cert.type] || 'gray'}>{typeLabels[cert.type] || cert.type}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {cert.caName || cert.caSubject
                      ? <Group gap={4}>{cert.caName || cert.caSubject}{!cert.caName && cert.caSubject && <Badge size="xs" color="gray" variant="light">Orphan</Badge>}</Group>
                      : 'Self-Signed'
                    }
                  </Table.Td>
                  <Table.Td>v{cert.currentVersion}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
}

export default Dashboard;
