import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, PasswordInput, PinInput, TextInput } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useAuth } from '../hooks/useAuth';
import { AuthLayout, authClasses as classes } from '../components/AuthLayout';
import type { User } from '../types/user';

// Plain HTTP is fine on this machine; anywhere else, passwords cross the network in the clear.
const insecure =
  window.location.protocol === 'http:' &&
  !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

/** Sign in, then the two-factor check when the account has it on. */
function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [partialToken, setPartialToken] = useState('');
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
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

  const verify = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partialToken, code: code.trim() }),
      });
      if (!res.ok) {
        setError(
          res.status === 429
            ? 'Too many attempts. Wait a moment and try again.'
            : useBackup
              ? 'That backup code does not work. Each one works once.'
              : 'That code does not match. Codes change every 30 seconds.',
        );
        return;
      }
      const data = await res.json();
      login(data.token, data.user as User);
      navigate('/');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  };

  const startOver = () => {
    setPartialToken('');
    setCode('');
    setUseBackup(false);
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
          <h1 className={classes.title}>{useBackup ? 'Use a backup code' : 'Enter your code'}</h1>
          <p className={classes.lead}>
            {useBackup
              ? 'Type one of the backup codes you saved when you set up two-factor.'
              : 'Open your authenticator app and type the 6-digit code for GLcert.'}
          </p>
          {useBackup ? (
            <TextInput
              label="Backup code"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              styles={{ input: { fontFamily: 'var(--gl-font-mono)' } }}
            />
          ) : (
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
          <Button
            type="submit"
            fullWidth
            loading={loading}
            disabled={useBackup ? !code.trim() : code.length !== 6}
          >
            Verify
          </Button>
          <div className={classes.links}>
            <button
              type="button"
              className={classes.linkButton}
              onClick={() => {
                setUseBackup(!useBackup);
                setCode('');
                setError('');
              }}
            >
              {useBackup ? 'Use the app instead' : 'Use a backup code'}
            </button>
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
