// Rules behind the new-certificate preview: where the certificate ends, whether it would outlive
// its authority, and what to offer instead.

import { daysUntil } from './timeline';

const DAY_MS = 86_400_000;

export interface AuthorityChoice {
  id: string;
  name: string;
  expiresAt: string;
}

export interface Preview {
  end: Date;
  /** First expiry alert, 30 days before the end. */
  firstAlert: Date;
  /** Days the authority has left, or null for self-signed. */
  authorityDays: number | null;
  /** The certificate would stay valid after its authority ends. */
  outlives: boolean;
  outlivesBy: number;
  /** Validity that fits inside the authority, when shortening can help. */
  fitDays: number | null;
  /** A different authority that lasts long enough, when there is one. */
  alternative: AuthorityChoice | null;
}

export function previewFor(
  today: Date,
  days: number,
  authority: AuthorityChoice | null,
  authorities: AuthorityChoice[],
): Preview {
  const end = new Date(today.getTime() + days * DAY_MS);
  const firstAlert = new Date(end.getTime() - 30 * DAY_MS);
  if (!authority) {
    return {
      end,
      firstAlert,
      authorityDays: null,
      outlives: false,
      outlivesBy: 0,
      fitDays: null,
      alternative: null,
    };
  }
  const authorityDays = daysUntil(authority.expiresAt, today);
  const outlives = days > authorityDays;
  const alternative = outlives
    ? (authorities
        .filter((a) => a.id !== authority.id && daysUntil(a.expiresAt, today) >= days)
        .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0] ?? null)
    : null;
  return {
    end,
    firstAlert,
    authorityDays,
    outlives,
    outlivesBy: outlives ? days - authorityDays : 0,
    fitDays: outlives && authorityDays > 0 ? authorityDays : null,
    alternative,
  };
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

/** Splits one list of alternative names into the DNS names and IP addresses the API expects. */
export function splitAltNames(names: string[]): { dnsNames: string[]; ipAddresses: string[] } {
  const dnsNames: string[] = [];
  const ipAddresses: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    if (IPV4.test(name) || (name.includes(':') && IPV6.test(name))) ipAddresses.push(name);
    else dnsNames.push(name);
  }
  return { dnsNames, ipAddresses };
}
