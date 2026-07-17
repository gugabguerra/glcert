import { Title, Text, SimpleGrid, Card, Stack, Anchor, Table, Badge } from '@mantine/core';
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
  currentVersion: number;
}

function Dashboard() {
  const { data: stats } = useQuery<DashboardStats>({
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
    selfsigned: 'orange',
  };

  return (
    <Stack>
      <Title>Dashboard</Title>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <Card withBorder>
          <Text fw={500}>Certificate Authorities</Text>
          <Text size="xl">{stats?.caCount ?? '—'}</Text>
        </Card>
        <Card withBorder>
          <Text fw={500}>Certificates</Text>
          <Text size="xl">{stats?.certificateCount ?? '—'}</Text>
        </Card>
        <Card withBorder>
          <Text fw={500}>Expiring Soon</Text>
          <Text size="xl" c={stats?.expiringSoon ? 'yellow' : undefined}>
            {stats?.expiringSoon ?? '—'}
          </Text>
        </Card>
        <Card withBorder>
          <Text fw={500}>Expired</Text>
          <Text size="xl" c={stats?.expired ? 'red' : undefined}>
            {stats?.expired ?? '—'}
          </Text>
        </Card>
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
                    <Badge color={typeColors[cert.type] || 'gray'}>{cert.type}</Badge>
                  </Table.Td>
                  <Table.Td>{cert.caName || 'Self-Signed'}</Table.Td>
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
