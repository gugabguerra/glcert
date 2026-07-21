import { Group, Text, Progress } from '@mantine/core';
import { getPasswordStrength, type StrengthLevel } from '../utils/password';

const colorMap: Record<StrengthLevel, string> = {
  weak: 'red',
  fair: 'orange',
  good: 'blue',
  strong: 'teal',
};

export function PasswordStrengthIndicator({ password }: { password: string }) {
  if (!password) return null;

  const { level, label } = getPasswordStrength(password);
  const color = colorMap[level];
  const percent = level === 'weak' ? 25 : level === 'fair' ? 50 : level === 'good' ? 75 : 100;

  return (
    <Group gap="xs" mt={4}>
      <Progress
        value={percent}
        color={color}
        size={4}
        radius="xl"
        style={{ flex: 1 }}
      />
      <Text size="xs" c={color} fw={500} style={{ whiteSpace: 'nowrap' }}>
        {label}
      </Text>
    </Group>
  );
}
