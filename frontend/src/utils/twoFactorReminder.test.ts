import { describe, expect, it } from 'vitest';
import { REMINDER_SNOOZE_MS, shouldRemind } from './twoFactorReminder';

describe('shouldRemind', () => {
  const now = Date.UTC(2026, 9, 21, 12);

  it('reminds when two-factor is off and nothing is snoozed', () => {
    expect(shouldRemind(false, null, now), 'no snooze').toBe(true);
  });

  it('stays quiet while a week-long snooze runs, then reminds again', () => {
    const until = now + REMINDER_SNOOZE_MS;
    expect(shouldRemind(false, until, now + 6 * 86_400_000), 'day six').toBe(false);
    expect(shouldRemind(false, until, until), 'snooze over').toBe(true);
  });

  it('never reminds when two-factor is on', () => {
    expect(shouldRemind(true, null, now), 'two-factor on').toBe(false);
  });
});
