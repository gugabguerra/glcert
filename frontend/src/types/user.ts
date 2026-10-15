export type Role = 'admin' | 'operator' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  totpEnabled: boolean;
  createdAt: string;
}
