import { describe, expect, it } from 'vitest';
import { auditKind, auditVerb, countsPerDay, dayKey, dayLabel, type AuditEntry } from './audit';

const entry = (createdAt: string, action = 'certificate.create'): AuditEntry => ({
  id: 1,
  userId: 'u',
  userEmail: 'admin@glcert.test',
  action,
  entityType: 'certificate',
  entityId: 'c',
  details: '',
  createdAt,
});

describe('auditKind', () => {
  it('reads the kind from the action prefix and files the rest under system', () => {
    expect(auditKind('certificate.regenerate'), 'certificate').toBe('certificate');
    expect(auditKind('ca.permissions.update'), 'authority').toBe('ca');
    expect(auditKind('user.role_change'), 'user').toBe('user');
    expect(auditKind('backup.restore'), 'backup').toBe('system');
    expect(auditKind('factory_reset'), 'reset').toBe('system');
  });
});

describe('auditVerb', () => {
  it('words known actions and falls back to the raw name', () => {
    expect(auditVerb('ca.create'), 'known').toBe('created an authority');
    expect(auditVerb('share.send_email'), 'unknown').toBe('share send email');
  });
});

describe('countsPerDay', () => {
  it('counts entries per local day, oldest first, ending today', () => {
    const today = new Date(2026, 9, 18, 12);
    const days = countsPerDay(
      [
        entry(new Date(2026, 9, 18, 9).toISOString()),
        entry(new Date(2026, 9, 18, 10).toISOString()),
        entry(new Date(2026, 9, 16, 8).toISOString()),
      ],
      today,
      3,
    );
    expect(days, 'three days').toEqual([
      { day: '2026-10-16', count: 1 },
      { day: '2026-10-17', count: 0 },
      { day: '2026-10-18', count: 2 },
    ]);
  });
});

describe('dayLabel', () => {
  it('says today and yesterday, then the weekday and date', () => {
    const today = new Date(2026, 9, 18, 12);
    expect(dayLabel(dayKey(today), today), 'today').toBe('Today');
    expect(dayLabel('2026-10-17', today), 'yesterday').toBe('Yesterday');
    expect(dayLabel('2026-10-16', today), 'earlier').toBe('Fri 16 Oct 2026');
  });
});
