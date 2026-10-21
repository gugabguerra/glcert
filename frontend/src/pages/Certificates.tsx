import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, NativeSelect, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconPlus, IconSearch, IconUpload } from '@tabler/icons-react';
import { authFetchJson, downloadFile } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { buildAuthorityTree, outlivesAuthority } from '../utils/validity';
import {
  clamp01,
  daysUntil,
  expiryTone,
  expiryWords,
  formatDate,
  percent,
  toneColor,
} from '../utils/timeline';
import type { AuthorityListItem, CertificateListItem } from '../types/pki';
import { DetailsPanel } from '../components/timeline/DetailsPanel';
import type { Selection } from '../components/timeline/TimelineChart';
import classes from './Certificates.module.css';

const TYPES = [
  { value: 'all', label: 'All', none: 'certificates' },
  { value: 'server', label: 'Server', none: 'server certificates' },
  { value: 'client', label: 'Client', none: 'client certificates' },
  { value: 'serverclient', label: 'Server and client', none: 'server and client certificates' },
  { value: 'selfsigned', label: 'Self-signed', none: 'self-signed certificates' },
] as const;

const SHORT_TYPE: Record<string, string> = {
  server: 'Server',
  client: 'Client',
  serverclient: 'Server and client',
  selfsigned: 'Self-signed',
};

type Sort = 'expiry' | 'name' | 'newest';
const ALL_GROUPS = '\u0000all';
const NO_GROUP = '\u0000none';

interface Section {
  key: string;
  name: string;
  authority: AuthorityListItem | undefined;
  rows: CertificateListItem[];
}

/** Every certificate the user can see, grouped by issuing authority, with a details panel. */
function Certificates() {
  const { hasRole } = useAuth();
  const canWrite = hasRole('admin', 'operator');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]['value']>('all');
  const [group, setGroup] = useState(ALL_GROUPS);
  const [sort, setSort] = useState<Sort>('expiry');
  const [selected, setSelected] = useState<Selection | null>(null);
  const today = useMemo(() => new Date(), []);

  // Shared cache with the sidebar and the timeline. Viewers cannot list authorities, so their
  // sections come from each certificate's issuer name instead.
  const { data: certificates = [], isLoading } = useQuery<CertificateListItem[]>({
    queryKey: ['certificates'],
    queryFn: () => authFetchJson('/api/certificates'),
  });
  const { data: authorities = [] } = useQuery<AuthorityListItem[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
    enabled: !hasRole('viewer'),
  });

  const groupNames = useMemo(
    () => [...new Set(certificates.map((c) => c.groupName).filter(Boolean))].sort(),
    [certificates],
  );

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: certificates.length };
    for (const c of certificates) counts[c.type] = (counts[c.type] ?? 0) + 1;
    return counts;
  }, [certificates]);

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = certificates.filter(
      (c) =>
        (type === 'all' || c.type === type) &&
        (group === ALL_GROUPS || (group === NO_GROUP ? !c.groupName : c.groupName === group)) &&
        (!needle ||
          c.name.toLowerCase().includes(needle) ||
          c.caName.toLowerCase().includes(needle)),
    );
    const order = (a: CertificateListItem, b: CertificateListItem) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'newest'
          ? (b.issuedAt ?? b.createdAt).localeCompare(a.issuedAt ?? a.createdAt)
          : (a.expiresAt ?? '￿').localeCompare(b.expiresAt ?? '￿');

    const byAuthority = new Map<string, CertificateListItem[]>();
    for (const c of visible) {
      const key = c.certificateAuthorityId ?? '';
      byAuthority.set(key, [...(byAuthority.get(key) ?? []), c]);
    }

    // Authorities in sidebar order, then any issuer the user cannot list, then no authority.
    const result: Section[] = [];
    const seen = new Set<string>();
    for (const { authority } of buildAuthorityTree(authorities, certificates)) {
      const rows = byAuthority.get(authority.id);
      seen.add(authority.id);
      if (rows?.length) {
        result.push({
          key: authority.id,
          name: authority.name,
          authority: authorities.find((a) => a.id === authority.id),
          rows: rows.sort(order),
        });
      }
    }
    const others = [...byAuthority.entries()]
      .filter(([key]) => key && !seen.has(key))
      .sort(([, a], [, b]) => a[0].caName.localeCompare(b[0].caName));
    for (const [key, rows] of others) {
      result.push({
        key,
        name: rows[0].caName || 'Unknown authority',
        authority: undefined,
        rows: rows.sort(order),
      });
    }
    const none = byAuthority.get('');
    if (none?.length)
      result.push({
        key: 'none',
        name: 'No authority',
        authority: undefined,
        rows: none.sort(order),
      });
    return result;
  }, [certificates, authorities, query, type, group, sort]);

  const shown = sections.reduce((sum, s) => sum + s.rows.length, 0);
  const filtered = !!query.trim() || type !== 'all' || group !== ALL_GROUPS;
  const typeNone = TYPES.find((t) => t.value === type)!.none;

  const downloadGroup = () => {
    const name = group;
    downloadFile(
      `/api/certificates/download/group?name=${encodeURIComponent(name)}&format=zip`,
      `${name}.zip`,
    ).catch(() => notifications.show({ color: 'red', message: `Could not download ${name}.` }));
  };

  return (
    <div className={classes.workbench}>
      <div className={classes.main}>
        <div className={classes.header}>
          <h1 className={classes.title}>Certificates</h1>
          <span className="gl-literal gl-tnum" style={{ color: 'var(--gl-text-muted)' }}>
            {filtered ? `${shown} of ${certificates.length}` : certificates.length}
          </span>
          <div style={{ flexGrow: 1 }} />
          <TextInput
            className={classes.search}
            type="search"
            placeholder="Filter"
            aria-label="Filter by name or authority"
            leftSection={<IconSearch size={16} stroke={1.8} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          {canWrite && (
            <>
              <Button
                component={Link}
                to="/certificates/import"
                variant="default"
                leftSection={<IconUpload size={16} stroke={1.8} />}
              >
                Import
              </Button>
              <Button
                component={Link}
                to="/certificates/new"
                leftSection={<IconPlus size={16} stroke={1.8} />}
              >
                New certificate
              </Button>
            </>
          )}
        </div>

        <div role="toolbar" aria-label="Filters" className={classes.toolbar}>
          <div role="group" aria-label="Type" className={classes.segments}>
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={classes.segment}
                aria-pressed={type === t.value}
                onClick={() => setType(t.value)}
              >
                {t.label}
                <span className={classes.segmentCount}>{typeCounts[t.value] ?? 0}</span>
              </button>
            ))}
          </div>
          <div style={{ flexGrow: 1 }} />
          {groupNames.length > 0 && (
            <label className={classes.labelled}>
              Group
              <NativeSelect
                value={group}
                onChange={(e) => setGroup(e.currentTarget.value)}
                data={[
                  { value: ALL_GROUPS, label: 'All groups' },
                  { value: NO_GROUP, label: 'No group' },
                  ...groupNames.map((g) => ({ value: g, label: g })),
                ]}
              />
            </label>
          )}
          {group !== ALL_GROUPS && group !== NO_GROUP && (
            <Button
              variant="default"
              leftSection={<IconDownload size={16} stroke={1.8} />}
              onClick={downloadGroup}
            >
              Download group
            </Button>
          )}
          <label className={classes.labelled}>
            Sort
            <NativeSelect
              value={sort}
              onChange={(e) => setSort(e.currentTarget.value as Sort)}
              data={[
                { value: 'expiry', label: 'Expiry' },
                { value: 'name', label: 'Name' },
                { value: 'newest', label: 'Newest' },
              ]}
            />
          </label>
        </div>

        {isLoading ? (
          <div className={classes.loading} aria-label="Loading" />
        ) : shown === 0 ? (
          <div className={classes.empty}>
            <span>
              {certificates.length === 0
                ? 'No certificates yet.'
                : filtered && (query.trim() || group !== ALL_GROUPS)
                  ? `No ${typeNone} match these filters.`
                  : `No ${typeNone} yet.`}
            </span>
            {canWrite && (
              <Link to="/certificates/new" style={{ alignSelf: 'flex-start' }}>
                New certificate
              </Link>
            )}
          </div>
        ) : (
          sections.map((section) => (
            <CertificateSection
              key={section.key}
              section={section}
              today={today}
              selectedId={selected?.kind === 'cert' ? selected.id : null}
              onSelect={(id) => setSelected({ kind: 'cert', id })}
            />
          ))
        )}
      </div>

      <DetailsPanel
        selection={selected}
        authorities={authorities}
        certificates={certificates}
        today={today}
        onClose={() => setSelected(null)}
        emptyText="Pick a certificate to see its details."
      />
    </div>
  );
}

function CertificateSection({
  section,
  today,
  selectedId,
  onSelect,
}: {
  section: Section;
  today: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { authority } = section;
  const caDays = authority ? daysUntil(authority.expiresAt, today) : null;
  const meta = authority
    ? caDays! < 0
      ? 'Authority expired'
      : `Authority ends ${formatDate(authority.expiresAt)}`
    : section.key === 'none'
      ? 'Self-signed or imported'
      : '';

  return (
    <section aria-label={section.name} className={classes.group}>
      <div className={classes.groupHeader}>
        <h2 className="gl-section-label">{section.name}</h2>
        <span className={classes.rule} />
        <span
          className={classes.groupMeta}
          style={{
            color:
              caDays !== null && caDays <= 30
                ? toneColor[expiryTone(caDays)]
                : 'var(--gl-text-muted)',
          }}
        >
          {meta}
        </span>
      </div>
      <div className={classes.rows}>
        {section.rows.map((cert) => (
          <CertificateRow
            key={cert.id}
            cert={cert}
            authority={authority}
            today={today}
            pressed={cert.id === selectedId}
            onSelect={() => onSelect(cert.id)}
          />
        ))}
      </div>
    </section>
  );
}

function CertificateRow({
  cert,
  authority,
  today,
  pressed,
  onSelect,
}: {
  cert: CertificateListItem;
  authority: AuthorityListItem | undefined;
  today: Date;
  pressed: boolean;
  onSelect: () => void;
}) {
  const days = cert.expiresAt ? daysUntil(cert.expiresAt, today) : null;
  const tone = days === null ? 'muted' : expiryTone(days);
  const outlives = !!authority && outlivesAuthority(cert.expiresAt, authority.expiresAt);

  // Share of the validity already used, and where the authority ends within it.
  const start = cert.issuedAt ? Date.parse(cert.issuedAt) : null;
  const end = cert.expiresAt ? Date.parse(cert.expiresAt) : null;
  const span = start !== null && end !== null ? end - start : 0;
  const used = span > 0 ? clamp01((today.getTime() - start!) / span) : null;
  const caEnd =
    outlives && span > 0 ? clamp01((Date.parse(authority!.expiresAt) - start!) / span) : null;

  return (
    <button type="button" className={classes.row} aria-pressed={pressed} onClick={onSelect}>
      <span className={classes.nameBlock}>
        <span className={classes.name}>{cert.name}</span>
        <span className={classes.meta}>
          <span>
            {SHORT_TYPE[cert.type] ?? cert.type} · v{cert.currentVersion}
            {cert.groupName ? ` · ${cert.groupName}` : ''}
          </span>
          {outlives && <span style={{ color: 'var(--gl-warning)' }}>outlives its authority</span>}
        </span>
      </span>
      <span
        className={classes.bar}
        role="img"
        aria-label={
          used === null ? 'Validity unknown' : `${Math.round(used * 100)}% of validity used`
        }
      >
        {used !== null && (
          <span
            className={classes.used}
            style={{
              width: percent(used),
              background: tone === 'muted' ? 'var(--gl-text-muted)' : toneColor[tone],
            }}
          />
        )}
        {caEnd !== null && (
          <span className={`${classes.out} gl-hatch`} style={{ left: percent(caEnd) }} />
        )}
      </span>
      <span className={classes.expiry}>
        <span
          className={classes.words}
          style={{ color: tone === 'muted' ? 'var(--gl-text-soft)' : toneColor[tone] }}
        >
          {days === null ? 'unknown' : expiryWords(days)}
        </span>
        <span className={classes.date}>{cert.expiresAt ? formatDate(cert.expiresAt) : ''}</span>
      </span>
    </button>
  );
}

export default Certificates;
