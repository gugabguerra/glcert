// List shapes from GET /api/ca and GET /api/certificates (both filtered by the server to what the
// user may see).

export interface AuthorityListItem {
  id: string;
  name: string;
  description: string;
  subject: string;
  createdAt: string;
  expiresAt: string;
  currentVersion: number;
  imported: boolean;
  parentCaId: string | null;
}

export interface CertificateListItem {
  id: string;
  name: string;
  type: string;
  certificateAuthorityId: string | null;
  caName: string;
  groupName: string;
  currentVersion: number;
  createdAt: string;
  expiresAt: string | null;
  /** When the current version was issued. */
  issuedAt: string | null;
}

export const certificateTypeLabel: Record<string, string> = {
  server: 'Server certificate',
  client: 'Client certificate',
  serverclient: 'Server and client certificate',
  selfsigned: 'Self-signed certificate',
};
