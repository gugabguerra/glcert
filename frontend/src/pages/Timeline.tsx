import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconAlertTriangle, IconPlus } from '@tabler/icons-react';
import { authFetchJson } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { buildAuthorityTree } from '../utils/validity';
import { daysUntil, formatDate, type Span } from '../utils/timeline';
import type { AuthorityListItem, CertificateListItem } from '../types/pki';
import {
  TimelineChart,
  TimelineLegend,
  type Selection,
  type TimelineRow,
} from '../components/timeline/TimelineChart';
import { DetailsPanel } from '../components/timeline/DetailsPanel';
import classes from '../components/timeline/Timeline.module.css';

const byExpiry = (a: CertificateListItem, b: CertificateListItem) =>
  (a.expiresAt ?? '').localeCompare(b.expiresAt ?? '');

/** Home: every authority and certificate on one time axis, with a details panel. */
function Timeline() {
  const { hasRole } = useAuth();
  const [span, setSpan] = useState<Span>('18m');
  const [selected, setSelected] = useState<Selection | null>(null);
  const today = useMemo(() => new Date(), []);

  // Same query keys as the sidebar and the other pages, so they share one cache.
  const { data: certificates = [], isLoading: certsLoading } = useQuery<CertificateListItem[]>({
    queryKey: ['certificates'],
    queryFn: () => authFetchJson('/api/certificates'),
  });
  const { data: authorities = [], isLoading: casLoading } = useQuery<AuthorityListItem[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
  });

  const tree = useMemo(
    () => buildAuthorityTree(authorities, certificates),
    [authorities, certificates],
  );

  const rows = useMemo(() => {
    const result: TimelineRow[] = [];
    const visible = new Set(authorities.map((a) => a.id));
    const days = (date: string | null) => (date ? daysUntil(date, today) : null);

    for (const { authority } of tree) {
      const ca = authorities.find((a) => a.id === authority.id)!;
      result.push({
        kind: 'ca',
        id: ca.id,
        name: ca.name,
        start: ca.imported ? null : ca.createdAt,
        end: ca.expiresAt,
        days: daysUntil(ca.expiresAt, today),
      });
      const issued = certificates.filter((c) => c.certificateAuthorityId === ca.id).sort(byExpiry);
      issued.forEach((c, i) =>
        result.push({
          kind: 'cert',
          id: c.id,
          name: c.name,
          start: c.issuedAt,
          end: c.expiresAt,
          days: days(c.expiresAt),
          last: i === issued.length - 1,
          authorityEnd: c.expiresAt && c.expiresAt > ca.expiresAt ? ca.expiresAt : null,
        }),
      );
    }

    // Self-signed certificates, and any whose authority this user cannot see.
    const rest = certificates
      .filter((c) => !c.certificateAuthorityId || !visible.has(c.certificateAuthorityId))
      .sort(byExpiry);
    if (rest.length) {
      result.push({ kind: 'group', id: 'no-authority', name: 'No authority' });
      rest.forEach((c, i) =>
        result.push({
          kind: 'cert',
          id: c.id,
          name: c.name,
          start: c.issuedAt,
          end: c.expiresAt,
          days: days(c.expiresAt),
          last: i === rest.length - 1,
          authorityEnd: null,
        }),
      );
    }
    return result;
  }, [tree, authorities, certificates, today]);

  const outlivingNodes = tree.filter((n) => n.outliving.length > 0);
  const outlivingCount = outlivingNodes.reduce((sum, n) => sum + n.outliving.length, 0);
  const single = outlivingNodes.length === 1 ? outlivingNodes[0].authority : null;

  const loading = certsLoading || casLoading;
  const empty = !loading && rows.length === 0;

  return (
    <div className={classes.workbench}>
      <div className={classes.main}>
        <div className={classes.header}>
          <div>
            <h1 className={classes.title}>Timeline</h1>
            <div className="gl-second-line">
              Every authority and certificate, from issue to expiry
            </div>
          </div>
          <div className={classes.tools}>
            <div role="group" aria-label="Time span" className={classes.segments}>
              <button
                type="button"
                className={classes.segment}
                aria-pressed={span === '18m'}
                onClick={() => setSpan('18m')}
              >
                18 months
              </button>
              <button
                type="button"
                className={classes.segment}
                aria-pressed={span === '6y'}
                onClick={() => setSpan('6y')}
              >
                6 years
              </button>
            </div>
            {hasRole('admin', 'operator') && (
              <Button
                component={Link}
                to="/certificates/new"
                leftSection={<IconPlus size={16} stroke={1.8} />}
              >
                New certificate
              </Button>
            )}
          </div>
        </div>

        {outlivingCount > 0 && (
          <div role="note" className={classes.note}>
            <span className={classes.warnIcon}>
              <IconAlertTriangle size={16} stroke={1.8} aria-hidden="true" />
            </span>
            <span className={classes.noteText}>
              {single
                ? `${outlivingCount} ${outlivingCount === 1 ? 'certificate' : 'certificates'} on ${single.name} ${outlivingCount === 1 ? 'runs' : 'run'} past its end on ${formatDate(single.expiresAt)}. Clients stop trusting ${outlivingCount === 1 ? 'it' : 'them'} that day.`
                : `${outlivingCount} certificates run past the end of their authority. Clients stop trusting them that day.`}
            </span>
            {single && (
              <Link to={`/ca/${single.id}`} style={{ fontSize: 14, lineHeight: '22px' }}>
                Review {single.name}
              </Link>
            )}
          </div>
        )}

        {loading ? (
          <div className={classes.loading} aria-label="Loading" />
        ) : empty ? (
          <div className={classes.empty}>
            No authorities or certificates yet.{' '}
            {hasRole('admin') && <Link to="/ca/new">Create an authority</Link>}
          </div>
        ) : (
          <>
            <TimelineChart
              rows={rows}
              span={span}
              today={today}
              selected={selected}
              onSelect={setSelected}
            />
            <TimelineLegend />
          </>
        )}
      </div>

      <DetailsPanel
        selection={selected}
        authorities={authorities}
        certificates={certificates}
        today={today}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

export default Timeline;
