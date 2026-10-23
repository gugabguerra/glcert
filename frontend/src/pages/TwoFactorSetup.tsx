import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, PinInput } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { authFetchJson } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { copyToClipboard } from '../utils/clipboard';
import classes from './Admin.module.css';
import t from './TwoFactorSetup.module.css';

interface SetupData {
  secret: string;
  /** Base64 PNG of the QR code. */
  imageData: string;
  codes: string[];
}

type StepState = 'done' | 'current' | 'next';

/**
 * Scan, verify, then save backup codes. The server issues the secret and codes together; the codes
 * are only shown once the code from the app checks out, and never again after this page.
 */
function TwoFactorSetup() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  // One secret per visit: refetching would silently replace the one being scanned.
  const { data, isLoading, isError } = useQuery<SetupData>({
    queryKey: ['totpSetup'],
    queryFn: () => authFetchJson('/api/totp/setup'),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const verify = useMutation({
    mutationFn: () =>
      authFetchJson('/api/totp/verify-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }),
    onSuccess: () => {
      if (user) setUser({ ...user, totpEnabled: true });
      queryClient.invalidateQueries({ queryKey: ['totpStatus'] });
    },
    onError: () => setError('That code does not match. Codes change every 30 seconds.'),
  });

  const verified = verify.isSuccess;
  const state = (step: number): StepState =>
    verified
      ? step === 3
        ? 'current'
        : 'done'
      : step === 1
        ? 'done'
        : step === 2
          ? 'current'
          : 'next';

  const copy = async (text: string, what: string) => {
    const ok = await copyToClipboard(text);
    notifications.show(
      ok
        ? { message: `${what} copied.` }
        : { color: 'red', message: `Could not copy the ${what.toLowerCase()}.` },
    );
  };

  return (
    <div className={t.page}>
      <Link to="/profile" className="gl-second-line" style={{ alignSelf: 'flex-start' }}>
        Back to your account
      </Link>
      <div>
        <h1 className={classes.title}>Set up two-factor</h1>
        <div className="gl-second-line">
          {user?.totpEnabled && !verified
            ? 'Your current authenticator stops working once this is done.'
            : 'You will be asked for a code from your phone after your password.'}
        </div>
      </div>

      {isLoading ? (
        <div className={classes.loading} aria-label="Loading" />
      ) : isError || !data ? (
        <p className={classes.error}>Could not start the setup. Reload the page to try again.</p>
      ) : (
        <ol className={t.steps}>
          <li className={t.step} data-state={state(1)}>
            <span className={t.number} aria-hidden="true">
              1
            </span>
            <div className={t.stepBody}>
              <div className={t.stepTitle}>Scan the code with your authenticator app</div>
              {!verified && (
                <>
                  <div className={t.qr}>
                    <img
                      src={`data:image/png;base64,${data.imageData}`}
                      alt="QR code for your authenticator app"
                    />
                  </div>
                  <span className="gl-second-line">Can't scan? Type this key</span>
                  <div className={t.key}>
                    <code>{data.secret}</code>
                    <button
                      type="button"
                      className={classes.linkButton}
                      onClick={() => copy(data.secret, 'Key')}
                    >
                      Copy
                    </button>
                  </div>
                </>
              )}
            </div>
          </li>

          <li
            className={t.step}
            data-state={state(2)}
            aria-current={state(2) === 'current' ? 'step' : undefined}
          >
            <span className={t.number} aria-hidden="true">
              2
            </span>
            <div className={t.stepBody}>
              <div className={t.stepTitle}>Type the 6-digit code it shows</div>
              {!verified && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setError('');
                    if (code.length === 6) verify.mutate();
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <PinInput
                    length={6}
                    placeholder=""
                    type="number"
                    oneTimeCode
                    aria-label="Six-digit code"
                    value={code}
                    onChange={setCode}
                    size="lg"
                    gap={8}
                  />
                  {error && (
                    <p className={classes.error} role="alert">
                      {error}
                    </p>
                  )}
                  <div className={t.actions}>
                    <Button type="submit" disabled={code.length !== 6} loading={verify.isPending}>
                      Check code
                    </Button>
                    <Link to="/profile">Cancel</Link>
                  </div>
                </form>
              )}
            </div>
          </li>

          <li
            className={t.step}
            data-state={state(3)}
            aria-current={state(3) === 'current' ? 'step' : undefined}
          >
            <span className={t.number} aria-hidden="true">
              3
            </span>
            <div className={t.stepBody}>
              <div className={t.stepTitle}>Save your backup codes</div>
              <span className="gl-second-line">
                {data.codes.length} single-use codes
                {verified
                  ? '. This is the only time they are shown.'
                  : ', shown once the code above checks out.'}{' '}
                Keep them somewhere other than your phone.
              </span>
              <div className={t.codes} data-hidden={!verified || undefined} aria-hidden={!verified}>
                {data.codes.map((c, i) => (
                  <span key={i}>{verified ? c : '••••••••••'}</span>
                ))}
              </div>
              {verified && (
                <div className={t.actions}>
                  <Button
                    variant="default"
                    onClick={() => copy(data.codes.join('\n'), 'Backup codes')}
                  >
                    Copy codes
                  </Button>
                  <Button
                    onClick={() => {
                      notifications.show({ message: 'Two-factor is on.' });
                      navigate('/profile');
                    }}
                  >
                    Done
                  </Button>
                </div>
              )}
            </div>
          </li>
        </ol>
      )}
    </div>
  );
}

export default TwoFactorSetup;
