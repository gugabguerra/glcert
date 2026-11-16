import { useState } from 'react';
import { Button, Modal, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconFingerprint } from '@tabler/icons-react';
import { authFetch, authFetchJson } from '../api/client';
import { copyToClipboard } from '../utils/clipboard';
import {
  createPasskey,
  passkeyErrorMessage,
  passkeysSupported,
  type CreationOptionsJSON,
} from '../utils/passkey';
import { formatDate } from '../utils/timeline';
import classes from '../pages/Admin.module.css';
import s from '../pages/Settings.module.css';
import t from '../pages/TwoFactorSetup.module.css';

interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface PasskeyList {
  /** False when the server's address cannot host passkeys (plain HTTP, or a bare IP). */
  available: boolean;
  /** The one address the server accepts passkeys from. Empty when unavailable. */
  origin?: string;
  passkeys: Passkey[];
}

interface Registered {
  passkey: Passkey;
  /** Present only when the account had no unused backup codes. Shown once. */
  backupCodes?: string[];
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * The passkeys on your account: list, add, remove. A passkey is asked for after the password, in
 * place of a code from the authenticator app.
 */
export function PasskeySettings({ onCountChange }: { onCountChange: (count: number) => void }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  const { data } = useQuery<PasskeyList>({
    queryKey: ['passkeys'],
    queryFn: () => authFetchJson('/api/passkeys'),
  });
  const passkeys = data?.passkeys ?? [];
  const supported = passkeysSupported();
  // The server checks the page address inside every passkey answer. Opened anywhere else (another
  // port counts), the browser would make a passkey the server then refuses.
  const elsewhere = !!data?.origin && data.origin !== window.location.origin;
  const blocked = !data
    ? ''
    : !data.available
      ? 'Passkeys need GLcert to be served over HTTPS at its public address (PUBLIC_URL).'
      : !supported
        ? 'This browser cannot use passkeys here. Open GLcert in a browser over HTTPS.'
        : elsewhere
          ? `Passkeys work only at ${data.origin}. Open GLcert there, or set PUBLIC_URL to this address.`
          : '';

  const changed = (count: number) => {
    queryClient.invalidateQueries({ queryKey: ['passkeys'] });
    onCountChange(count);
  };

  return (
    <>
      <div className={s.opRow}>
        <div className={s.opText}>
          <span
            className={s.switchTitle}
            style={{ color: passkeys.length ? 'var(--gl-success)' : 'var(--gl-text)' }}
          >
            {passkeys.length === 0
              ? 'No passkeys'
              : passkeys.length === 1
                ? '1 passkey'
                : `${passkeys.length} passkeys`}
          </span>
          <span className="gl-second-line">
            Your fingerprint, face, screen lock or a security key, in place of a code.
          </span>
        </div>
        <Button
          variant={passkeys.length ? 'default' : 'filled'}
          leftSection={<IconFingerprint size={16} stroke={1.8} aria-hidden="true" />}
          disabled={!data || !!blocked}
          onClick={() => setAdding(true)}
        >
          Add a passkey
        </Button>
      </div>
      {blocked && <p className={classes.muted}>{blocked}</p>}

      {passkeys.length > 0 && (
        <ul
          aria-label="Your passkeys"
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}
        >
          {passkeys.map((p) => (
            <li key={p.id} className={s.opRow}>
              <div className={s.opText} style={{ minWidth: 0 }}>
                <span className={s.switchTitle} style={{ overflowWrap: 'anywhere' }}>
                  {p.name}
                </span>
                <span className="gl-second-line">
                  Added {formatDate(p.createdAt)}
                  {p.lastUsedAt ? `, last used ${formatDate(p.lastUsedAt)}` : ', not used yet'}
                </span>
              </div>
              <Button color="red" variant="outline" size="xs" onClick={() => setRemoving(p)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AddDialog
        opened={adding}
        onClose={() => setAdding(false)}
        onDone={(result) => {
          setAdding(false);
          changed(passkeys.length + 1);
          if (result.backupCodes?.length) setCodes(result.backupCodes);
          else notifications.show({ message: 'Passkey added.' });
        }}
      />
      <RemoveDialog
        passkey={removing}
        last={passkeys.length === 1}
        onClose={() => setRemoving(null)}
        onDone={() => {
          setRemoving(null);
          changed(passkeys.length - 1);
          notifications.show({ message: 'Passkey removed.' });
        }}
      />
      <BackupCodesDialog codes={codes} onClose={() => setCodes(null)} />
    </>
  );
}

function AddDialog({
  opened,
  onClose,
  onDone,
}: {
  opened: boolean;
  onClose: () => void;
  onDone: (result: Registered) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const add = useMutation({
    mutationFn: async () => {
      const options = await authFetchJson<CreationOptionsJSON>(
        '/api/passkeys/register/begin',
        post({}),
      );
      const credential = await createPasskey(options);
      const res = await authFetch('/api/passkeys/register/finish', post({ name, credential }));
      if (!res.ok) throw new Error('The server did not accept that passkey. Try again.');
      return (await res.json()) as Registered;
    },
    onSuccess: (result) => {
      setName('');
      onDone(result);
    },
    // A DOMException comes from the browser's own prompt; anything else carries server text.
    onError: (err: Error) =>
      setError(err instanceof DOMException ? passkeyErrorMessage(err, 'create') : err.message),
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Add a passkey" size={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          add.mutate();
        }}
      >
        <Stack>
          <Text size="sm" c="var(--gl-text-soft)" fw={300}>
            Your browser will ask where to save it: this device, your phone, or a security key. You
            still type your password first when you sign in.
          </Text>
          <TextInput
            label="Name"
            description="So you can tell your passkeys apart."
            placeholder="Work laptop"
            maxLength={64}
            data-autofocus
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          {error && (
            <p className={classes.error} role="alert">
              {error}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending}>
              Continue
            </Button>
          </div>
        </Stack>
      </form>
    </Modal>
  );
}

function RemoveDialog({
  passkey,
  last,
  onClose,
  onDone,
}: {
  passkey: Passkey | null;
  last: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const remove = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/passkeys/${passkey?.id}/remove`, post({ password }));
      if (!res.ok)
        throw new Error(
          res.status === 403 ? 'That password is not right.' : 'Could not remove the passkey.',
        );
    },
    onSuccess: () => {
      setPassword('');
      onDone();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Modal opened={!!passkey} onClose={onClose} title="Remove this passkey?" size={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          remove.mutate();
        }}
      >
        <Stack>
          <Text size="sm" c="var(--gl-text-soft)" fw={300}>
            <span style={{ overflowWrap: 'anywhere' }}>{passkey?.name}</span> will stop working for
            sign-in.
            {last && ' If the authenticator app is off too, your password alone opens the account.'}
          </Text>
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            data-autofocus
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          {error && (
            <p className={classes.error} role="alert">
              {error}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              color="red"
              variant="outline"
              disabled={!password}
              loading={remove.isPending}
            >
              Remove
            </Button>
          </div>
        </Stack>
      </form>
    </Modal>
  );
}

/** The backup codes issued with the first passkey. They are never shown again. */
function BackupCodesDialog({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  const copy = async () => {
    const ok = await copyToClipboard((codes ?? []).join('\n'));
    notifications.show(
      ok
        ? { message: 'Backup codes copied.' }
        : { color: 'red', message: 'Could not copy the backup codes.' },
    );
  };

  return (
    <Modal
      opened={!!codes}
      onClose={onClose}
      title="Passkey added. Save your backup codes"
      size={420}
      closeOnClickOutside={false}
    >
      <Stack>
        <Text size="sm" c="var(--gl-text-soft)" fw={300}>
          Each code signs you in once if you lose the passkey. This is the only time they are shown.
          Keep them somewhere other than the device that holds the passkey.
        </Text>
        <div className={t.codes}>
          {codes?.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="default" onClick={copy}>
            Copy codes
          </Button>
          <Button onClick={onClose} data-autofocus>
            I saved them
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}
