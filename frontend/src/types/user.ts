export type Role = 'admin' | 'operator' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  totpEnabled: boolean;
  /** Passkeys registered as a second factor. Missing on a user stored before passkeys existed. */
  passkeyCount?: number;
  createdAt: string;
}

/** True when anything beyond the password protects the account. */
export function hasTwoFactor(user: Pick<User, 'totpEnabled' | 'passkeyCount'> | null | undefined) {
  return !!user && (user.totpEnabled || (user.passkeyCount ?? 0) > 0);
}
