import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Modal,
  PasswordInput,
  PinInput,
  Stack,
  Text,
  TextInput,
  useMantineColorScheme,
} from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import { authFetchJson } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { PasswordStrengthIndicator } from '../components/PasswordStrengthIndicator';
import type { User } from '../types/user';
import classes from './Admin.module.css';
import s from './Settings.module.css';

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

const SCHEMES = [
  { value: 'auto', label: 'Match system', Icon: IconDeviceDesktop },
  { value: 'light', label: 'Light', Icon: IconSun },
  { value: 'dark', label: 'Dark', Icon: IconMoon },
] as const;

/** Your account: profile, appearance, password, two-factor and sessions. Only you see it. */
function UserProfile() {
  const { user, setUser, logout } = useAuth();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const [name, setName] = useState(user?.name ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [turningOff, setTurningOff] = useState(false);

  const { data: totp, refetch: refetchTotp } = useQuery<{ enabled: boolean }>({
    queryKey: ['totpStatus'],
    queryFn: () => authFetchJson('/api/totp/status'),
  });
  const twoFactorOn = totp?.enabled ?? user?.totpEnabled ?? false;

  const saveName = useMutation({
    mutationFn: () =>
      authFetchJson<User>('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      }),
    onSuccess: (updated) => {
      if (user) setUser({ ...user, name: updated?.name ?? name.trim() });
      notifications.show({ message: 'Name saved.' });
    },
    onError: () => notifications.show({ color: 'red', message: 'Could not save your name.' }),
  });

  // The server ends every session on a password change, this one included, so sign out here too.
  const changePassword = useMutation({
    mutationFn: () =>
      authFetchJson('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      }),
    onSuccess: () => {
      notifications.show({ message: 'Password changed. Sign in with the new one.' });
      logout();
    },
    onError: () => setPasswordError('Your current password is not right.'),
  });

  const submitPassword = () => {
    setPasswordError('');
    if (next.length < 6) return setPasswordError('Use at least 6 characters.');
    if (next !== again) return setPasswordError('The new passwords do not match.');
    if (next === current)
      return setPasswordError('The new password is the same as the current one.');
    changePassword.mutate();
  };

  if (!user) return null;
  const roleWord = user.role.charAt(0).toUpperCase() + user.role.slice(1);

  return (
    <div className={classes.page}>
      <div className={classes.header}>
        <div>
          <h1 className={classes.title}>Your account</h1>
          <div className="gl-second-line">Only you see these</div>
        </div>
        <Button variant="default" onClick={logout}>
          Sign out
        </Button>
      </div>

      <div className={s.sections}>
        <Section id="profile-h" title="Profile" note="Your email is how you sign in.">
          <div className={s.grid}>
            <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <div className={s.field}>
              <span className={s.caption}>Email</span>
              <span
                className="gl-literal"
                style={{ fontSize: 14, lineHeight: '32px', color: 'var(--gl-text-soft)' }}
              >
                {user.email}
              </span>
            </div>
          </div>
          <div className={s.field}>
            <span className={s.caption}>Role</span>
            <span style={{ fontSize: 14, color: 'var(--gl-text-soft)' }}>{roleWord}</span>
            <span className="gl-second-line">
              {user.role === 'admin' ? 'Another admin can change it.' : 'An admin can change it.'}
            </span>
          </div>
          <Button
            variant="default"
            style={{ alignSelf: 'flex-start' }}
            disabled={name.trim() === (user.name ?? '')}
            loading={saveName.isPending}
            onClick={() => saveName.mutate()}
          >
            Save name
          </Button>
        </Section>

        <Section id="appearance-h" title="Appearance" note="Saved in this browser.">
          <div
            role="radiogroup"
            aria-labelledby="appearance-h"
            className={classes.segments}
            style={{ alignSelf: 'flex-start' }}
          >
            {SCHEMES.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={colorScheme === value}
                className={classes.segment}
                onClick={() => setColorScheme(value)}
              >
                <Icon size={14} stroke={1.8} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Section
          id="password-h"
          title="Password"
          note="Changing it signs you out on every device, this one included."
        >
          <PasswordInput
            label="Current password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.currentTarget.value)}
          />
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.currentTarget.value)}
          />
          <PasswordInput
            label="Type it again"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.currentTarget.value)}
          />
          {next && <PasswordStrengthIndicator password={next} />}
          <p className={classes.muted}>Strength shows as you type. Longer beats clever.</p>
          {passwordError && <p className={classes.error}>{passwordError}</p>}
          <Button
            variant="default"
            style={{ alignSelf: 'flex-start' }}
            disabled={!current || !next || !again}
            loading={changePassword.isPending}
            onClick={submitPassword}
          >
            Change password
          </Button>
        </Section>

        <Section
          id="two-factor-h"
          title="Two-factor"
          note="A code from your authenticator app, asked after your password."
        >
          <div className={s.opRow}>
            <div className={s.opText}>
              <span
                className={s.switchTitle}
                style={{ color: twoFactorOn ? 'var(--gl-success)' : 'var(--gl-text)' }}
              >
                {twoFactorOn ? 'On' : 'Off'}
              </span>
              <span className="gl-second-line">
                {twoFactorOn
                  ? 'Authenticator app, with single-use backup codes'
                  : 'Only your password protects this account.'}
              </span>
            </div>
            <Button
              component={Link}
              to="/profile/two-factor"
              variant={twoFactorOn ? 'default' : 'filled'}
            >
              {twoFactorOn ? 'Set up again' : 'Set up two-factor'}
            </Button>
          </div>
          {twoFactorOn && (
            <>
              <p className={classes.muted}>
                Setting up again replaces your authenticator and gives you new backup codes.
              </p>
              <div className={s.divider} />
              <div className={s.opRow}>
                <div className={s.opText}>
                  <span className={s.switchTitle}>Turn off two-factor</span>
                  <span className="gl-second-line">
                    Your password alone will open this account.
                  </span>
                </div>
                <Button color="red" variant="outline" onClick={() => setTurningOff(true)}>
                  Turn off
                </Button>
              </div>
            </>
          )}
        </Section>

        <Section id="sessions-h" title="Sessions" note="How long you stay signed in.">
          <p className={classes.body}>
            A session lasts 24 hours, and ends after 30 minutes without activity. Restarting the
            server or changing your password ends every session.
          </p>
        </Section>
      </div>

      <TurnOffDialog
        opened={turningOff}
        onClose={() => setTurningOff(false)}
        onDone={() => {
          setTurningOff(false);
          refetchTotp();
          setUser({ ...user, totpEnabled: false });
          notifications.show({ message: 'Two-factor is off.' });
        }}
      />
    </div>
  );
}

function TurnOffDialog({
  opened,
  onClose,
  onDone,
}: {
  opened: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const off = useMutation({
    mutationFn: () =>
      authFetchJson('/api/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, code }),
      }),
    onSuccess: () => {
      setPassword('');
      setCode('');
      onDone();
    },
    onError: () => setError('The password or the code is not right.'),
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Turn off two-factor?" size={420}>
      <Stack>
        <Text size="sm" c="var(--gl-text-soft)" fw={300}>
          Confirm with your password and a current code from your authenticator app.
        </Text>
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        <div className={s.field}>
          <span className={s.caption}>Six-digit code</span>
          <PinInput
            length={6}
            placeholder=""
            type="number"
            oneTimeCode
            aria-label="Six-digit code"
            value={code}
            onChange={setCode}
            gap={8}
          />
        </div>
        {error && <p className={classes.error}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="default" onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <Button
            color="red"
            variant="outline"
            disabled={!password || code.length !== 6}
            loading={off.isPending}
            onClick={() => {
              setError('');
              off.mutate();
            }}
          >
            Turn off
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}

export default UserProfile;
