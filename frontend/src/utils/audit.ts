// Audit log grouping and wording for the redesigned audit page.

export interface AuditEntry {
  id: number;
  userId: string | null;
  userEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: string;
  createdAt: string;
}

export type AuditKind = 'certificate' | 'ca' | 'user' | 'settings' | 'system';

export const AUDIT_KINDS: { value: AuditKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'certificate', label: 'Certificates' },
  { value: 'ca', label: 'Authorities' },
  { value: 'user', label: 'Users' },
  { value: 'settings', label: 'Settings' },
  { value: 'system', label: 'Backup and reset' },
];

/** The kind of change, from the action's prefix ("certificate.create" is a certificate). */
export function auditKind(action: string): AuditKind {
  const prefix = action.split('.')[0];
  if (prefix === 'certificate' || prefix === 'ca' || prefix === 'user' || prefix === 'settings')
    return prefix;
  return 'system';
}

const LABELS: Record<string, string> = {
  'certificate.create': 'created a certificate',
  'certificate.delete': 'deleted a certificate',
  'certificate.regenerate': 'regenerated a certificate',
  'certificate.import': 'imported a certificate',
  'ca.create': 'created an authority',
  'ca.delete': 'deleted an authority',
  'ca.import': 'imported an authority',
  'ca.permissions.update': 'changed who can use an authority',
  'user.create': 'added a user',
  'user.delete': 'removed a user',
  'user.role_change': 'changed a role',
  'user.password_reset': 'reset a password',
  'settings.update': 'changed settings',
  factory_reset: 'ran a factory reset',
  'backup.create': 'created a backup',
  'backup.restore': 'restored a backup',
};

/** "created a certificate"; unknown actions fall back to their raw name. */
export function auditVerb(action: string): string {
  return LABELS[action] ?? action.replace(/[._]/g, ' ');
}

/** Local calendar day key, "2026-10-18". */
export function dayKey(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Counts per local day for the last `days` days, oldest first, ending today. */
export function countsPerDay(
  entries: AuditEntry[],
  today: Date,
  days: number,
): { day: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries)
    counts.set(dayKey(e.createdAt), (counts.get(dayKey(e.createdAt)) ?? 0) + 1);
  const result: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    result.push({ day: dayKey(d), count: counts.get(dayKey(d)) ?? 0 });
  }
  return result;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Today", "Yesterday", or "Fri 16 Oct 2026" for a day key. */
export function dayLabel(key: string, today: Date): string {
  if (key === dayKey(today)) return 'Today';
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (key === dayKey(yesterday)) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}
