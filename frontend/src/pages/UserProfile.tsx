import {
  Title,
  PasswordInput,
  PinInput,
  Select,
  Button,
  Stack,
  Group,
  Text,
  Modal,
  useMantineColorScheme,
  Paper,
  Divider,
  Image,
  CopyButton,
  Tooltip,
  Center,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { authFetchJson } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { PasswordStrengthIndicator } from '../components/PasswordStrengthIndicator';

function UserProfile() {
  const { logout } = useAuth();
  const { setColorScheme, colorScheme } = useMantineColorScheme();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const [totpEnabled, setTotpEnabled] = useState(false);
  const [showTOTPSetup, setShowTOTPSetup] = useState(false);
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; imageData: string; codes: string[] } | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState('');
  const [totpStatus, setTotpStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [showDisableTOTP, setShowDisableTOTP] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableStatus, setDisableStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  useEffect(() => {
    authFetchJson('/api/totp/status').then((data: any) => {
      setTotpEnabled(data.enabled);
    }).catch(() => {});
  }, []);

  const passwordMutation = useMutation({
    mutationFn: (values: { currentPassword: string; newPassword: string }) =>
      authFetchJson('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      setPasswordError('');
      setPasswordSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: () => {
      setPasswordSuccess('');
      setPasswordError('Invalid current password');
    },
  });

  const handlePasswordSubmit = () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All fields are required');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordError('New password must differ from current password');
      return;
    }

    passwordMutation.mutate({ currentPassword, newPassword });
  };

  return (
    <Stack gap='xl'>
      <Title>User Profile</Title>

      <Paper withBorder p='lg' style={{ borderLeft: '3px solid var(--mantine-color-teal-5)' }}>
        <Title order={5} mb='md'>Appearance</Title>
        <Select
          label='Theme'
          data={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'auto', label: 'System' },
          ]}
          value={colorScheme}
          onChange={(value) => {
            if (value) {
              setColorScheme(value as 'light' | 'dark' | 'auto');
              localStorage.setItem('glcert-color-scheme', value);
            }
          }}
        />
      </Paper>

      <Paper withBorder p='lg' style={{ borderLeft: '3px solid var(--mantine-color-teal-5)' }}>
        <Title order={5} mb='md'>Security</Title>
        <Stack gap='md'>
          <PasswordInput
            label='Current Password'
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
          />
          <PasswordInput
            label='New Password'
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
          />
          <PasswordStrengthIndicator password={newPassword} />
          <PasswordInput
            label='Confirm New Password'
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
          />
          {passwordError && <Text c='red' size='sm'>{passwordError}</Text>}
          {passwordSuccess && <Text c='green' size='sm'>{passwordSuccess}</Text>}
          <Group justify='flex-end'>
            <Button variant='filled' color='blue' loading={passwordMutation.isPending} onClick={handlePasswordSubmit}>
              Change Password
            </Button>
          </Group>

          <Divider my='md' />

          <Group justify='space-between' align='center'>
            <div>
              <Text fw={500}>Two-Factor Authentication</Text>
              <Text size='sm' c='dimmed'>
                {totpEnabled ? '2FA is enabled for your account' : 'Add an extra layer of security'}
              </Text>
            </div>
            <Group>
              {totpEnabled && (
                <Button variant='subtle' color='red' onClick={() => {
                  setDisablePassword('');
                  setDisableCode('');
                  setDisableStatus('idle');
                  setShowDisableTOTP(true);
                }}>
                  Disable
                </Button>
              )}
              <Button
                variant={totpEnabled ? 'outline' : 'filled'}
                color='teal'
                onClick={() => {
                  setTotpVerifyCode('');
                  setTotpStatus('idle');
                  authFetchJson('/api/totp/setup').then((data: any) => {
                    setTotpSetupData(data);
                    setShowTOTPSetup(true);
                  });
                }}
              >
                {totpEnabled ? 'Reconfigure' : 'Enable 2FA'}
              </Button>
            </Group>
          </Group>
        </Stack>
      </Paper>

      <Group justify='flex-end'>
        <Button color='red' variant='filled' onClick={logout}>
          Sign Out
        </Button>
      </Group>

      <Modal
        opened={showTOTPSetup}
        onClose={() => setShowTOTPSetup(false)}
        title='Enable Two-Factor Authentication'
        centered
        size='md'
      >
        <Stack gap='md'>
          {totpSetupData && (
            <>
              <Text size='sm' c='dimmed'>
                Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
              </Text>
              <Center>
                <Image
                  src={`data:image/png;base64,${totpSetupData.imageData}`}
                  maw={200}
                  alt='TOTP QR Code'
                />
              </Center>
              <Text size='xs' c='dimmed' ta='center'>
                Or enter this secret manually: {totpSetupData.secret}
              </Text>

              <Divider />

              <Text size='sm' fw={500}>Backup Codes</Text>
              <Text size='xs' c='dimmed'>
                Save these codes somewhere safe. Each can be used once if you lose access to your authenticator.
              </Text>
              <Paper withBorder p='sm'>
                <Group gap='xs' justify='center' wrap='wrap'>
                  {totpSetupData.codes.map((code, i) => (
                    <CopyButton key={i} value={code}>
                      {({ copied, copy }) => (
                        <Tooltip label={copied ? 'Copied!' : 'Click to copy'}>
                          <Text
                            size='sm'
                            ff='monospace'
                            style={{ cursor: 'pointer' }}
                            c={copied ? 'teal' : undefined}
                            onClick={copy}
                          >
                            {code}
                          </Text>
                        </Tooltip>
                      )}
                    </CopyButton>
                  ))}
                </Group>
              </Paper>
              <Button
                variant='subtle'
                size='xs'
                onClick={() => {
                  navigator.clipboard.writeText(totpSetupData.codes.join('\n'));
                }}
              >
                Copy All Codes
              </Button>

              <Divider />

              <Text size='sm' fw={500}>Verify Setup</Text>
              <Text size='xs' c='dimmed'>
                Enter the 6-digit code from your authenticator app to confirm setup.
              </Text>
              <Group justify='center'>
                <PinInput
                  length={6}
                  value={totpVerifyCode}
                  onChange={setTotpVerifyCode}
                  size='lg'
                />
              </Group>
              {totpStatus === 'error' && <Text c='red' size='sm' ta='center'>Invalid code. Try again.</Text>}
              <Group justify='flex-end'>
                <Button variant='default' onClick={() => setShowTOTPSetup(false)}>Cancel</Button>
                <Button
                  loading={totpStatus === 'loading'}
                  disabled={totpVerifyCode.length !== 6}
                  onClick={() => {
                    setTotpStatus('loading');
                    authFetchJson('/api/totp/verify-setup', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        secret: totpSetupData.secret,
                        code: totpVerifyCode,
                        codes: totpSetupData.codes,
                      }),
                    }).then(() => {
                      setTotpStatus('success');
                      setTotpEnabled(true);
                      setShowTOTPSetup(false);
                    }).catch(() => {
                      setTotpStatus('error');
                    });
                  }}
                >
                  Verify & Enable
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={showDisableTOTP}
        onClose={() => setShowDisableTOTP(false)}
        title='Disable Two-Factor Authentication'
        centered
      >
        <Stack gap='md'>
          <Text size='sm' c='dimmed'>
            Enter your password and a valid TOTP code to disable 2FA.
          </Text>
          <PasswordInput
            label='Password'
            value={disablePassword}
            onChange={e => setDisablePassword(e.currentTarget.value)}
           
          />
          <Group justify='center'>
            <PinInput
              length={6}
              value={disableCode}
              onChange={setDisableCode}
              size='lg'
            />
          </Group>
          {disableStatus === 'error' && <Text c='red' size='sm' ta='center'>Invalid password or code.</Text>}
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setShowDisableTOTP(false)}>Cancel</Button>
            <Button
              color='red'
              loading={disableStatus === 'loading'}
              disabled={!disablePassword || disableCode.length !== 6}
              onClick={() => {
                setDisableStatus('loading');
                authFetchJson('/api/totp/disable', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ password: disablePassword, code: disableCode }),
                }).then(() => {
                  setDisableStatus('success');
                  setTotpEnabled(false);
                  setShowDisableTOTP(false);
                }).catch(() => {
                  setDisableStatus('error');
                });
              }}
            >
              Disable 2FA
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export default UserProfile;
