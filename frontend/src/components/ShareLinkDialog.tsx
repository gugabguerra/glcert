import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Modal, TextInput } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconCopy } from '@tabler/icons-react';
import { authFetchJson } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { copyToClipboard } from '../utils/clipboard';
import { looksLikeEmail, SHARE_LINK_LIFETIME_MS, shareExpiryWords } from '../utils/shareLink';
import classes from './ShareLinkDialog.module.css';

export interface ShareFileOption {
  value: string;
  label: string;
}

interface ShareLinkDialogProps {
  opened: boolean;
  onClose: () => void;
  entityType: 'ca' | 'certificate';
  entityId: string;
  /** Shown in the title, "Share <name>". */
  entityName?: string;
  fileOptions: ShareFileOption[];
  fileNameFor: (fileType: string) => string;
  emailEnabled: boolean;
}

interface ShareResult {
  token: string;
  url: string;
  fileType: string;
  expiresAt: number;
}

/**
 * One file per link, single use, 15 minutes, no account needed to download. Choosing another file
 * needs a new link; the server issues the token and the URL is built from this app's origin.
 */
export function ShareLinkDialog({
  opened,
  onClose,
  entityType,
  entityId,
  entityName,
  fileOptions,
  fileNameFor,
  emailEnabled,
}: ShareLinkDialogProps) {
  const { hasRole } = useAuth();
  const [fileType, setFileType] = useState<string>(
    fileOptions.find((o) => o.value === 'bundle_zip')?.value ?? fileOptions[0]?.value ?? '',
  );
  const [result, setResult] = useState<ShareResult | null>(null);
  const [email, setEmail] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second while a link is live, for the countdown.
  useEffect(() => {
    if (!result) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [result]);

  const close = () => {
    setResult(null);
    setEmail('');
    onClose();
  };

  const create = useMutation({
    mutationFn: (type: string) =>
      authFetchJson<{ token: string; expires_at: string; file_type: string }>(
        `/api/share/${entityType}/${entityId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileType: type }),
        },
      ),
    onSuccess: (data) => {
      const parsed = Date.parse(data.expires_at);
      setNow(Date.now());
      setResult({
        token: data.token,
        url: `${window.location.origin}/api/share/${data.token}`,
        fileType: data.file_type,
        expiresAt: Number.isNaN(parsed) ? Date.now() + SHARE_LINK_LIFETIME_MS : parsed,
      });
    },
    onError: (e: Error) =>
      notifications.show({ color: 'red', message: e.message || 'Could not create the link.' }),
  });

  const send = useMutation({
    mutationFn: () =>
      authFetchJson('/api/share/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          token: result!.token,
          fileName: fileNameFor(result!.fileType),
        }),
      }),
    onSuccess: () => {
      notifications.show({ message: `Link sent to ${email.trim()}.` });
      setEmail('');
    },
    onError: (e: Error) =>
      notifications.show({ color: 'red', message: e.message || 'Could not send the email.' }),
  });

  const copy = async (text: string, what: string) => {
    const ok = await copyToClipboard(text);
    notifications.show(
      ok
        ? { message: `${what} copied.` }
        : { color: 'red', message: `Could not copy the ${what.toLowerCase()}.` },
    );
  };

  const remaining = result ? result.expiresAt - now : 0;
  const expired = !!result && remaining <= 0;
  const downloadName = result ? fileNameFor(result.fileType) : '';
  const extension = (value: string) => {
    const name = fileNameFor(value);
    return name.endsWith('.tar.gz') ? '.tar.gz' : name.slice(name.lastIndexOf('.'));
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={entityName ? `Share ${entityName}` : 'Share link'}
      size={420}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <p className={classes.lead}>
          Anyone with the link can download one file, once, within 15 minutes. They do not need an
          account.
        </p>

        <div role="radiogroup" aria-labelledby="share-file" className={classes.files}>
          <span id="share-file" className="gl-section-label" style={{ paddingBottom: 6 }}>
            File
          </span>
          {fileOptions.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={fileType === o.value}
              className={classes.file}
              onClick={() => {
                setFileType(o.value);
                // A link carries exactly one file, so a new choice needs a new link.
                if (result && result.fileType !== o.value) setResult(null);
              }}
            >
              <span className={classes.radio} aria-hidden="true" />
              <span className={classes.fileText}>
                <span className={classes.fileLabel}>{o.label}</span>
                {o.value === 'key' && (
                  <span className={classes.keyWarning}>
                    Gives away the private key. Prefer a bundle sent another way.
                  </span>
                )}
              </span>
              <span className="gl-literal" style={{ color: 'var(--gl-text-muted)' }}>
                {extension(o.value)}
              </span>
            </button>
          ))}
        </div>

        {!result ? (
          <Button
            variant="default"
            loading={create.isPending}
            disabled={!fileType}
            onClick={() => create.mutate(fileType)}
            style={{ alignSelf: 'flex-start' }}
          >
            Create link
          </Button>
        ) : (
          <>
            <div className={classes.block}>
              <label htmlFor="share-url" className="gl-section-label">
                Link
              </label>
              <div className={classes.row}>
                <TextInput
                  id="share-url"
                  readOnly
                  value={result.url}
                  style={{ flexGrow: 1, minWidth: 0 }}
                  styles={{ input: { fontFamily: 'var(--gl-font-mono)', fontSize: 12 } }}
                  onFocus={(e) => e.currentTarget.select()}
                  disabled={expired}
                />
                <Button
                  variant="default"
                  leftSection={<IconCopy size={16} stroke={1.8} />}
                  disabled={expired}
                  onClick={() => copy(result.url, 'Link')}
                >
                  Copy
                </Button>
              </div>
              <div className={classes.expiry}>
                <div className={classes.expiryTrack} aria-hidden="true">
                  <div
                    className={classes.expiryBar}
                    style={{
                      width: `${Math.max(0, Math.min(1, remaining / SHARE_LINK_LIFETIME_MS)) * 100}%`,
                    }}
                  />
                </div>
                <span
                  className="gl-second-line"
                  style={{ whiteSpace: 'nowrap', color: expired ? 'var(--gl-danger)' : undefined }}
                  aria-live="polite"
                >
                  {shareExpiryWords(remaining)}
                </span>
              </div>
              {expired ? (
                <button
                  type="button"
                  className={classes.linkButton}
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => create.mutate(fileType)}
                >
                  Create a new link
                </button>
              ) : (
                <div className={classes.commands}>
                  <button
                    type="button"
                    className={classes.linkButton}
                    onClick={() => copy(`wget -O ${downloadName} "${result.url}"`, 'wget command')}
                  >
                    Copy as wget
                  </button>
                  <button
                    type="button"
                    className={classes.linkButton}
                    onClick={() =>
                      copy(`curl -L -o ${downloadName} "${result.url}"`, 'curl command')
                    }
                  >
                    Copy as curl
                  </button>
                </div>
              )}
            </div>

            {!expired && (
              <div className={classes.block}>
                <label htmlFor="share-email" className="gl-section-label">
                  Or email it
                </label>
                {emailEnabled ? (
                  <div className={classes.row}>
                    <TextInput
                      id="share-email"
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.currentTarget.value)}
                      style={{ flexGrow: 1, minWidth: 0 }}
                    />
                    <Button
                      variant="default"
                      disabled={!looksLikeEmail(email)}
                      loading={send.isPending}
                      onClick={() => send.mutate()}
                    >
                      Send
                    </Button>
                  </div>
                ) : (
                  <p
                    className={classes.lead}
                    style={{ fontSize: 12, lineHeight: '18px', color: 'var(--gl-text-muted)' }}
                  >
                    Email is not set up.{' '}
                    {hasRole('admin') ? (
                      <Link to="/settings">Set it up in Settings</Link>
                    ) : (
                      'Ask an admin to set it up.'
                    )}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div className={classes.footer}>
          <Button variant={result ? 'filled' : 'default'} onClick={close}>
            {result ? 'Done' : 'Cancel'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default ShareLinkDialog;
