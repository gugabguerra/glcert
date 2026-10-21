// Validity rules shared by the sidebar, timeline, details panel and new-certificate preview.

export interface AuthoritySummary {
  id: string;
  name: string;
  expiresAt: string;
  parentCaId: string | null;
}

export interface CertificateSummary {
  id: string;
  name: string;
  certificateAuthorityId: string | null;
  expiresAt: string | null;
}

/** True when the certificate stays valid after its issuing authority has expired. */
export function outlivesAuthority(certExpiresAt: string | null, caExpiresAt: string): boolean {
  if (!certExpiresAt) return false;
  const cert = Date.parse(certExpiresAt);
  const ca = Date.parse(caExpiresAt);
  if (Number.isNaN(cert) || Number.isNaN(ca)) return false;
  return cert > ca;
}

export interface AuthorityNode {
  authority: AuthoritySummary;
  depth: number;
  certificateCount: number;
  /** Certificates issued by this authority that expire after it does. */
  outliving: CertificateSummary[];
}

/**
 * Flattens authorities into display order: each root followed by its intermediates, depth-first,
 * siblings by name. An authority whose parent is not visible (per-CA permissions) shows as a root.
 */
export function buildAuthorityTree(
  authorities: AuthoritySummary[],
  certificates: CertificateSummary[],
): AuthorityNode[] {
  const visible = new Set(authorities.map((a) => a.id));
  const children = new Map<string | null, AuthoritySummary[]>();
  for (const a of authorities) {
    const parent = a.parentCaId && visible.has(a.parentCaId) ? a.parentCaId : null;
    children.set(parent, [...(children.get(parent) ?? []), a]);
  }

  const nodes: AuthorityNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = [...(children.get(parent) ?? [])].sort((x, y) => x.name.localeCompare(y.name));
    for (const authority of list) {
      const issued = certificates.filter((c) => c.certificateAuthorityId === authority.id);
      nodes.push({
        authority,
        depth,
        certificateCount: issued.length,
        outliving: issued.filter((c) => outlivesAuthority(c.expiresAt, authority.expiresAt)),
      });
      walk(authority.id, depth + 1);
    }
  };
  walk(null, 0);
  return nodes;
}
