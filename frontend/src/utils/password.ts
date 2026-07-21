export type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordStrength {
  score: number;
  level: StrengthLevel;
  label: string;
}

export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, level: 'weak', label: 'Weak' };
  }

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  let level: StrengthLevel;
  let label: string;
  if (score <= 2) {
    level = 'weak';
    label = 'Weak';
  } else if (score <= 4) {
    level = 'fair';
    label = 'Fair';
  } else if (score === 5) {
    level = 'good';
    label = 'Good';
  } else {
    level = 'strong';
    label = 'Strong';
  }

  return { score, level, label };
}
