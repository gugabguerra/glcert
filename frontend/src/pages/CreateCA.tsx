import { Title, TextInput, Select, NumberInput, Button, Stack, Group, Textarea, Text, PasswordInput, Radio } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authFetchJson } from '../api';

interface Settings {
  organization: string;
  country: string;
  state: string;
  city: string;
  email: string;
  defaultKeyAlgorithm: string;
  defaultRSAKeySize: number;
  defaultValidityDays: number;
}

interface CA {
  id: string;
  name: string;
  parentCaId?: string | null;
}

function CreateCA() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: settings } = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => authFetchJson('/api/settings'),
  });

  const { data: cas = [] } = useQuery<CA[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
  });

  const form = useForm({
    initialValues: {
      caType: 'root' as 'root' | 'intermediate',
      name: '',
      description: '',
      commonName: '',
      organization: '',
      country: '',
      state: '',
      city: '',
      email: '',
      keyAlgorithm: 'rsa',
      rsaKeySize: 2048,
      validityDays: 1825,
      passphrase: '',
      parentCaId: null as string | null,
    },
  });

  if (settings && form.values.organization === '' && settings.organization !== '') {
    form.setValues({
      organization: settings.organization,
      country: settings.country,
      state: settings.state,
      city: settings.city,
      email: settings.email,
      keyAlgorithm: settings.defaultKeyAlgorithm || 'rsa',
      rsaKeySize: settings.defaultRSAKeySize || 2048,
      validityDays: 1825,
    });
  }

  const mutation = useMutation({
    mutationFn: (values: typeof form.values) => {
      const payload = {
        ...values,
        parentCaId: values.caType === 'intermediate' ? values.parentCaId : null,
      };
      return authFetchJson('/api/ca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cas'] });
      navigate('/ca');
    },
  });

  // Only root CAs (those without parentCaId) can be parents
  const rootCAs = cas.filter(ca => !ca.parentCaId);
  const caOptions = rootCAs.map(ca => ({ value: ca.id, label: ca.name }));
  const isIntermediate = form.values.caType === 'intermediate';

  return (
    <Stack>
      <Title>Create Certificate Authority</Title>

      <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
        <Stack gap="md">
          <Radio.Group
            label="Type"
            value={form.values.caType}
            onChange={(value) => {
              form.setFieldValue('caType', value as 'root' | 'intermediate');
              if (value === 'root') {
                form.setFieldValue('parentCaId', null);
                form.setFieldValue('validityDays', 1825);
              } else {
                form.setFieldValue('validityDays', settings?.defaultValidityDays || 365);
              }
            }}
          >
            <Group mt="xs">
              <Radio value="root" label="Root CA" />
              <Radio value="intermediate" label="Intermediate CA" disabled={rootCAs.length === 0} />
            </Group>
          </Radio.Group>

          {isIntermediate && (
            <Select
              label="Root CA"
              placeholder="Select a root CA"
              data={caOptions}
              searchable
              required
              value={form.values.parentCaId}
              onChange={(value) => form.setFieldValue('parentCaId', value)}
            />
          )}

          <TextInput
            label="Display Name"
            placeholder="MyCompany"
            description="A friendly name for this CA"
            required
           
            {...form.getInputProps('name')}
          />
          <Textarea
            label="Description"
            placeholder="Optional description"
           
            {...form.getInputProps('description')}
          />
          <TextInput
            label="Common Name"
            placeholder="MyCompany"
            required
           
            {...form.getInputProps('commonName')}
          />

          <TextInput
            label="Organization"
            placeholder="My Company Department"
           
            {...form.getInputProps('organization')}
          />
          <Group grow>
            <TextInput
              label="Country"
              placeholder="US"
             
              {...form.getInputProps('country')}
            />
            <TextInput
              label="State"
              placeholder="California"
             
              {...form.getInputProps('state')}
            />
            <TextInput
              label="City"
              placeholder="San Francisco"
             
              {...form.getInputProps('city')}
            />
          </Group>
          <TextInput
            label="Email"
            placeholder="admin@mycompany.com"
           
            {...form.getInputProps('email')}
          />

          <Select
            label="Key Algorithm"
            data={[
              { value: 'rsa', label: 'RSA' },
              { value: 'ecdsa', label: 'ECDSA' },
            ]}
            {...form.getInputProps('keyAlgorithm')}
          />

          {form.values.keyAlgorithm === 'rsa' && (
            <Select
              label="RSA Key Size"
              data={[
                { value: '2048', label: '2048 bits' },
                { value: '4096', label: '4096 bits' },
              ]}
              value={String(form.values.rsaKeySize)}
              onChange={(value) => form.setFieldValue('rsaKeySize', Number(value))}
            />
          )}

          <NumberInput
            label="Validity (days)"
            min={1}
            max={3650}
            {...form.getInputProps('validityDays')}
          />

          <PasswordInput
            label="Key Passphrase (optional)"
            placeholder="Encrypt the private key with a passphrase"
            description="If set, the CA private key will be passphrase-protected (PKCS#8)"
            value={form.values.passphrase}
            onChange={(e) => form.setFieldValue('passphrase', e.currentTarget.value)}
           
          />

          {mutation.isError && (
            <Text c="red">Failed to create CA. Please try again.</Text>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={() => navigate('/ca')}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {isIntermediate ? 'Create Intermediate CA' : 'Create CA'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}

export default CreateCA;
