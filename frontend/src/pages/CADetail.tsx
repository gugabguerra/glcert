import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Select } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconLink, IconPlus, IconTrash } from '@tabler/icons-react';
import { authFetch, authFetchJson } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { ShareLinkDialog } from '../components/ShareLinkDialog';
import {
  DeleteDialog,
  DownloadMenu,
  Facts,
  SectionHeader,
  Warning,
  useEmailEnabled,
  useInvalidateLists,
  type Fact,
} from '../components/timeline/DetailsPanel';
import { TimelineChart, type TimelineRow } from '../components/timeline/TimelineChart';
import { sanitizeFilename } from '../utils/clipboard';
import { outlivesAuthority } from '../utils/validity';
import { daysUntil, expiryTone, formatDate, toneColor, type Span } from '../utils/timeline';
import type { AuthorityListItem, CertificateListItem } from '../types/pki';
import classes from './CADetail.module.css';

interface AuthorityDetail extends AuthorityListItem {
  hasPassphrase: boolean;
  parentCaName: string | null;
}

interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: string;
}

const byExpiry = (a: CertificateListItem, b: CertificateListItem) =>
  (a.expiresAt ?? '').localeCompare(b.expiresAt ?? '');

/** One authority: its own timeline, details, who can use it, and delete. */
function CADetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const canIssue = hasRole('admin', 'operator');
  const invalidateLists = useInvalidateLists();
  const emailEnabled = useEmailEnabled();
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const today = useMemo(() => new Date(), []);

  const { data: ca, isLoading } = useQuery<AuthorityDetail>({
    queryKey: ['ca', id],
    queryFn: () => authFetchJson(`/api/ca/${id}`),
  });
  const { data: certificates = [] } = useQuery<CertificateListItem[]>({
    queryKey: ['certificates'],
    queryFn: () => authFetchJson('/api/certificates'),
  });
  const { data: authorities = [] } = useQuery<AuthorityListItem[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/ca/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.text()) || 'Delete failed');
    },
    onSuccess: () => {
      invalidateLists();
      notifications.show({ message: `${ca?.name ?? 'Authority'} deleted.` });
      navigate('/ca');
    },
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  });

  if (isLoading) return <div className={classes.loading} aria-label="Loading" />;
  if (!ca)
    return <p className={classes.muted}>This authority does not exist, or you cannot see it.</p>;

  const issued = certificates.filter((c) => c.certificateAuthorityId === ca.id).sort(byExpiry);
  const outliving = issued.filter((c) => outlivesAuthority(c.expiresAt, ca.expiresAt));
  const children = authorities.filter((a) => a.parentCaId === ca.id);
  const days = daysUntil(ca.expiresAt, today);
  const safeName = sanitizeFilename(ca.name);

  // Show six years when the authority ends beyond the 18-month window.
  const span: Span = daysUntil(ca.expiresAt, today) > 420 ? '6y' : '18m';
  const rows: TimelineRow[] = [
    {
      kind: 'ca',
      id: ca.id,
      name: ca.name,
      start: ca.imported ? null : ca.createdAt,
      end: ca.expiresAt,
      days,
    },
    ...issued.map((c, i): TimelineRow => ({
      kind: 'cert',
      id: c.id,
      name: c.name,
      start: c.issuedAt,
      end: c.expiresAt,
      days: c.expiresAt ? daysUntil(c.expiresAt, today) : null,
      last: i === issued.length - 1,
      authorityEnd: outlivesAuthority(c.expiresAt, ca.expiresAt) ? ca.expiresAt : null,
    })),
  ];

  // Deleting keeps issued certificates and turns intermediates into roots (see CAHandler.Delete).
  const deleteNote = [
    'Its key and certificate are removed.',
    issued.length === 0
      ? ''
      : `Its ${issued.length} ${issued.length === 1 ? 'certificate is' : 'certificates are'} kept.`,
    children.length === 0
      ? ''
      : `${children.length === 1 ? 'Its intermediate becomes a root' : 'Its intermediates become roots'}.`,
    'This cannot be undone.',
  ]
    .filter(Boolean)
    .join(' ');

  const facts: Fact[] = [
    { label: 'Subject', value: ca.subject, literal: true },
    ...(ca.description ? [{ label: 'Description', value: ca.description }] : []),
    { label: 'Parent', value: ca.parentCaName ?? 'None, this is a root' },
    ...(children.length
      ? [{ label: 'Intermediates', value: children.map((c) => c.name).join(', ') }]
      : []),
    { label: 'Origin', value: ca.imported ? 'Imported' : 'Created here' },
    { label: 'Key', value: ca.hasPassphrase ? 'Protected by a passphrase' : 'Encrypted at rest' },
    { label: 'Version', value: `v${ca.currentVersion}, current` },
  ];

  return (
    <div className={classes.page}>
      <div className={classes.header}>
        <div style={{ minWidth: 0 }}>
          <nav aria-label="Breadcrumb" className={classes.breadcrumb}>
            <Link to="/ca">Authorities</Link>
            {ca.parentCaId && ca.parentCaName && (
              <>
                <span aria-hidden="true">/</span>
                <Link to={`/ca/${ca.parentCaId}`}>{ca.parentCaName}</Link>
              </>
            )}
            <span aria-hidden="true">/</span>
            <span aria-current="page">{ca.name}</span>
          </nav>
          <h1 className={classes.title}>{ca.name}</h1>
          <div className="gl-second-line">
            Authority · {issued.length} {issued.length === 1 ? 'certificate' : 'certificates'} ·{' '}
            {ca.imported ? 'imported ' : 'issued '}
            <span className="gl-literal">{formatDate(ca.createdAt)}</span>
          </div>
        </div>
        <div className={classes.validity}>
          <span
            className={classes.days}
            style={{ color: days <= 30 ? toneColor[expiryTone(days)] : 'var(--gl-text)' }}
          >
            {days < 0 ? `−${-days}` : days}
          </span>
          <span className={classes.unit}>
            {days < 0 ? 'days ago' : days === 1 ? 'day left' : 'days left'} ·{' '}
            <span className="gl-literal gl-tnum">{formatDate(ca.expiresAt)}</span>
          </span>
        </div>
      </div>

      <div className={classes.actions}>
        {canIssue && (
          <Button
            component={Link}
            to={`/certificates/new?caId=${encodeURIComponent(ca.id)}`}
            leftSection={<IconPlus size={16} stroke={1.8} />}
          >
            Issue a certificate
          </Button>
        )}
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
          leftSection={<IconLink size={16} stroke={1.8} />}
          onClick={() => setSharing(true)}
        >
          Share link
        </Button>
      </div>

      {outliving.length > 0 && (
        <Warning
          title={`${outliving.length} ${outliving.length === 1 ? 'certificate outlives' : 'certificates outlive'} this authority`}
          text={`${outliving.map((c) => c.name).join(', ')} ${outliving.length === 1 ? 'expires' : 'expire'} after ${formatDate(ca.expiresAt)}. On that day clients stop trusting ${outliving.length === 1 ? 'it' : 'them'}, because the authority that signed ${outliving.length === 1 ? 'it' : 'them'} has ended.`}
          action={canIssue ? { label: 'Issue replacements', to: '/certificates/new' } : undefined}
        />
      )}

      <TimelineChart
        rows={rows}
        span={span}
        today={today}
        selected={null}
        onSelect={(s) => s.kind === 'cert' && navigate(`/certificates/${s.id}`)}
        marker={{ date: ca.expiresAt, label: 'Authority ends' }}
      />

      <div className={classes.columns}>
        <section className={classes.column} aria-label="Details">
          <Facts facts={facts} />
        </section>
        {isAdmin && <AccessSection caId={ca.id} />}
      </div>

      {isAdmin && (
        <div className={classes.danger}>
          <div className={classes.dangerText}>
            <span style={{ fontSize: 14, lineHeight: '20px', color: 'var(--gl-text-soft)' }}>
              Delete this authority
            </span>
            <span className="gl-second-line">{deleteNote}</span>
          </div>
          <Button
            color="red"
            variant="outline"
            leftSection={<IconTrash size={16} stroke={1.8} />}
            onClick={() => setDeleting(true)}
          >
            Delete authority
          </Button>
        </div>
      )}

      <DeleteDialog
        opened={deleting}
        name={ca.name}
        text={deleteNote}
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
    </div>
  );
}

/** Admins see who can use this authority and grant or remove access. Enforced by the server. */
function AccessSection({ caId }: { caId: string }) {
  const queryClient = useQueryClient();
  const [pick, setPick] = useState<string | null>(null);

  const { data: users = [] } = useQuery<UserSummary[]>({
    queryKey: ['users'],
    queryFn: () => authFetchJson('/api/users'),
  });
  const { data: permissions } = useQuery<{ caId: string; userIds: string[] }>({
    queryKey: ['caPermissions', caId],
    queryFn: () => authFetchJson(`/api/ca/${caId}/permissions`),
  });

  const save = useMutation({
    mutationFn: (userIds: string[]) =>
      authFetchJson(`/api/ca/${caId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caPermissions', caId] });
      setPick(null);
    },
    onError: () => notifications.show({ color: 'red', message: 'Could not update access.' }),
  });

  const granted = permissions?.userIds ?? [];
  const admins = users.filter((u) => u.role === 'admin');
  const members = users.filter((u) => u.role !== 'admin' && granted.includes(u.id));
  const candidates = users.filter((u) => u.role !== 'admin' && !granted.includes(u.id));
  const label = (u: UserSummary) => u.name || u.email;
  const roleWord = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

  const person = (u: UserSummary, note: string, action?: React.ReactNode) => (
    <div key={u.id} className={classes.person}>
      <span className={classes.avatar} aria-hidden="true">
        {label(u).charAt(0).toUpperCase()}
      </span>
      <span className={classes.who}>
        <span className={classes.personName}>{label(u)}</span>
        <span className="gl-second-line">{note}</span>
      </span>
      {action}
    </div>
  );

  return (
    <section className={classes.column} aria-label="Who can use it">
      <SectionHeader title="Who can use it" />
      {admins.map((u) => person(u, 'Admin, can use every authority'))}
      {members.map((u) =>
        person(
          u,
          u.role === 'operator' ? 'Operator, can issue from it' : `${roleWord(u.role)}, can see it`,
          <Button
            variant="subtle"
            size="compact-sm"
            loading={save.isPending}
            onClick={() => save.mutate(granted.filter((id) => id !== u.id))}
          >
            Remove
          </Button>,
        ),
      )}
      {members.length === 0 && (
        <p className={classes.muted}>
          No operators have access yet. Operators only see the authorities you give them.
        </p>
      )}
      {candidates.length > 0 && (
        <div className={classes.grant}>
          <Select
            aria-label="Choose a user"
            placeholder="Choose a user"
            data={candidates.map((u) => ({ value: u.id, label: `${label(u)} (${u.role})` }))}
            value={pick}
            onChange={setPick}
            w={240}
          />
          <Button
            variant="default"
            disabled={!pick}
            loading={save.isPending}
            onClick={() => pick && save.mutate([...granted, pick])}
          >
            Give access
          </Button>
        </div>
      )}
    </section>
  );
}

export default CADetail;
