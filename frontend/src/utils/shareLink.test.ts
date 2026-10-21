import { describe, expect, it } from 'vitest';
import { looksLikeEmail, shareExpiryWords } from './shareLink';

describe('shareExpiryWords', () => {
  it('rounds to whole minutes and never says "0 minutes"', () => {
    expect(shareExpiryWords(15 * 60_000), 'fresh link').toBe('expires in 15 minutes');
    expect(shareExpiryWords(15 * 60_000 - 800), 'a moment after creation').toBe(
      'expires in 15 minutes',
    );
    expect(shareExpiryWords(80_000), 'about a minute').toBe('expires in 1 minute');
    expect(shareExpiryWords(59_000), 'last minute').toBe('expires in under a minute');
    expect(shareExpiryWords(0), 'at expiry').toBe('expired');
  });
});

describe('looksLikeEmail', () => {
  it('accepts a plain address and rejects obvious mistakes', () => {
    expect(looksLikeEmail(' ops@example.com '), 'address with spaces around').toBe(true);
    expect(looksLikeEmail('ops@example'), 'no domain suffix').toBe(false);
    expect(looksLikeEmail('ops example.com'), 'no at sign').toBe(false);
  });
});
