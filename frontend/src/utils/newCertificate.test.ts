import { describe, expect, it } from 'vitest';
import { previewFor, splitAltNames } from './newCertificate';

const today = new Date('2026-10-18T12:00:00Z');
const old = { id: 'old', name: 'Old Root CA', expiresAt: '2027-05-01T00:00:00Z' };
const fresh = { id: 'new', name: 'Root CA 2026', expiresAt: '2031-09-17T00:00:00Z' };
const lapsed = { id: 'gone', name: 'Lapsed CA', expiresAt: '2026-01-01T00:00:00Z' };

describe('previewFor', () => {
  it('fits a certificate that ends before its authority', () => {
    const p = previewFor(today, 90, old, [old, fresh]);
    expect(p.outlives, 'within authority').toBe(false);
    expect(p.authorityDays, 'authority days left').toBe(195);
    expect(p.alternative, 'no alternative needed').toBeNull();
  });

  it('warns when the certificate would outlive its authority and offers both fixes', () => {
    const p = previewFor(today, 365, old, [old, fresh]);
    expect(p.outlives, 'outlives').toBe(true);
    expect(p.outlivesBy, 'days past the authority').toBe(170);
    expect(p.fitDays, 'shorten to fit').toBe(195);
    expect(p.alternative?.id, 'longer authority').toBe('new');
  });

  it('offers no shortening when the authority has already ended', () => {
    const p = previewFor(today, 30, lapsed, [lapsed]);
    expect(p.outlives, 'expired authority').toBe(true);
    expect(p.fitDays, 'nothing fits').toBeNull();
    expect(p.alternative, 'no other authority').toBeNull();
  });

  it('has no authority checks for self-signed certificates', () => {
    const p = previewFor(today, 3650, null, [old]);
    expect(p.outlives, 'self-signed').toBe(false);
    expect(p.end.toISOString().slice(0, 10), 'ten years on').toBe('2036-10-15');
    expect(p.firstAlert.toISOString().slice(0, 10), 'alert 30 days before').toBe('2036-09-15');
  });
});

describe('splitAltNames', () => {
  it('sorts names into DNS names and IP addresses', () => {
    expect(splitAltNames(['nas.home.arpa', '10.0.0.5', ' fd00::1 ', '', '*.lab']), 'mixed').toEqual(
      {
        dnsNames: ['nas.home.arpa', '*.lab'],
        ipAddresses: ['10.0.0.5', 'fd00::1'],
      },
    );
  });

  it('keeps an out-of-range dotted quad as a name, not an address', () => {
    expect(splitAltNames(['300.1.1.1']).ipAddresses, 'invalid IPv4').toEqual([]);
  });
});
