import { describe, expect, it } from 'vitest';
import { buildAuthorityTree, outlivesAuthority, type CertificateSummary } from './validity';

const ca = (id: string, name: string, expiresAt: string, parentCaId: string | null = null) => ({
  id,
  name,
  expiresAt,
  parentCaId,
});
const cert = (id: string, caId: string | null, expiresAt: string | null): CertificateSummary => ({
  id,
  name: id,
  certificateAuthorityId: caId,
  expiresAt,
});

describe('outlivesAuthority', () => {
  it('flags a certificate that expires after its authority', () => {
    expect(outlivesAuthority('2027-09-23T00:00:00Z', '2027-05-01T00:00:00Z'), 'later expiry').toBe(
      true,
    );
  });

  it('does not flag a certificate that expires with or before its authority', () => {
    expect(outlivesAuthority('2027-05-01T00:00:00Z', '2027-05-01T00:00:00Z'), 'same day').toBe(
      false,
    );
    expect(outlivesAuthority('2027-01-01T00:00:00Z', '2027-05-01T00:00:00Z'), 'earlier').toBe(
      false,
    );
  });

  it('does not flag unknown or unparseable dates', () => {
    expect(outlivesAuthority(null, '2027-05-01T00:00:00Z'), 'missing expiry').toBe(false);
    expect(outlivesAuthority('soon', '2027-05-01T00:00:00Z'), 'bad date').toBe(false);
  });
});

describe('buildAuthorityTree', () => {
  const authorities = [
    ca('old', 'Old Root CA', '2027-05-01T00:00:00Z'),
    ca('int', 'Intermediate', '2028-01-01T00:00:00Z', 'g26'),
    ca('g26', 'Root CA 2026', '2031-09-17T00:00:00Z'),
  ];
  const certificates = [
    cert('a', 'old', '2027-09-23T00:00:00Z'),
    cert('b', 'old', '2027-04-01T00:00:00Z'),
    cert('c', 'g26', '2027-10-09T00:00:00Z'),
    cert('self', null, '2030-01-01T00:00:00Z'),
  ];

  it('orders roots by name with intermediates under their parent', () => {
    const tree = buildAuthorityTree(authorities, certificates);
    expect(
      tree.map((n) => [n.authority.id, n.depth]),
      'depth-first order',
    ).toEqual([
      ['old', 0],
      ['g26', 0],
      ['int', 1],
    ]);
  });

  it('counts issued certificates and lists the ones that outlive the authority', () => {
    const old = buildAuthorityTree(authorities, certificates).find((n) => n.authority.id === 'old');
    expect(old?.certificateCount, 'certificates issued by Old Root CA').toBe(2);
    expect(
      old?.outliving.map((c) => c.id),
      'outliving certificates',
    ).toEqual(['a']);
  });

  it('shows an authority as a root when its parent is not visible', () => {
    const tree = buildAuthorityTree([authorities[1]], []);
    expect(tree[0]?.depth, 'orphaned intermediate depth').toBe(0);
  });
});
