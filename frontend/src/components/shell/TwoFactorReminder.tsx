import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal, Text } from '@mantine/core';
import { useAuth } from '../../hooks/useAuth';
import { hasTwoFactor } from '../../types/user';
import {
  clearSignedIn,
  justSignedIn,
  shouldRemind,
  snoozeReminder,
  snoozedUntil,
} from '../../utils/twoFactorReminder';

/**
 * Asks accounts without two-factor to turn it on, once per sign-in. "Remind me in a week" puts it
 * off for seven days in this browser; closing the dialog only puts it off until the next sign-in.
 */
export function TwoFactorReminder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Read once on mount; the sign-in marker is cleared right after, so a reload does not reopen it.
  const [opened, setOpened] = useState(
    () => justSignedIn() && shouldRemind(hasTwoFactor(user), snoozedUntil(), Date.now()),
  );

  useEffect(() => {
    clearSignedIn();
  }, []);

  return (
    <Modal opened={opened} onClose={() => setOpened(false)} title="Turn on two-factor?" size={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Text size="sm" c="var(--gl-text-soft)" fw={300}>
          Only your password protects this account. A passkey or a code from an authenticator app
          keeps it safe if the password leaks. It takes about a minute.
        </Text>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="default"
            onClick={() => {
              snoozeReminder();
              setOpened(false);
            }}
          >
            Remind me in a week
          </Button>
          <Button
            data-autofocus
            onClick={() => {
              setOpened(false);
              navigate('/profile#two-factor-h');
            }}
          >
            Set up two-factor
          </Button>
        </div>
      </div>
    </Modal>
  );
}
