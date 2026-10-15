import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Modal, Stack, Text, Radio, Group, Button, TextInput, ActionIcon, Code, Box } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconClipboard, IconMail } from '@tabler/icons-react';
import { authFetchJson } from '../api/client';
import { copyToClipboard } from '../utils/clipboard';

export interface ShareFileOption {
  value: string;
  label: string;
}

interface ShareLinkDialogProps {
  opened: boolean;
  onClose: () => void;
  entityType: 'ca' | 'certificate';
  entityId: string;
  fileOptions: ShareFileOption[];
  fileNameFor: (fileType: string) => string;
  emailEnabled: boolean;
}

/** The full temporary-share-link flow: pick file type, generate a single-use
 *  15-minute link, copy it (or wget/curl commands), and optionally email it. */
export function ShareLinkDialog({
  opened,
  onClose,
  entityType,
  entityId,
  fileOptions,
  fileNameFor,
  emailEnabled,
}: ShareLinkDialogProps) {
  const navigate = useNavigate();
  const [shareFileType, setShareFileType] = useState<string>('bundle_zip');
  const [showShareResult, setShowShareResult] = useState(false);
  const [shareResult, setShareResult] = useState<{ url: string; fileType: string } | null>(null);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);
  const [showEmailNotConfigured, setShowEmailNotConfigured] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');

  const closeAll = () => {
    setShowShareResult(false);
    setShareResult(null);
    setEmailAddress('');
    onClose();
  };

  const shareMutation = useMutation({
    mutationFn: (fileType: string) =>
      authFetchJson<{ token: string; expires_at: string; file_type: string }>(`/api/share/${entityType}/${entityId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileType }),
      }),
    onSuccess: (data) => {
      const url = `${window.location.origin}/api/share/${data.token}`;
      setShareResult({ url, fileType: data.file_type });
      setShowShareResult(true);
    },
  });

  const emailMutation = useMutation({
    mutationFn: (payload: { email: string; url: string; fileName: string; fileType: string }) =>
      authFetchJson('/api/share/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      notifications.show({ message: 'Share link sent!', color: 'teal' });
      setShowEmailConfirm(false);
      setShowEmailDialog(false);
      closeAll();
    },
    onError: () => {
      notifications.show({ message: 'Failed to send email', color: 'red' });
    },
  });

  return (
    <>
      <Modal opened={opened} onClose={onClose} title="Create Share Link">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">Select what to share. The link expires in 15 minutes and can only be used once.</Text>
          <Radio.Group value={shareFileType} onChange={setShareFileType}>
            <Stack gap="xs" mt="xs">
              {fileOptions.map((opt) => (
                <Radio key={opt.value} value={opt.value} label={opt.label} />
              ))}
            </Stack>
          </Radio.Group>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button loading={shareMutation.isPending} onClick={() => shareMutation.mutate(shareFileType)}>
              Generate Link
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={showShareResult} onClose={() => { setShowShareResult(false); setShareResult(null); }} title="Share Link Ready" size="lg">
        {shareResult && (() => {
          const dlName = fileNameFor(shareResult.fileType);
          return (
            <Stack gap="md">
              <TextInput
                value={shareResult.url}
                readOnly
                onClick={(e) => (e.target as HTMLInputElement).select()}
                rightSection={
                  <ActionIcon variant="subtle" color="teal" onClick={async () => {
                    const ok = await copyToClipboard(shareResult.url);
                    notifications.show({ message: ok ? 'URL copied!' : 'Failed to copy', color: ok ? 'teal' : 'red' });
                    if (ok) closeAll();
                  }}>
                    <IconClipboard size={16} />
                  </ActionIcon>
                }
              />
              <Box>
                <Text size="xs" c="dimmed" mb={4}>wget command</Text>
                <Group gap="xs">
                  <Code flex={1} p="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {`wget -O ${dlName} "${shareResult.url}"`}
                  </Code>
                  <ActionIcon variant="subtle" color="teal" onClick={async () => {
                    const cmd = `wget -O ${dlName} "${shareResult.url}"`;
                    const ok = await copyToClipboard(cmd);
                    notifications.show({ message: ok ? 'wget command copied!' : 'Failed to copy', color: ok ? 'teal' : 'red' });
                    if (ok) closeAll();
                  }}>
                    <IconClipboard size={16} />
                  </ActionIcon>
                </Group>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" mb={4}>curl command</Text>
                <Group gap="xs">
                  <Code flex={1} p="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {`curl -L -o ${dlName} "${shareResult.url}"`}
                  </Code>
                  <ActionIcon variant="subtle" color="teal" onClick={async () => {
                    const cmd = `curl -L -o ${dlName} "${shareResult.url}"`;
                    const ok = await copyToClipboard(cmd);
                    notifications.show({ message: ok ? 'curl command copied!' : 'Failed to copy', color: ok ? 'teal' : 'red' });
                    if (ok) closeAll();
                  }}>
                    <IconClipboard size={16} />
                  </ActionIcon>
                </Group>
              </Box>
              <Button variant="light" leftSection={<IconMail size={16} />} onClick={() => emailEnabled ? setShowEmailDialog(true) : setShowEmailNotConfigured(true)}>
                Send via Email
              </Button>
              <Text size="xs" c="dimmed">This link expires in 15 minutes, can only be used once, and requires no authentication.</Text>
            </Stack>
          );
        })()}
      </Modal>

      <Modal opened={showEmailDialog} onClose={() => { setShowEmailDialog(false); setEmailAddress(''); }} title="Send Share Link via Email">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">Enter the recipient's email address. You will be asked to confirm before sending.</Text>
          <TextInput
            label="Email address"
            placeholder="recipient@example.com"
            type="email"
            required
            value={emailAddress}
            onChange={(e) => setEmailAddress(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setShowEmailDialog(false); setEmailAddress(''); }}>Cancel</Button>
            <Button
              disabled={!emailAddress || !emailAddress.includes('@')}
              onClick={() => { setShowEmailDialog(false); setShowEmailConfirm(true); }}
            >
              Continue
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={showEmailConfirm} onClose={() => setShowEmailConfirm(false)} title="Confirm Send">
        <Stack gap="sm">
          <Text>Send share link for <strong>{shareResult?.fileType}</strong> to:</Text>
          <Text fw={500}>{emailAddress}</Text>
          <Text size="sm" c="dimmed">This link expires in 15 minutes and can only be used once. Please verify the email address is correct.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setShowEmailConfirm(false)}>Cancel</Button>
            <Button
              loading={emailMutation.isPending}
              onClick={() => {
                if (shareResult) {
                  emailMutation.mutate({
                    email: emailAddress,
                    url: shareResult.url,
                    fileName: fileNameFor(shareResult.fileType),
                    fileType: shareResult.fileType,
                  });
                }
              }}
            >
              Confirm Send
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={showEmailNotConfigured} onClose={() => setShowEmailNotConfigured(false)} title="Email Not Configured">
        <Stack gap="sm">
          <Text>SMTP email settings have not been configured. Please set up email in Settings before sending share links via email.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setShowEmailNotConfigured(false)}>Cancel</Button>
            <Button onClick={() => { setShowEmailNotConfigured(false); navigate('/settings'); }}>Go to Settings</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export default ShareLinkDialog;
