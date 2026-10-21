import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { NativeSelect, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import {
  IconAdjustmentsHorizontal,
  IconCertificate,
  IconChevronDown,
  IconDatabase,
  IconSearch,
  IconShieldCheck,
  IconUser,
} from '@tabler/icons-react';
import { authFetchJson } from '../api/client';
import {
  AUDIT_KINDS,
  auditKind,
  auditVerb,
  countsPerDay,
  dayKey,
  dayLabel,
  type AuditEntry,
  type AuditKind,
} from '../utils/audit';
import classes from './Admin.module.css';
import audit from './AuditLog.module.css';

const RECENT_DAYS = 90;
const PAGE = 100;
// A homelab log is small; stop paging after this many entries rather than loop forever.
const MAX_ENTRIES = 5000;

const KIND_ICON: Record<AuditKind, typeof IconCertificate> = {
  certificate: IconCertificate,
  ca: IconShieldCheck,
  user: IconUser,
  settings: IconAdjustmentsHorizontal,
  system: IconDatabase,
};

/** Pages through the log, newest first, until entries pass `since` (or the log ends). */
async function loadAudit(since: Date | null): Promise<{ entries: AuditEntry[]; total: number }> {
  const entries: AuditEntry[] = [];
  let total = 0;
  for (let page = 1; entries.length < MAX_ENTRIES; page++) {
    const data = await authFetchJson<{ entries: AuditEntry[] | null; total: number }>(
      `/api/audit?page=${page}&limit=${PAGE}`,
    );
    total = data.total;
    const batch = data.entries ?? [];
    entries.push(...batch);
    const oldest = batch[batch.length - 1];
    if (batch.length < PAGE || (since && oldest && new Date(oldest.createdAt) < since)) break;
  }
  return { entries, total };
}

/** Every change, who made it and when. Admin only; the server enforces it. */
function AuditLog() {
  const today = useMemo(() => new Date(), []);
  const since = useMemo(
    () => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (RECENT_DAYS - 1)),
    [today],
  );
  const [allTime, setAllTime] = useState(false);
  const [kind, setKind] = useState<AuditKind | 'all'>('all');
  const [person, setPerson] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit', allTime ? 'all' : 'recent'],
    queryFn: () => loadAudit(allTime ? null : since),
  });

  const inRange = useMemo(
    () => (data?.entries ?? []).filter((e) => allTime || new Date(e.createdAt) >= since),
    [data, allTime, since],
  );
  const people = useMemo(
    () => [...new Set(inRange.map((e) => e.userEmail).filter((v): v is string => !!v))].sort(),
    [inRange],
  );
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { all: inRange.length };
    for (const e of inRange) counts[auditKind(e.action)] = (counts[auditKind(e.action)] ?? 0) + 1;
    return counts;
  }, [inRange]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inRange.filter(
      (e) =>
        (kind === 'all' || auditKind(e.action) === kind) &&
        (!person || e.userEmail === person) &&
        (!needle ||
          e.details.toLowerCase().includes(needle) ||
          auditVerb(e.action).includes(needle) ||
          (e.userEmail ?? '').toLowerCase().includes(needle)),
    );
  }, [inRange, kind, person, query]);

  const perDay = useMemo(() => countsPerDay(shown, today, RECENT_DAYS), [shown, today]);
  const peak = Math.max(1, ...perDay.map((d) => d.count));
  const groups = useMemo(() => {
    const map = new Map<string, AuditEntry[]>();
    for (const e of shown)
      map.set(dayKey(e.createdAt), [...(map.get(dayKey(e.createdAt)) ?? []), e]);
    return [...map.entries()];
  }, [shown]);

  const older = (data?.total ?? 0) - inRange.length;
  const truncated = allTime && (data?.entries.length ?? 0) >= MAX_ENTRIES;

  return (
    <div className={classes.page}>
      <div>
        <h1 className={classes.title}>Audit log</h1>
        <div className="gl-second-line">
          Every change, who made it and when. Only admins see this.
        </div>
      </div>

      <div role="toolbar" aria-label="Filters" className={audit.toolbar}>
        <div role="group" aria-label="Kind of change" className={classes.segments}>
          {AUDIT_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              className={classes.segment}
              aria-pressed={kind === k.value}
              onClick={() => setKind(k.value)}
            >
              {k.label}
              <span className={classes.segmentCount}>{kindCounts[k.value] ?? 0}</span>
            </button>
          ))}
        </div>
        <div style={{ flexGrow: 1 }} />
        <label className={classes.labelled}>
          Person
          <NativeSelect
            value={person}
            onChange={(e) => setPerson(e.currentTarget.value)}
            data={[
              { value: '', label: 'Everyone' },
              ...people.map((p) => ({ value: p, label: p })),
            ]}
          />
        </label>
        <TextInput
          type="search"
          aria-label="Filter by name or detail"
          placeholder="Filter by name or detail"
          leftSection={<IconSearch size={16} stroke={1.8} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          w={240}
        />
      </div>

      <section aria-labelledby="per-day-h" className={audit.chartSection}>
        <div className={classes.sectionHeader}>
          <h2 id="per-day-h" className="gl-section-label">
            Changes per day
          </h2>
          <span className={classes.rule} />
          <span className="gl-second-line">last {RECENT_DAYS} days</span>
        </div>
        <div role="list" aria-label="Changes per day" className={audit.days}>
          {perDay.map((d) => {
            const label = `${dayLabel(d.day, today)}: ${d.count} ${d.count === 1 ? 'change' : 'changes'}`;
            return (
              <span
                key={d.day}
                role="listitem"
                className={audit.day}
                title={label}
                aria-label={label}
                style={{
                  height: d.count ? `${Math.max(8, (d.count / peak) * 100)}%` : '2px',
                  background: d.count ? 'var(--gl-text-muted)' : 'var(--gl-fill)',
                }}
              />
            );
          })}
        </div>
        <div className={`${audit.axis} gl-literal`}>
          <span>{dayLabel(perDay[0].day, today)}</span>
          <span>Today</span>
        </div>
      </section>

      {isLoading ? (
        <div className={classes.loading} aria-label="Loading" />
      ) : isError ? (
        <p className={classes.error}>Could not load the audit log.</p>
      ) : shown.length === 0 ? (
        <div className={classes.empty}>
          {inRange.length === 0 ? 'No changes in this period.' : 'No changes match these filters.'}
        </div>
      ) : (
        groups.map(([key, rows]) => (
          <section key={key} aria-label={dayLabel(key, today)} className={audit.group}>
            <div className={classes.sectionHeader}>
              <h2 className="gl-section-label" style={{ letterSpacing: '0.06em' }}>
                {dayLabel(key, today)}
              </h2>
              <span className={classes.rule} />
              <span className="gl-second-line">
                {rows.length} {rows.length === 1 ? 'change' : 'changes'}
              </span>
            </div>
            {rows.map((e) => (
              <AuditRow
                key={e.id}
                entry={e}
                open={open === e.id}
                onToggle={() => setOpen(open === e.id ? null : e.id)}
              />
            ))}
          </section>
        ))
      )}

      {!isLoading && !isError && (
        <div className={audit.foot}>
          <span className="gl-second-line">
            {allTime
              ? truncated
                ? `Showing the newest ${MAX_ENTRIES} changes.`
                : 'Showing everything since setup.'
              : older > 0
                ? `${older} older ${older === 1 ? 'change is' : 'changes are'} not shown.`
                : 'Nothing older.'}
          </span>
          {!allTime && older > 0 && (
            <button type="button" className={classes.linkButton} onClick={() => setAllTime(true)}>
              Show all time
            </button>
          )}
          {allTime && (
            <button type="button" className={classes.linkButton} onClick={() => setAllTime(false)}>
              Back to the last {RECENT_DAYS} days
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AuditRow({
  entry,
  open,
  onToggle,
}: {
  entry: AuditEntry;
  open: boolean;
  onToggle: () => void;
}) {
  const kind = auditKind(entry.action);
  const Icon = KIND_ICON[kind];
  const who = entry.userEmail ?? 'System';
  const when = new Date(entry.createdAt);
  const deleted = entry.action.endsWith('.delete');
  const target =
    !deleted && entry.entityId && entry.entityType === 'certificate'
      ? { to: `/certificates/${entry.entityId}`, text: 'Open the certificate' }
      : !deleted && entry.entityId && entry.entityType === 'ca'
        ? { to: `/ca/${entry.entityId}`, text: 'Open the authority' }
        : null;

  return (
    <div>
      <button type="button" className={audit.row} aria-expanded={open} onClick={onToggle}>
        <span className={audit.icon}>
          <Icon size={16} stroke={1.8} aria-hidden="true" />
        </span>
        <span className={audit.sentence}>
          {who} {auditVerb(entry.action)}
          {entry.details && <span className={audit.detail}> · {entry.details}</span>}
        </span>
        <span className="gl-literal" style={{ color: 'var(--gl-text-muted)' }}>
          {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        <IconChevronDown size={14} stroke={1.8} className={audit.chevron} aria-hidden="true" />
      </button>
      {open && (
        <dl className={audit.facts}>
          <dt>Action</dt>
          <dd className="gl-literal">{entry.action}</dd>
          <dt>Entity</dt>
          <dd>
            {entry.entityType ?? 'None'}
            {entry.entityId && <span className="gl-literal"> · {entry.entityId}</span>}
          </dd>
          <dt>By</dt>
          <dd className="gl-literal">{who}</dd>
          <dt>When</dt>
          <dd className="gl-tnum">{when.toLocaleString()}</dd>
          <dt>Details</dt>
          <dd>{entry.details || 'None'}</dd>
          {target && (
            <>
              <dt />
              <dd>
                <Link to={target.to}>{target.text}</Link>
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

export default AuditLog;
