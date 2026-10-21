/** Share links live for 15 minutes (see docs/SECURITY.md). */
export const SHARE_LINK_LIFETIME_MS = 15 * 60_000;

/** "expires in 15 minutes", "expires in under a minute", or "expired", the way people say it. */
export function shareExpiryWords(remainingMs: number): string {
  if (remainingMs <= 0) return 'expired';
  if (remainingMs < 60_000) return 'expires in under a minute';
  // Round to the nearest minute, as people say it: a fresh link reads 15, not 14.
  const minutes = Math.max(1, Math.round(remainingMs / 60_000));
  return minutes === 1 ? 'expires in 1 minute' : `expires in ${minutes} minutes`;
}

/** A loose check before sending; the server does the real validation. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
