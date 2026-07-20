import { useCallback, useState, useEffect } from 'react';
import { Title, TextInput, Select, NumberInput, Button, Stack, Group, Textarea, Text, TagsInput, Combobox, InputBase, useCombobox, CloseButton, Divider, ThemeIcon } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authFetchJson } from '../api';
import { IconCertificate } from '@tabler/icons-react';

interface CA {
  id: string;
  name: string;
  parentCaId?: string | null;
}

interface Settings {
  organization: string;
  country: string;
  state: string;
  city: string;
  defaultKeyAlgorithm: string;
  defaultRSAKeySize: number;
  defaultValidityDays: number;
}

interface CertGroup {
  name: string;
  count: number;
}

function CreateCertificate() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: cas = [] } = useQuery<CA[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
  });

  const { data: settings } = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => authFetchJson('/api/settings'),
  });

  const { data: groups = [] } = useQuery<CertGroup[]>({
    queryKey: ['certGroups'],
    queryFn: () => authFetchJson('/api/certificates/groups'),
  });

  const form = useForm({
    initialValues: {
      name: '',
      description: '',
      commonName: '',
      type: 'server',
      certificateAuthorityId: null as string | null,
      dnsNames: [] as string[],
      ipAddresses: [] as string[],
      organization: '',
      country: '',
      state: '',
      city: '',
      keyAlgorithm: 'rsa',
      rsaKeySize: 2048,
      validityDays: 365,
      groupName: '',
    },
  });

  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });

  const [search, setSearch] = useState('');

  const groupNames = groups.map((g) => g.name).filter((n) => n !== '');
  const exactMatch = groupNames.some((name) => name === search);
  const filteredGroups = exactMatch
    ? groupNames
    : groupNames.filter((name) => name.toLowerCase().includes(search.toLowerCase().trim()));

  useEffect(() => {
    setSearch(form.values.groupName);
  }, [form.values.groupName]);

  const clearGroup = useCallback(() => {
    form.setFieldValue('groupName', '');
    setSearch('');
  }, [form]);

  if (settings && form.values.organization === '' && settings.organization !== '') {
    form.setValues({
      organization: settings.organization,
      country: settings.country,
      state: settings.state,
      city: settings.city,
      keyAlgorithm: settings.defaultKeyAlgorithm || 'rsa',
      rsaKeySize: settings.defaultRSAKeySize || 2048,
      validityDays: settings.defaultValidityDays || 365,
    });
  }

  // Build hierarchical CA options with indentation
  const caOptions = (() => {
    const childrenMap = new Map<string, CA[]>();
    const roots: CA[] = [];

    for (const ca of cas) {
      if (ca.parentCaId) {
        const siblings = childrenMap.get(ca.parentCaId) || [];
        siblings.push(ca);
        childrenMap.set(ca.parentCaId, siblings);
      } else {
        roots.push(ca);
      }
    }

    const result: { value: string; label: string }[] = [];
    function addNodes(nodes: CA[], depth: number) {
      for (const ca of nodes) {
        const indent = '  '.repeat(depth);
        const prefix = depth > 0 ? '└ ' : '';
        result.push({ value: ca.id, label: `${indent}${prefix}${ca.name}` });
        const children = childrenMap.get(ca.id) || [];
        if (children.length > 0) addNodes(children, depth + 1);
      }
    }
    addNodes(roots, 0);
    return result;
  })();
  const hasCA = cas.length > 0;

  const typeData = hasCA
    ? [
        { value: 'server', label: 'Server' },
        { value: 'client', label: 'Client' },
        { value: 'serverclient', label: 'Server + Client' },
        { value: 'selfsigned', label: 'Self-Signed' },
      ]
    : [
        { value: 'selfsigned', label: 'Self-Signed' },
      ];

  const mutation = useMutation({
    mutationFn: (values: typeof form.values) => {
      const payload = {
        ...values,
        certificateAuthorityId: values.certificateAuthorityId || null,
      };
      return authFetchJson('/api/certificates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      queryClient.invalidateQueries({ queryKey: ['certGroups'] });
      navigate('/certificates');
    },
  });

  const isSelfSigned = form.values.type === 'selfsigned';

  return (
    <Stack>
      <Title>
        <ThemeIcon size="lg" variant="light" color="blue" mr="md">
          <IconCertificate size={24} />
        </ThemeIcon>
        Create Certificate Authority
      </Title>

      <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
        <Stack gap="md">

          <TextInput
            label="Display Name"
            placeholder="docker-api-01"
            required
           
            {...form.getInputProps('name')}
          />
          <Textarea
            label="Description"
            placeholder="Optional description"
           
            {...form.getInputProps('description')}
          />
          <Combobox
            store={combobox}
            withinPortal
            onOptionSubmit={(val) => {
              if (val === '$create') {
                form.setFieldValue('groupName', search);
              } else {
                form.setFieldValue('groupName', val);
                setSearch(val);
              }
              combobox.closeDropdown();
            }}
          >
            <Combobox.Target>
              <InputBase
                label="Group"
                placeholder="e.g., web-servers, devops"
                description="Optional group to organize certificates"
                rightSection={
                  form.values.groupName ? (
                    <CloseButton size="sm" onClick={clearGroup} />
                  ) : (
                    <Combobox.Chevron />
                  )
                }
                rightSectionPointerEvents="none"
                value={search}
                onChange={(event) => {
                  combobox.openDropdown();
                  combobox.updateSelectedOptionIndex();
                  setSearch(event.currentTarget.value);
                }}
                onClick={() => combobox.openDropdown()}
                onBlur={() => {
                  combobox.closeDropdown();
                  setSearch(form.values.groupName || '');
                }}
              />
            </Combobox.Target>
            <Combobox.Dropdown>
              <Combobox.Options>
                {filteredGroups.map((name) => (
                  <Combobox.Option value={name} key={name}>
                    {name}
                  </Combobox.Option>
                ))}
                {!exactMatch && search.trim().length > 0 && (
                  <Combobox.Option value="$create">+ Create "{search}"</Combobox.Option>
                )}
              </Combobox.Options>
            </Combobox.Dropdown>
          </Combobox>

          <Divider variant="dashed" label="Certificate details" labelPosition="center" />

          <Select
            label="Type"
            data={typeData}
            description={!hasCA ? 'Create a CA first to issue Server or Client certificates' : undefined}
            {...form.getInputProps('type')}
          />
          {!isSelfSigned && (
            <Select
              label="Certificate Authority"
              data={caOptions}
              placeholder="Select a CA"
              required
              searchable
              {...form.getInputProps('certificateAuthorityId')}
            />
          )}
          <TextInput
            label="Common Name"
            placeholder="docker-api-01.mycompany.com"
            required
           
            {...form.getInputProps('commonName')}
          />

          <TagsInput
            label="DNS Names"
            placeholder="Add DNS name and press Enter"
            description="e.g., docker-api-01.mycompany.com, docker-api.mycompany.com"
            {...form.getInputProps('dnsNames')}
          />

          <TagsInput
            label="IP Addresses"
            placeholder="Add IP address and press Enter"
            description="e.g., 192.168.1.100"
            {...form.getInputProps('ipAddresses')}
          />

          <TextInput
            label="Organization"
            placeholder="My Company Department"
           
            {...form.getInputProps('organization')}
          />
          <Group grow>
            <TextInput label="Country" placeholder="US" {...form.getInputProps('country')} />
            <TextInput label="State" placeholder="California" {...form.getInputProps('state')} />
            <TextInput label="City" placeholder="San Francisco" {...form.getInputProps('city')} />
          </Group>

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

          {mutation.isError && (
            <Text c="red">Failed to create certificate. Please try again.</Text>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={() => navigate('/certificates')}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Create Certificate
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}

export default CreateCertificate;
