import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Group, Menu, Modal, NumberInput, Stack, Text } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconChevronDown,
  IconDownload,
  IconLink,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { authFetch, authFetchJson, downloadFile } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { ShareLinkDialog } from '../ShareLinkDialog';
import { sanitizeFilename } from '../../utils/clipboard';
import { outlivesAuthority } from '../../utils/validity';
import {
  clamp01,
  daysUntil,
  expiryTone,
  formatDate,
  percent,
  toneColor,
} from '../../utils/timeline';
import {
  certificateTypeLabel,
  type AuthorityListItem,
  type CertificateListItem,
} from '../../types/pki';
import type { Selection } from './TimelineChart';
import classes from './DetailsPanel.module.css';

const ICON = { size: 16, stroke: 1.8 } as const;

interface CertificateDetail {
  commonName: string;
  dnsNames: string[] | null;
  ipAddresses: string[] | null;
}

interface CertificateVersion {
  version: number;
  serialNumber: string;
  fingerprint: string;
  signatureAlgorithm: string;
  publicKeyAlgorithm: string;
}

export interface Fact {
  label: string;
  value: string;
  literal?: boolean;
}

interface DetailsPanelProps {
  selection: Selection | null;
  authorities: AuthorityListItem[];
  certificates: CertificateListItem[];
  today: Date;
  onClose: () => void;
  emptyText?: string;
}

export function DetailsPanel({
  selection,
  authorities,
  certificates,
  today,
  onClose,
  emptyText = 'Pick a row to see its details.',
}: DetailsPanelProps) {
  const ca = selection?.kind === 'ca' ? authorities.find((a) => a.id === selection.id) : undefined;
  const cert =
    selection?.kind === 'cert' ? certificates.find((c) => c.id === selection.id) : undefined;

  // When the panel has wrapped below the chart (narrow windows), bring it into view on a pick.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!selection || !el || el.getBoundingClientRect().top < window.innerHeight * 0.6) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [selection]);

  return (
    <aside ref={ref} className={classes.panel} aria-label="Details">
      {ca ? (
        <AuthorityDetails
          key={ca.id}
          ca={ca}
          certificates={certificates}
          today={today}
          onClose={onClose}
        />
      ) : cert ? (
        <CertificateDetails
          key={cert.id}
          cert={cert}
          authority={authorities.find((a) => a.id === cert.certificateAuthorityId)}
          today={today}
          onClose={onClose}
        />
      ) : (
        <div className={classes.empty}>{emptyText}</div>
      )}
    </aside>
  );
}

// ── Shared pieces ───────────────────────────────────────────────────────────

function Head({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  return (
    <div className={classes.head}>
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <h2 className={classes.title}>{title}</h2>
        <div className="gl-second-line">{sub}</div>
      </div>
      <Button variant="subtle" px={8} aria-label="Close details" onClick={onClose}>
        <IconX {...ICON} />
      </Button>
    </div>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return (
    <div className={classes.sectionHeader}>
      <h3 className="gl-section-label">{title}</h3>
      <span className={classes.rule} />
    </div>
  );
}

export function Warning({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { label: string; to: string };
}) {
  return (
    <div role="note" className={classes.warning}>
      <span className={classes.warningIcon}>
        <IconAlertTriangle {...ICON} aria-hidden="true" />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className={classes.warningTitle}>{title}</div>
        <p className={classes.body}>{text}</p>
        {action && (
          <Link
            to={action.to}
            style={{ alignSelf: 'flex-start', fontSize: 14, lineHeight: '22px' }}
          >
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}

interface ValidityProps {
  start: string | null;
  end: string | null;
  today: Date;
  /** The issuing authority's end, when the certificate outlives it. */
  authorityEnd?: string | null;
}

function Validity({ start, end, today, authorityEnd }: ValidityProps) {
  if (!end) {
    return (
      <section aria-label="Validity" className={classes.section}>
        <SectionHeader title="Validity" />
        <p className={classes.body}>The expiry date is not known.</p>
      </section>
    );
  }
  const days = daysUntil(end, today);
  const tone = expiryTone(days);
  const total = start ? Date.parse(end) - Date.parse(start) : 0;
  const used = start && total > 0 ? clamp01((today.getTime() - Date.parse(start)) / total) : null;
  const caEnd =
    start && authorityEnd && total > 0
      ? clamp01((Date.parse(authorityEnd) - Date.parse(start)) / total)
      : null;
  const unit =
    days < 0 ? (days === -1 ? 'day ago' : 'days ago') : days === 1 ? 'day left' : 'days left';

  return (
    <section aria-label="Validity" className={classes.section}>
      <SectionHeader title="Validity" />
      <div className={classes.daysRow}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            className={classes.days}
            style={{ color: days <= 30 ? toneColor[tone] : 'var(--gl-text)' }}
          >
            {days < 0 ? `−${-days}` : days}
          </span>
          <span className={classes.unit}>{unit}</span>
        </span>
        <span className="gl-literal gl-tnum" style={{ color: 'var(--gl-text-muted)' }}>
          {formatDate(end)}
        </span>
      </div>
      <div className={classes.track} aria-hidden="true">
        {used !== null && <span className={classes.used} style={{ width: percent(used) }} />}
        {caEnd !== null && (
          <>
            <span className={`${classes.out} gl-hatch`} style={{ left: percent(caEnd) }} />
            <span className={classes.caEnd} style={{ left: percent(caEnd) }} />
          </>
        )}
      </div>
      <div
        className={`${classes.dates} gl-literal gl-tnum`}
        style={{ color: 'var(--gl-text-muted)' }}
      >
        <span>{start ? formatDate(start) : 'Issue date unknown'}</span>
        {caEnd !== null && authorityEnd && (
          <span style={{ color: 'var(--gl-warning)' }}>{formatDate(authorityEnd)}</span>
        )}
        <span>{formatDate(end)}</span>
      </div>
    </section>
  );
}

export function Facts({ facts }: { facts: Fact[] }) {
  return (
    <section aria-label="Details" className={classes.section}>
      <SectionHeader title="Details" />
      <dl className={classes.facts}>
        {facts.map((f) => (
          <div key={f.label} style={{ display: 'contents' }}>
            <dt>{f.label}</dt>
            <dd data-literal={f.literal || undefined}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export interface DownloadOption {
  label: string;
  url: string;
  filename: string;
}

export function DownloadMenu({ options }: { options: DownloadOption[] }) {
  const download = (o: DownloadOption) =>
    downloadFile(o.url, o.filename).catch(() =>
      notifications.show({ color: 'red', message: `Could not download ${o.filename}.` }),
    );
  return (
    <Menu position="bottom-start">
      <Menu.Target>
        <Button
          variant="default"
          leftSection={<IconDownload {...ICON} />}
          rightSection={<IconChevronDown size={14} stroke={1.8} />}
        >
          Download
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {options.map((o) => (
          <Menu.Item key={o.url} onClick={() => download(o)}>
            {o.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

export function useEmailEnabled() {
  const { hasRole } = useAuth();
  const { data } = useQuery<{ smtpHost: string }>({
    queryKey: ['settings'],
    queryFn: () => authFetchJson('/api/settings'),
    enabled: hasRole('admin'),
    retry: false,
  });
  return !!data?.smtpHost;
}

export function DeleteDialog({
  opened,
  name,
  text,
  pending,
  onCancel,
  onConfirm,
}: {
  opened: boolean;
  name: string;
  text: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onCancel} title={`Delete ${name}?`} size={420}>
      <Stack>
        <Text size="sm" c="var(--gl-text-soft)" fw={300}>
          {text}
        </Text>
        <Group justify="flex-end">
          {/* Cancel takes focus first: the action cannot be undone. */}
          <Button variant="default" onClick={onCancel} data-autofocus>
            Cancel
          </Button>
          <Button color="red" variant="outline" loading={pending} onClick={onConfirm}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function useInvalidateLists() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['certificates'] });
    queryClient.invalidateQueries({ queryKey: ['cas'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

// ── Certificate ─────────────────────────────────────────────────────────────

function CertificateDetails({
  cert,
  authority,
  today,
  onClose,
}: {
  cert: CertificateListItem;
  authority: AuthorityListItem | undefined;
  today: Date;
  onClose: () => void;
}) {
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const invalidateLists = useInvalidateLists();
  const emailEnabled = useEmailEnabled();
  const [sharing, setSharing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [validityDays, setValidityDays] = useState(365);
  const [deleting, setDeleting] = useState(false);
  const canManage = hasRole('admin', 'operator');

  const { data: detail } = useQuery<CertificateDetail>({
    queryKey: ['certificate', cert.id],
    queryFn: () => authFetchJson(`/api/certificates/${cert.id}`),
  });
  const { data: versions } = useQuery<CertificateVersion[]>({
    queryKey: ['certificateVersions', cert.id],
    queryFn: () => authFetchJson(`/api/certificates/${cert.id}/versions`),
  });
  const current = versions?.find((v) => v.version === cert.currentVersion);

  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/certificates/${cert.id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validityDays }),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Regenerate failed');
    },
    onSuccess: () => {
      invalidateLists();
      queryClient.invalidateQueries({ queryKey: ['certificate', cert.id] });
      queryClient.invalidateQueries({ queryKey: ['certificateVersions', cert.id] });
      setRegenerating(false);
      notifications.show({ message: `${cert.name} regenerated.` });
    },
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/certificates/${cert.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.text()) || 'Delete failed');
    },
    onSuccess: () => {
      invalidateLists();
      setDeleting(false);
      onClose();
      notifications.show({ message: `${cert.name} deleted.` });
    },
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  });

  const safeName = sanitizeFilename(cert.name);
  const hasCa = !!cert.certificateAuthorityId;
  const outlives = !!authority && outlivesAuthority(cert.expiresAt, authority.expiresAt);
  const lateDays =
    outlives && cert.expiresAt && authority
      ? Math.round((Date.parse(cert.expiresAt) - Date.parse(authority.expiresAt)) / 86_400_000)
      : 0;
  const typeLabel = certificateTypeLabel[cert.type] ?? 'Certificate';
  const altNames = [...(detail?.dnsNames ?? []), ...(detail?.ipAddresses ?? [])];

  const facts: Fact[] = [
    { label: 'Issuer', value: cert.caName || 'Self-signed' },
    { label: 'Common name', value: detail?.commonName ?? '…', literal: true },
    ...(altNames.length ? [{ label: 'Alt names', value: altNames.join(' '), literal: true }] : []),
    ...(current
      ? [
          {
            label: 'Key',
            value: `${current.publicKeyAlgorithm} · ${current.signatureAlgorithm}`,
            literal: true,
          },
          { label: 'Serial', value: current.serialNumber, literal: true },
          { label: 'SHA-256', value: current.fingerprint, literal: true },
        ]
      : []),
    { label: 'Version', value: `v${cert.currentVersion}, current` },
    { label: 'Group', value: cert.groupName || 'None' },
  ];

  return (
    <>
      <div className={classes.content}>
        <Head
          title={cert.name}
          sub={cert.caName ? `${typeLabel} · ${cert.caName}` : typeLabel}
          onClose={onClose}
        />

        <div className={classes.actions}>
          <DownloadMenu
            options={[
              {
                label: 'Certificate (cert.pem)',
                url: `/api/certificates/${cert.id}/download/cert`,
                filename: `${safeName}-cert.pem`,
              },
              {
                label: 'Private key (key.pem)',
                url: `/api/certificates/${cert.id}/download/key`,
                filename: `${safeName}-key.pem`,
              },
              ...(hasCa
                ? [
                    {
                      label: 'Authority certificate (ca.pem)',
                      url: `/api/certificates/${cert.id}/download/ca`,
                      filename: `${safeName}-ca.pem`,
                    },
                  ]
                : []),
              {
                label: 'Bundle (ZIP)',
                url: `/api/certificates/${cert.id}/download/bundle?format=zip`,
                filename: `${safeName}-bundle.zip`,
              },
              {
                label: 'Bundle (tarball)',
                url: `/api/certificates/${cert.id}/download/bundle?format=tgz`,
                filename: `${safeName}-bundle.tar.gz`,
              },
            ]}
          />
          <Button
            variant="default"
            leftSection={<IconLink {...ICON} />}
            onClick={() => setSharing(true)}
          >
            Share link
          </Button>
          {canManage && (
            <Button
              variant="default"
              leftSection={<IconRefresh {...ICON} />}
              onClick={() => setRegenerating(true)}
            >
              Regenerate
            </Button>
          )}
        </div>

        {outlives && authority && (
          <Warning
            title="Outlives its authority"
            text={`${authority.name} ends on ${formatDate(authority.expiresAt)}, ${lateDays} days before this certificate. Clients stop trusting it that day.`}
            action={
              canManage ? { label: 'Issue a replacement', to: '/certificates/new' } : undefined
            }
          />
        )}

        <Validity
          start={cert.issuedAt}
          end={cert.expiresAt}
          today={today}
          authorityEnd={outlives ? authority?.expiresAt : null}
        />
        <Facts facts={facts} />
      </div>

      <div className={classes.footer}>
        <span className={`${classes.footNote} gl-second-line`}>
          <Link to={`/certificates/${cert.id}`}>Versions and full details</Link>
        </span>
        {canManage && (
          <Button
            color="red"
            variant="outline"
            leftSection={<IconTrash {...ICON} />}
            onClick={() => setDeleting(true)}
          >
            Delete
          </Button>
        )}
      </div>

      <Modal
        opened={regenerating}
        onClose={() => setRegenerating(false)}
        title={`Regenerate ${cert.name}?`}
        size={420}
      >
        <Stack>
          <Text size="sm" c="var(--gl-text-soft)" fw={300}>
            A new key and certificate replace the current ones. Earlier versions stay restorable.
          </Text>
          <NumberInput
            label="Valid for (days)"
            min={1}
            max={3650}
            value={validityDays}
            onChange={(v) => setValidityDays(Number(v) || 365)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRegenerating(false)}>
              Cancel
            </Button>
            <Button loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
              Regenerate
            </Button>
          </Group>
        </Stack>
      </Modal>

      <DeleteDialog
        opened={deleting}
        name={cert.name}
        text="Its key, certificate and every earlier version are removed. This cannot be undone."
        pending={remove.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />

      <ShareLinkDialog
        opened={sharing}
        onClose={() => setSharing(false)}
        entityType="certificate"
        entityId={cert.id}
        entityName={cert.name}
        fileOptions={[
          { value: 'certificate', label: 'Certificate (cert.pem)' },
          { value: 'key', label: 'Private key (key.pem)' },
          ...(hasCa ? [{ value: 'ca', label: 'Authority certificate (ca.pem)' }] : []),
          { value: 'bundle_zip', label: 'Bundle (ZIP)' },
          { value: 'bundle_tgz', label: 'Bundle (tarball)' },
        ]}
        fileNameFor={(fileType) =>
          fileType.includes('bundle')
            ? fileType.includes('tgz')
              ? `${safeName}-bundle.tar.gz`
              : `${safeName}-bundle.zip`
            : fileType === 'ca'
              ? `${safeName}-ca.pem`
              : `${safeName}-${fileType}.pem`
        }
        emailEnabled={emailEnabled}
      />
    </>
  );
}

// ── Authority ───────────────────────────────────────────────────────────────

function AuthorityDetails({
  ca,
  certificates,
  today,
  onClose,
}: {
  ca: AuthorityListItem;
  certificates: CertificateListItem[];
  today: Date;
  onClose: () => void;
}) {
  const { hasRole } = useAuth();
  const invalidateLists = useInvalidateLists();
  const emailEnabled = useEmailEnabled();
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const issued = certificates.filter((c) => c.certificateAuthorityId === ca.id);
  const outliving = issued.filter((c) => outlivesAuthority(c.expiresAt, ca.expiresAt));
  const safeName = sanitizeFilename(ca.name);

  const remove = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/ca/${ca.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.text()) || 'Delete failed');
    },
    onSuccess: () => {
      invalidateLists();
      setDeleting(false);
      onClose();
      notifications.show({ message: `${ca.name} deleted.` });
    },
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  });

  const facts: Fact[] = [
    { label: 'Certificates', value: String(issued.length) },
    { label: 'Subject', value: ca.subject, literal: true },
    { label: 'Origin', value: ca.imported ? 'Imported' : 'Created here' },
    { label: 'Version', value: `v${ca.currentVersion}, current` },
  ];

  return (
    <>
      <div className={classes.content}>
        <Head
          title={ca.name}
          sub={`Authority · ${issued.length} ${issued.length === 1 ? 'certificate' : 'certificates'}`}
          onClose={onClose}
        />

        <div className={classes.actions}>
          <DownloadMenu
            options={[
              {
                label: 'Authority certificate (ca.crt)',
                url: `/api/ca/${ca.id}/download/cert`,
                filename: `${safeName}-ca.crt`,
              },
              {
                label: 'Private key (ca.key)',
                url: `/api/ca/${ca.id}/download/key`,
                filename: `${safeName}-ca.key`,
              },
              {
                label: 'Bundle (ZIP)',
                url: `/api/ca/${ca.id}/download/bundle?format=zip`,
                filename: `${safeName}-bundle.zip`,
              },
              {
                label: 'Bundle (tarball)',
                url: `/api/ca/${ca.id}/download/bundle?format=tgz`,
                filename: `${safeName}-bundle.tar.gz`,
              },
            ]}
          />
          <Button
            variant="default"
            leftSection={<IconLink {...ICON} />}
            onClick={() => setSharing(true)}
          >
            Share link
          </Button>
          {hasRole('admin', 'operator') && (
            <Button
              component={Link}
              to={`/certificates/new?caId=${encodeURIComponent(ca.id)}`}
              variant="default"
              leftSection={<IconPlus {...ICON} />}
            >
              Issue from here
            </Button>
          )}
        </div>

        {outliving.length > 0 && (
          <Warning
            title={`${outliving.length} ${outliving.length === 1 ? 'certificate outlives' : 'certificates outlive'} it`}
            text={`${outliving.map((c) => c.name).join(', ')} ${outliving.length === 1 ? 'expires' : 'expire'} after ${formatDate(ca.expiresAt)}. Clients stop trusting ${outliving.length === 1 ? 'it' : 'them'} that day.`}
          />
        )}

        <Validity start={ca.imported ? null : ca.createdAt} end={ca.expiresAt} today={today} />
        <Facts facts={facts} />
      </div>

      <div className={classes.footer}>
        <span className={`${classes.footNote} gl-second-line`}>
          <Link to={`/ca/${ca.id}`}>Full details and access</Link>
        </span>
        {hasRole('admin') && (
          <Button
            color="red"
            variant="outline"
            leftSection={<IconTrash {...ICON} />}
            onClick={() => setDeleting(true)}
          >
            Delete
          </Button>
        )}
      </div>

      <DeleteDialog
        opened={deleting}
        name={ca.name}
        text="Its key and certificate are removed. Certificates it issued are kept, and its intermediate authorities become roots. This cannot be undone."
        pending={remove.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />

      <ShareLinkDialog
        opened={sharing}
        onClose={() => setSharing(false)}
        entityType="ca"
        entityId={ca.id}
        entityName={ca.name}
        fileOptions={[
          { value: 'certificate', label: 'Authority certificate (ca.crt)' },
          { value: 'key', label: 'Private key (ca.key)' },
          { value: 'bundle_zip', label: 'Bundle (ZIP)' },
          { value: 'bundle_tgz', label: 'Bundle (tarball)' },
        ]}
        fileNameFor={(fileType) =>
          fileType.includes('bundle')
            ? fileType.includes('tgz')
              ? `${safeName}-bundle.tar.gz`
              : `${safeName}-bundle.zip`
            : fileType === 'certificate'
              ? `${safeName}-ca.crt`
              : `${safeName}-ca.key`
        }
        emailEnabled={emailEnabled}
      />
    </>
  );
}
