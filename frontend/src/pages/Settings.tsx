import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  FileInput,
  Modal,
  NumberInput,
  PasswordInput,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { authFetch, authFetchDownload, authFetchJson } from '../api/client';
import { formatDate } from '../utils/timeline';
import classes from './Admin.module.css';
import s from './Settings.module.css';

interface SettingsData {
  organization: string;
  country: string;
  state: string;
  city: string;
  email: string;
  defaultKeyAlgorithm: string;
  defaultRSAKeySize: number;
  defaultECDSACurve: string;
  defaultValidityDays: number;
  notificationsEnabled: boolean;
  notificationWebhookUrl: string;
  notificationThresholdDays: number;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpFromEmail: string;
  smtpFromName: string;
  emailNotificationsEnabled: boolean;
}

const BLANK: SettingsData = {
  organization: '',
  country: '',
  state: '',
  city: '',
  email: '',
  defaultKeyAlgorithm: 'rsa',
  defaultRSAKeySize: 2048,
  defaultECDSACurve: 'P-256',
  defaultValidityDays: 365,
  notificationsEnabled: false,
  notificationWebhookUrl: '',
  notificationThresholdDays: 30,
  smtpHost: '',
  smtpPort: 587,
  smtpUsername: '',
  smtpFromEmail: '',
  smtpFromName: 'GLcert',
  emailNotificationsEnabled: false,
};

function pick(data: Partial<SettingsData>): SettingsData {
  const out = { ...BLANK };
  for (const key of Object.keys(BLANK) as (keyof SettingsData)[]) {
    if (data[key] !== undefined && data[key] !== null)
      (out as Record<string, unknown>)[key] = data[key];
  }
  return out;
}

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={s.section}>
      <div className={s.side}>
        <h2 id={id}>{title}</h2>
        <p>{note}</p>
      </div>
      <div className={s.card}>{children}</div>
    </section>
  );
}

function Segments<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className={s.field}>
      <span className={s.caption}>{label}</span>
      <div className={classes.segments} style={{ alignSelf: 'flex-start' }}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            className={classes.segment}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Instance settings, saved together. The server replaces every field on save, so the page keeps one
 * draft of the whole record rather than saving sections separately.
 */
function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<SettingsData>({
    queryKey: ['settings'],
    queryFn: () => authFetchJson('/api/settings'),
  });
  const saved = useMemo(() => (data ? pick(data) : null), [data]);
  const [draft, setDraft] = useState<SettingsData>(BLANK);
  const [smtpPassword, setSmtpPassword] = useState('');

  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);

  const set = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const dirty = !!saved && (JSON.stringify(saved) !== JSON.stringify(draft) || smtpPassword !== '');

  const save = useMutation({
    mutationFn: () =>
      authFetchJson('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, smtpPassword }),
      }),
    onSuccess: () => {
      setSmtpPassword('');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      notifications.show({ message: 'Settings saved.' });
    },
    onError: (e: Error) =>
      notifications.show({ color: 'red', message: e.message || 'Could not save settings.' }),
  });

  const testAlert = useMutation({
    mutationFn: () =>
      authFetchJson('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: draft.notificationWebhookUrl }),
      }),
  });
  const testEmail = useMutation({
    mutationFn: () =>
      authFetchJson('/api/notifications/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: draft.smtpFromEmail }),
      }),
  });

  if (isLoading || !saved) return <div className={classes.loading} aria-label="Loading" />;

  const expiryExample = formatDate(
    new Date(Date.now() + draft.defaultValidityDays * 86_400_000).toISOString(),
  );
  const alertShare = Math.min(
    1,
    draft.notificationThresholdDays / Math.max(draft.defaultValidityDays, 1),
  );

  return (
    <div className={classes.page}>
      <div className={classes.header}>
        <div>
          <h1 className={classes.title}>Settings</h1>
          <div className="gl-second-line">For the whole instance. Only admins see this page.</div>
        </div>
        <div className={classes.headerActions}>
          {dirty && (
            <button
              type="button"
              className={classes.linkButton}
              onClick={() => {
                setDraft(saved);
                setSmtpPassword('');
              }}
            >
              Discard changes
            </button>
          )}
          <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save changes
          </Button>
        </div>
      </div>

      <div className={s.sections}>
        <Section
          id="defaults-h"
          title="Certificate defaults"
          note="Prefilled on every new authority and certificate. Existing ones keep their values."
        >
          <TextInput
            label="Organization"
            value={draft.organization}
            onChange={(e) => set('organization', e.currentTarget.value)}
          />
          <div className={s.grid}>
            <TextInput
              label="Country"
              placeholder="PT"
              maxLength={2}
              value={draft.country}
              onChange={(e) => set('country', e.currentTarget.value.toUpperCase())}
            />
            <TextInput
              label="State"
              value={draft.state}
              onChange={(e) => set('state', e.currentTarget.value)}
            />
            <TextInput
              label="City"
              value={draft.city}
              onChange={(e) => set('city', e.currentTarget.value)}
            />
          </div>
          <TextInput
            label="Contact email"
            type="email"
            value={draft.email}
            onChange={(e) => set('email', e.currentTarget.value)}
          />
          <div className={s.divider} />
          <div className={s.grid}>
            <Segments
              label="Key algorithm"
              value={draft.defaultKeyAlgorithm}
              options={[
                { value: 'rsa', label: 'RSA' },
                { value: 'ecdsa', label: 'ECDSA' },
                { value: 'ed25519', label: 'Ed25519' },
              ]}
              onChange={(v) => set('defaultKeyAlgorithm', v)}
            />
            {draft.defaultKeyAlgorithm === 'rsa' && (
              <Segments
                label="RSA key size"
                value={draft.defaultRSAKeySize}
                options={[2048, 3072, 4096].map((n) => ({ value: n, label: String(n) }))}
                onChange={(v) => set('defaultRSAKeySize', v)}
              />
            )}
            <NumberInput
              label="Validity"
              min={1}
              max={3650}
              value={draft.defaultValidityDays}
              onChange={(v) => set('defaultValidityDays', Math.max(1, Number(v) || 365))}
              rightSection={<span className="gl-second-line">days</span>}
              rightSectionWidth={44}
            />
          </div>
          <p className={classes.muted}>
            {draft.defaultKeyAlgorithm === 'ecdsa' ? 'ECDSA uses curve P-256. ' : ''}A certificate
            issued today would expire on <span className="gl-literal">{expiryExample}</span>.
          </p>
        </Section>

        <Section
          id="alerts-h"
          title="Expiry alerts"
          note="One alert per authority or certificate when it reaches the threshold."
        >
          <div className={s.switchRow}>
            <div>
              <div id="webhook-l" className={s.switchTitle}>
                Webhook alerts
              </div>
              <div className="gl-second-line">
                Discord, Slack, Telegram, Gotify and other Shoutrrr services
              </div>
            </div>
            <Switch
              aria-labelledby="webhook-l"
              checked={draft.notificationsEnabled}
              onChange={(e) => set('notificationsEnabled', e.currentTarget.checked)}
            />
          </div>
          <div className={s.grid}>
            <NumberInput
              label="Threshold"
              min={1}
              max={365}
              value={draft.notificationThresholdDays}
              onChange={(v) => set('notificationThresholdDays', Math.max(1, Number(v) || 30))}
              rightSection={<span className="gl-second-line">days</span>}
              rightSectionWidth={44}
            />
            <PasswordInput
              label="Webhook URL"
              placeholder="discord://token@id"
              value={draft.notificationWebhookUrl}
              onChange={(e) => set('notificationWebhookUrl', e.currentTarget.value)}
              disabled={!draft.notificationsEnabled}
              style={{ gridColumn: 'span 2' }}
            />
          </div>
          <div
            className={s.lifeline}
            role="img"
            aria-label={`A ${draft.defaultValidityDays}-day certificate alerts ${draft.notificationThresholdDays} days before it expires`}
          >
            <div className={s.lifeTrack}>
              <span className={s.lifeAlert} style={{ width: `${alertShare * 100}%` }} />
            </div>
            <div className={`${s.lifeLabels} gl-literal`}>
              <span style={{ left: 0 }}>issued</span>
              <span style={{ right: `${alertShare * 100}%`, transform: 'translateX(50%)' }}>
                alert
              </span>
              <span style={{ right: 0 }}>expires</span>
            </div>
          </div>
          <div className={s.actionRow}>
            <Button
              variant="default"
              disabled={!draft.notificationsEnabled || !draft.notificationWebhookUrl}
              loading={testAlert.isPending}
              onClick={() => testAlert.mutate()}
            >
              Send a test alert
            </Button>
            {testAlert.isSuccess && (
              <span className={s.status} style={{ color: 'var(--gl-success)' }}>
                Test alert sent.
              </span>
            )}
            {testAlert.isError && (
              <span className={s.status} style={{ color: 'var(--gl-danger)' }}>
                The test alert failed.
              </span>
            )}
          </div>
        </Section>

        <Section
          id="email-h"
          title="Email"
          note="Used for password resets, share links and, if you turn it on, expiry alerts."
        >
          <div className={s.switchRow}>
            <div>
              <div id="email-alerts-l" className={s.switchTitle}>
                Expiry alerts by email
              </div>
              <div className="gl-second-line">Same threshold as webhooks</div>
            </div>
            <Switch
              aria-labelledby="email-alerts-l"
              checked={draft.emailNotificationsEnabled}
              onChange={(e) => set('emailNotificationsEnabled', e.currentTarget.checked)}
            />
          </div>
          <div className={s.grid}>
            <TextInput
              label="SMTP host"
              placeholder="smtp.example.com"
              value={draft.smtpHost}
              onChange={(e) => set('smtpHost', e.currentTarget.value)}
              style={{ gridColumn: 'span 2' }}
            />
            <NumberInput
              label="Port"
              min={1}
              max={65535}
              value={draft.smtpPort}
              onChange={(v) => set('smtpPort', Number(v) || 587)}
            />
          </div>
          <div className={s.grid}>
            <TextInput
              label="Username"
              placeholder="Optional"
              value={draft.smtpUsername}
              onChange={(e) => set('smtpUsername', e.currentTarget.value)}
            />
            <PasswordInput
              label="Password"
              placeholder="Leave empty to keep it"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.currentTarget.value)}
            />
          </div>
          <div className={s.grid}>
            <TextInput
              label="From address"
              type="email"
              placeholder="glcert@example.com"
              value={draft.smtpFromEmail}
              onChange={(e) => set('smtpFromEmail', e.currentTarget.value)}
            />
            <TextInput
              label="From name"
              value={draft.smtpFromName}
              onChange={(e) => set('smtpFromName', e.currentTarget.value)}
            />
          </div>
          <div className={s.actionRow}>
            <Button
              variant="default"
              disabled={dirty || !saved.smtpHost || !saved.smtpFromEmail}
              loading={testEmail.isPending}
              onClick={() => testEmail.mutate()}
            >
              Send a test email
            </Button>
            <span className="gl-second-line">
              {dirty
                ? 'Save first; the test uses the saved settings.'
                : saved.smtpFromEmail
                  ? `Sent to ${saved.smtpFromEmail}.`
                  : ''}
            </span>
            {testEmail.isSuccess && (
              <span className={s.status} style={{ color: 'var(--gl-success)' }}>
                Test email sent.
              </span>
            )}
            {testEmail.isError && (
              <span className={s.status} style={{ color: 'var(--gl-danger)' }}>
                The test email failed.
              </span>
            )}
          </div>
        </Section>

        <BackupSection />
      </div>
    </div>
  );
}

/** Backup, restore and factory reset, moved here from the old Administration page. */
function BackupSection() {
  const [dialog, setDialog] = useState<'backup' | 'restore' | 'reset' | null>(null);
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [message, setMessage] = useState('');

  const open = (d: 'backup' | 'restore' | 'reset') => {
    setPassword('');
    setFile(null);
    setConfirmText('');
    setMessage('');
    backup.reset();
    restore.reset();
    setDialog(d);
  };

  const backup = useMutation({
    mutationFn: () => authFetchDownload('/api/backup/create', { password }, 'glcert-backup.zip'),
  });
  const restore = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('backup', file!);
      form.append('password', password);
      const res = await authFetch('/api/backup/restore', { method: 'POST', body: form });
      if (!res.ok) throw new Error((await res.text()) || 'Restore failed');
      return (await res.json()) as { message: string };
    },
    onSuccess: (data) => setMessage(data.message),
    onError: (e: Error) => setMessage(e.message),
  });
  const reset = useMutation({
    mutationFn: () =>
      authFetchJson('/api/admin/factory-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => {
      localStorage.removeItem('auth_token');
      window.location.reload();
    },
    onError: (e: Error) =>
      notifications.show({ color: 'red', message: e.message || 'The factory reset failed.' }),
  });

  return (
    <Section
      id="backup-h"
      title="Backup and reset"
      note="Backups are ZIP files encrypted with a password you choose. Keep them off this server."
    >
      <div className={s.opRow}>
        <div className={s.opText}>
          <span className={s.switchTitle}>Back up</span>
          <span className="gl-second-line">Every authority, certificate, user and setting</span>
        </div>
        <Button variant="default" onClick={() => open('backup')}>
          Create backup
        </Button>
      </div>
      <div className={s.divider} />
      <div className={s.opRow}>
        <div className={s.opText}>
          <span className={s.switchTitle}>Restore</span>
          <span className="gl-second-line">
            Merges a backup in. Nothing that exists is overwritten.
          </span>
        </div>
        <Button variant="default" onClick={() => open('restore')}>
          Restore from file
        </Button>
      </div>
      <div className={s.divider} />
      <div className={s.opRow}>
        <div className={s.opText}>
          <span className={s.switchTitle}>Factory reset</span>
          <span className="gl-second-line">
            Deletes every authority, certificate, account and setting. You run setup again.
          </span>
        </div>
        <Button color="red" variant="outline" onClick={() => open('reset')}>
          Factory reset
        </Button>
      </div>

      <Modal
        opened={dialog === 'backup'}
        onClose={() => setDialog(null)}
        title="Create a backup"
        size={420}
      >
        <Stack>
          <Text size="sm" c="var(--gl-text-soft)" fw={300}>
            The ZIP is encrypted with this password. You need it to restore, and it cannot be
            recovered.
          </Text>
          <PasswordInput
            label="Backup password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            data-autofocus
          />
          {backup.isSuccess && (
            <span className={s.status} style={{ color: 'var(--gl-success)' }}>
              Backup downloaded.
            </span>
          )}
          {backup.isError && (
            <span className={s.status} style={{ color: 'var(--gl-danger)' }}>
              The backup failed.
            </span>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="default" onClick={() => setDialog(null)}>
              {backup.isSuccess ? 'Done' : 'Cancel'}
            </Button>
            {!backup.isSuccess && (
              <Button
                disabled={!password}
                loading={backup.isPending}
                onClick={() => backup.mutate()}
              >
                Download backup
              </Button>
            )}
          </div>
        </Stack>
      </Modal>

      <Modal
        opened={dialog === 'restore'}
        onClose={() => setDialog(null)}
        title="Restore from a backup"
        size={420}
      >
        <Stack>
          {restore.isSuccess ? (
            <>
              <Text size="sm" c="var(--gl-success)">
                {message}
              </Text>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button onClick={() => (window.location.href = '/')}>Reload</Button>
              </div>
            </>
          ) : (
            <>
              <Text size="sm" c="var(--gl-text-soft)" fw={300}>
                Authorities, certificates and settings are merged in. Your account and encryption
                keys stay as they are.
              </Text>
              <FileInput
                label="Backup file"
                placeholder="Choose a .zip file"
                accept=".zip"
                value={file}
                onChange={setFile}
              />
              <PasswordInput
                label="Backup password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              {restore.isError && <p className={classes.error}>{message}</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button variant="default" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={!file || !password}
                  loading={restore.isPending}
                  onClick={() => restore.mutate()}
                >
                  Restore
                </Button>
              </div>
            </>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={dialog === 'reset'}
        onClose={() => setDialog(null)}
        title="Factory reset?"
        size={420}
      >
        <Stack>
          <Text size="sm" c="var(--gl-text-soft)" fw={300}>
            Every authority, certificate, account and setting is deleted, and you run setup again.
            This cannot be undone.
          </Text>
          <TextInput
            label="Type RESET to confirm"
            placeholder="RESET"
            value={confirmText}
            onChange={(e) => setConfirmText(e.currentTarget.value)}
          />
          <PasswordInput
            label="Your password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="default" onClick={() => setDialog(null)} data-autofocus>
              Cancel
            </Button>
            <Button
              color="red"
              variant="outline"
              disabled={confirmText !== 'RESET' || !password}
              loading={reset.isPending}
              onClick={() => reset.mutate()}
            >
              Factory reset
            </Button>
          </div>
        </Stack>
      </Modal>
    </Section>
  );
}

export default SettingsPage;
