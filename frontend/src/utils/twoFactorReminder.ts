// The "turn on two-factor" reminder shown after signing in, for accounts without it. It can be
// put off for a week; that choice lives in this browser only.

export const REMINDER_SNOOZE_MS = 7 * 86_400_000;
const SNOOZE_KEY = 'glcert-2fa-reminder-until';
const SIGNED_IN_KEY = 'glcert-just-signed-in';

/** True when the reminder should show now: two-factor is off and no snooze is running. */
export function shouldRemind(
  twoFactorOn: boolean,
  snoozedUntil: number | null,
  now: number,
): boolean {
  return !twoFactorOn && (snoozedUntil === null || now >= snoozedUntil);
}

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string | null) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Storage can be blocked (private windows); the reminder then simply shows again.
  }
}

export function snoozedUntil(): number | null {
  const value = Number(read(localStorage, SNOOZE_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function snoozeReminder(now = Date.now()) {
  write(localStorage, SNOOZE_KEY, String(now + REMINDER_SNOOZE_MS));
}

/** Marks a fresh sign-in, so the reminder appears once per sign-in and not on every reload. */
export function markSignedIn() {
  write(sessionStorage, SIGNED_IN_KEY, '1');
}

export function justSignedIn(): boolean {
  return read(sessionStorage, SIGNED_IN_KEY) === '1';
}

export function clearSignedIn() {
  write(sessionStorage, SIGNED_IN_KEY, null);
}
