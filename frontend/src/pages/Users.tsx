import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Modal, MultiSelect, PasswordInput, Stack, TextInput } from '@mantine/core';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { authFetch, authFetchJson } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { PasswordStrengthIndicator } from '../components/PasswordStrengthIndicator';
import { DeleteDialog } from '../components/timeline/DetailsPanel';
import type { AuthorityListItem } from '../types/pki';
import { hasTwoFactor } from '../types/user';
import classes from './Admin.module.css';
import users from './Users.module.css';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  totpEnabled: boolean;
  passkeyCount?: number;
  createdAt: string;
}

const ROLES = [
  { value: 'admin', label: 'Admin', note: 'Everything' },
  { value: 'operator', label: 'Operator', note: 'Works on assigned authorities' },
  { value: 'viewer', label: 'Viewer', note: 'Receives shared certificates' },
];

// The README's role table. The server enforces it; this only explains it.
const MATRIX: [string, string, string, string][] = [
  ['See the timeline', 'Yes', 'Yes', 'No'],
  ['See or download authorities', 'Yes', 'Assigned', 'No'],
  ['See or download certificates', 'Yes', 'Assigned', 'Shared'],
  ['Create or delete authorities', 'Yes', 'No', 'No'],
  ['Import authorities', 'Yes', 'No', 'No'],
  ['Create or delete certificates', 'Yes', 'Assigned', 'No'],
  ['Create share links', 'Yes', 'Yes', 'Yes'],
  ['Manage users', 'Yes', 'No', 'No'],
  ['See the audit log', 'Yes', 'No', 'No'],
  ['Back up, restore or reset', 'Yes', 'No', 'No'],
  ['Change settings', 'Yes', 'No', 'No'],
];

const roleLabel = (role: string) => ROLES.find((r) => r.value === role)?.label ?? role;

async function setGrants(caIds: string[], userId: string, grant: boolean) {
  for (const caId of caIds) {
    const current = await authFetchJson<{ userIds: string[] }>(`/api/ca/${caId}/permissions`);
    const ids = new Set(current.userIds ?? []);
    if (grant) ids.add(userId);
    else ids.delete(userId);
    await authFetchJson(`/api/ca/${caId}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [...ids] }),
    });
  }
}

/** Who can sign in and what each person can do. Admin only; the server enforces it. */
function Users() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const { data: list = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => authFetchJson('/api/users'),
  });
  const { data: authorities = [] } = useQuery<AuthorityListItem[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
  });
  // Grants live per authority, so collect them to show each person's authorities.
  const grants = useQueries({
    queries: authorities.map((a) => ({
      queryKey: ['caPermissions', a.id],
      queryFn: () => authFetchJson<{ userIds: string[] }>(`/api/ca/${a.id}/permissions`),
    })),
  });
  const byUser = useMemo(() => {
    const map = new Map<string, string[]>();
    grants.forEach((g, i) => {
      for (const id of g.data?.userIds ?? [])
        map.set(id, [...(map.get(id) ?? []), authorities[i].id]);
    });
    return map;
  }, [grants, authorities]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['caPermissions'] });
  };

  const remove = useMutation({
    mutationFn: async (u: User) => {
      const res = await authFetch(`/api/users/${u.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.text()) || 'Delete failed');
    },
    onSuccess: (_d, u) => {
      refresh();
      setDeleting(null);
      notifications.show({ message: `${u.name || u.email} can no longer sign in.` });
    },
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  });

  const nameOf = (id: string) => authorities.find((a) => a.id === id)?.name ?? 'Unknown';
  const authoritiesText = (u: User) => {
    if (u.role === 'admin') return 'All, as admin';
    const ids = byUser.get(u.id) ?? [];
    if (ids.length === 0) return u.role === 'viewer' ? 'Shared certificates only' : 'None yet';
    return ids.map(nameOf).join(', ');
  };

  return (
    <div className={classes.page}>
      <div className={classes.header}>
        <div>
          <h1 className={classes.title}>Users</h1>
          <div className="gl-second-line">Who can sign in, and what each person can do</div>
        </div>
        <Button leftSection={<IconPlus size={16} stroke={1.8} />} onClick={() => setAdding(true)}>
          Add user
        </Button>
      </div>

      {isLoading ? (
        <div className={classes.loading} aria-label="Loading" />
      ) : (
        <section className={`${classes.card} ${users.table}`} aria-label="Users">
          <div role="table" aria-label="Users">
            <div role="row" className={`${users.row} ${users.head}`}>
              <span role="columnheader">Person</span>
              <span role="columnheader">Role</span>
              <span role="columnheader">Two-factor</span>
              <span role="columnheader">Authorities</span>
              <span role="columnheader" className={users.actions}>
                Actions
              </span>
            </div>
            {list.map((u) => {
              const you = u.id === me?.id;
              return (
                <div role="row" key={u.id} className={users.row}>
                  <div role="cell" className={users.person}>
                    <span className={classes.avatar} aria-hidden="true">
                      {(u.name || u.email).charAt(0).toUpperCase()}
                    </span>
                    <span className={users.who}>
                      <span className={users.name}>
                        {u.name || u.email}
                        {you && <span className="gl-second-line"> (you)</span>}
                      </span>
                      {u.name && (
                        <span className="gl-literal" style={{ color: 'var(--gl-text-muted)' }}>
                          {u.email}
                        </span>
                      )}
                    </span>
                  </div>
                  <span role="cell">{roleLabel(u.role)}</span>
                  <span
                    role="cell"
                    style={{
                      color: hasTwoFactor(u) ? 'var(--gl-text-soft)' : 'var(--gl-text-muted)',
                    }}
                  >
                    {hasTwoFactor(u) ? 'On' : 'Off'}
                  </span>
                  <span role="cell" className={users.authorities}>
                    {authoritiesText(u)}
                  </span>
                  <span role="cell" className={users.actions}>
                    {you ? (
                      <Link to="/profile">Your account</Link>
                    ) : (
                      <>
                        <Button
                          variant="subtle"
                          px={8}
                          aria-label={`Edit ${u.name || u.email}`}
                          onClick={() => setEditing(u)}
                        >
                          <IconEdit size={16} stroke={1.8} />
                        </Button>
                        <Button
                          variant="subtle"
                          color="red"
                          px={8}
                          aria-label={`Delete ${u.name || u.email}`}
                          onClick={() => setDeleting(u)}
                        >
                          <IconTrash size={16} stroke={1.8} />
                        </Button>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!isLoading && list.length === 1 && (
        <div className={users.hint}>
          <p className={classes.body}>
            Only you so far. Add an operator to let someone issue certificates on the authorities
            you choose, or a viewer who only receives certificates you share.
          </p>
          <Button
            variant="default"
            onClick={() => setAdding(true)}
            style={{ alignSelf: 'flex-start' }}
          >
            Add an operator
          </Button>
        </div>
      )}

      <section
        aria-labelledby="roles-h"
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <div className={classes.sectionHeader}>
          <h2 id="roles-h" className="gl-section-label">
            What each role can do
          </h2>
          <span className={classes.rule} />
        </div>
        <div className={`${classes.card} ${users.matrixWrap}`}>
          <div role="table" aria-labelledby="roles-h" className={users.matrix}>
            <div role="row" className={users.matrixRow}>
              <span role="columnheader" />
              {ROLES.map((r) => (
                <span role="columnheader" key={r.value} className={users.matrixHead}>
                  <span>{r.label}</span>
                  <span className="gl-second-line">{r.note}</span>
                </span>
              ))}
            </div>
            {MATRIX.map(([action, ...cells]) => (
              <div role="row" key={action} className={users.matrixRow}>
                <span role="rowheader">{action}</span>
                {cells.map((c, i) => (
                  <span
                    role="cell"
                    key={i}
                    className={users.matrixCell}
                    data-no={c === 'No' || undefined}
                  >
                    {c === 'Yes' ? (
                      <>
                        <IconCheck size={16} stroke={1.8} aria-hidden="true" />
                        <span className={users.srOnly}>Yes</span>
                      </>
                    ) : (
                      c
                    )}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
        <p className={classes.muted}>
          The server checks these rules on every request, including for authorities reached through
          a parent.
        </p>
      </section>

      <UserDialog
        key={editing?.id ?? (adding ? 'new' : 'closed')}
        opened={adding || !!editing}
        user={editing}
        authorities={authorities}
        grantedIds={editing ? (byUser.get(editing.id) ?? []) : []}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSaved={refresh}
      />

      <DeleteDialog
        opened={!!deleting}
        name={deleting ? deleting.name || deleting.email : ''}
        text="They can no longer sign in, and their sessions end now. Certificates and authorities stay. This cannot be undone."
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}

function UserDialog({
  opened,
  user,
  authorities,
  grantedIds,
  onClose,
  onSaved,
}: {
  opened: boolean;
  user: User | null;
  authorities: AuthorityListItem[];
  grantedIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!user;
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(user?.role ?? 'operator');
  const [caIds, setCaIds] = useState<string[]>(grantedIds);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      setError('');
      if (password && password !== confirm) throw new Error('The passwords do not match.');
      let id = user?.id;
      if (!editing) {
        const created = await authFetchJson<User>('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), email: email.trim(), password, role }),
        });
        id = created.id;
      } else {
        await authFetchJson(`/api/users/${user!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), role }),
        });
        if (password) {
          const res = await authFetch(`/api/users/${user!.id}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          });
          if (!res.ok) throw new Error((await res.text()) || 'Could not set the password.');
        }
      }
      // Admins can use every authority, so they carry no grants.
      const wanted = role === 'admin' ? [] : caIds;
      await setGrants(
        wanted.filter((c) => !grantedIds.includes(c)),
        id!,
        true,
      );
      await setGrants(
        grantedIds.filter((c) => !wanted.includes(c)),
        id!,
        false,
      );
    },
    onSuccess: () => {
      onSaved();
      onClose();
      notifications.show({
        message: editing
          ? `${name.trim() || user!.email} updated.`
          : `${name.trim() || email.trim()} can now sign in.`,
      });
    },
    onError: (e: Error) => setError(e.message || 'Could not save.'),
  });

  const missing = editing
    ? !!password && (!confirm || password !== confirm)
    : !email.trim() || !password || password !== confirm;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? `Edit ${user!.name || user!.email}` : 'Add user'}
      size={420}
    >
      <Stack gap="md">
        <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        {!editing && (
          <TextInput
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
        )}
        <div
          role="radiogroup"
          aria-label="Role"
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <span className="gl-second-line" style={{ fontWeight: 400 }}>
            Role
          </span>
          <div className={classes.segments} style={{ alignSelf: 'flex-start' }}>
            {ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={role === r.value}
                className={classes.segment}
                onClick={() => setRole(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <span className="gl-second-line">{ROLES.find((r) => r.value === role)!.note}</span>
        </div>
        {role !== 'admin' && authorities.length > 0 && (
          <MultiSelect
            label="Authorities"
            description={
              role === 'operator'
                ? 'They can issue certificates from these.'
                : 'They can see these.'
            }
            placeholder={caIds.length ? undefined : 'None'}
            data={authorities.map((a) => ({ value: a.id, label: a.name }))}
            value={caIds}
            onChange={setCaIds}
            searchable
          />
        )}
        <PasswordInput
          label={editing ? 'New password' : 'Password'}
          description={
            editing
              ? 'Leave empty to keep the current one. Setting one signs them out everywhere.'
              : undefined
          }
          required={!editing}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        {password && <PasswordStrengthIndicator password={password} />}
        {(password || !editing) && (
          <PasswordInput
            label="Confirm password"
            required={!editing}
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
          />
        )}
        {error && <p className={classes.error}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={missing} onClick={() => save.mutate()}>
            {editing ? 'Save' : 'Add user'}
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}

export default Users;
