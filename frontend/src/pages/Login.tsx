import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, PasswordInput, PinInput, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconFingerprint } from '@tabler/icons-react';
import { useAuth } from '../hooks/useAuth';
import { AuthLayout, authClasses as classes } from '../components/AuthLayout';
import type { User } from '../types/user';
import {
  getPasskey,
  passkeyErrorMessage,
  passkeysSupported,
  secondFactorModes,
  type RequestOptionsJSON,
  type SecondFactor,
} from '../utils/passkey';

// Plain HTTP is fine on this machine; anywhere else, passwords cross the network in the clear.
const insecure =
  window.location.protocol === 'http:' &&
  !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

const TITLES: Record<SecondFactor, string> = {
  passkey: 'Use your passkey',
  totp: 'Enter your code',
  backup: 'Use a backup code',
};

const LEADS: Record<SecondFactor, string> = {
  passkey: 'Confirm it is you with the passkey you saved for GLcert.',
  totp: 'Open your authenticator app and type the 6-digit code for GLcert.',
  backup: 'Type one of the backup codes you saved when you set up two-factor.',
};

const SWITCH_TO: Record<SecondFactor, string> = {
  passkey: 'Use a passkey',
  totp: 'Use a code from the app',
  backup: 'Use a backup code',
};

/** Sign in, then the two-factor check when the account has it on. */
function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [partialToken, setPartialToken] = useState('');
  // The second-factor screens this sign-in can use; the first one is shown.
  const [modes, setModes] = useState<SecondFactor[]>([]);
  const [mode, setMode] = useState<SecondFactor>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      // Never say which part was wrong: that would reveal whether the account exists.
      if (!res.ok) {
        setError(
          res.status === 429
            ? 'Too many attempts. Wait a moment and try again.'
            : 'That email and password do not match.',
        );
        return;
      }
      const data = await res.json();
      if (data.partialToken) {
        const offered = secondFactorModes(data.methods ?? ['totp'], passkeysSupported());
        setModes(offered);
        setMode(offered[0]);
        setPartialToken(data.partialToken);
        return;
      }
      login(data.token, data.user as User);
      navigate('/');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  };

  const post = (url: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const verifyCode = async () => {
    const res = await post('/api/totp/verify', { partialToken, code: code.trim() });
    if (!res.ok) {
      setError(
        res.status === 429
          ? 'Too many attempts. Wait a moment and try again.'
          : mode === 'backup'
            ? 'That backup code does not work. Each one works once.'
            : 'That code does not match. Codes change every 30 seconds.',
      );
      return;
    }
    const data = await res.json();
    login(data.token, data.user as User);
    navigate('/');
  };

  const verifyPasskey = async () => {
    const begin = await post('/api/passkeys/login/begin', { partialToken });
    if (!begin.ok) {
      setError(
        begin.status === 429
          ? 'Too many attempts. Wait a moment and try again.'
          : begin.status === 409
            ? 'Passkeys do not work at this address. Use another way to sign in.'
            : 'This sign-in timed out. Start over.',
      );
      return;
    }
    let credential;
    try {
      credential = await getPasskey((await begin.json()) as RequestOptionsJSON);
    } catch (err) {
      setError(passkeyErrorMessage(err, 'use'));
      return;
    }
    const res = await post('/api/passkeys/login/finish', { partialToken, credential });
    if (!res.ok) {
      setError(
        res.status === 429
          ? 'Too many attempts. Wait a moment and try again.'
          : 'That passkey was not accepted.',
      );
      return;
    }
    const data = await res.json();
    login(data.token, data.user as User);
    navigate('/');
  };

  const verify = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      await (mode === 'passkey' ? verifyPasskey() : verifyCode());
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  };

  const startOver = () => {
    setPartialToken('');
    setModes([]);
    setCode('');
    setPassword('');
    setError('');
  };

  if (partialToken) {
    return (
      <AuthLayout
        footnote={
          <>
            Signed in as <span className="gl-literal">{email}</span>. This step times out after 5
            minutes.
          </>
        }
      >
        <form className={classes.card} onSubmit={verify}>
          <h1 className={classes.title}>{TITLES[mode]}</h1>
          <p className={classes.lead}>{LEADS[mode]}</p>
          {mode === 'backup' && (
            <TextInput
              label="Backup code"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              styles={{ input: { fontFamily: 'var(--gl-font-mono)' } }}
            />
          )}
          {mode === 'totp' && (
            <PinInput
              length={6}
              placeholder=""
              type="number"
              oneTimeCode
              autoFocus
              aria-label="Six-digit code"
              value={code}
              onChange={setCode}
              size="lg"
              gap={8}
              style={{ justifyContent: 'center' }}
            />
          )}
          {error && (
            <p className={classes.error} role="alert">
              {error}
            </p>
          )}
          {mode === 'passkey' ? (
            <Button
              type="submit"
              fullWidth
              loading={loading}
              autoFocus
              leftSection={<IconFingerprint size={16} stroke={1.8} aria-hidden="true" />}
            >
              Use passkey
            </Button>
          ) : (
            <Button
              type="submit"
              fullWidth
              loading={loading}
              disabled={mode === 'backup' ? !code.trim() : code.length !== 6}
            >
              Verify
            </Button>
          )}
          <div className={classes.links}>
            {modes
              .filter((other) => other !== mode)
              .map((other) => (
                <button
                  key={other}
                  type="button"
                  className={classes.linkButton}
                  onClick={() => {
                    setMode(other);
                    setCode('');
                    setError('');
                  }}
                >
                  {SWITCH_TO[other]}
                </button>
              ))}
            <button type="button" className={classes.linkButton} onClick={startOver}>
              Start over
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout footnote="You stay signed in for 24 hours, or until 30 minutes without activity.">
      <form className={classes.card} onSubmit={signIn}>
        <h1 className={classes.title}>Sign in</h1>
        <p className={classes.lead}>To manage your authorities and certificates.</p>
        {insecure && (
          <div role="note" className={classes.note}>
            <span className={classes.noteIcon}>
              <IconAlertTriangle size={16} stroke={1.8} aria-hidden="true" />
            </span>
            This connection is not encrypted. Put GLcert behind a TLS proxy before you sign in from
            another network.
          </div>
        )}
        <TextInput
          label="Email"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          required
          withAsterisk={false}
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <PasswordInput
          label={
            <span className={classes.passwordLabel}>
              Password
              <Link to="/forgot-password" style={{ fontSize: 12 }}>
                Forgot it?
              </Link>
            </span>
          }
          labelProps={{ style: { width: '100%' } }}
          autoComplete="current-password"
          required
          withAsterisk={false}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        {error && (
          <p className={classes.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" fullWidth loading={loading} disabled={!email || !password}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

export default Login;
