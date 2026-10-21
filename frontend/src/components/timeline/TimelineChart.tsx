import { IconShieldCheck } from '@tabler/icons-react';
import {
  buildAxis,
  clamp01,
  expiryTone,
  expiryWords,
  percent,
  toneColor,
  type Span,
} from '../../utils/timeline';
import classes from './Timeline.module.css';

export type TimelineRow =
  | {
      kind: 'ca';
      id: string;
      name: string;
      /** Null when the issue date is unknown (imported); the bar then fades in from the left. */
      start: string | null;
      end: string;
      days: number;
    }
  | {
      kind: 'cert';
      id: string;
      name: string;
      start: string | null;
      end: string | null;
      days: number | null;
      /** Last certificate under its authority, so the tree branch stops at this row. */
      last: boolean;
      /** The issuing authority's end, when the certificate outlives it. */
      authorityEnd: string | null;
    }
  | { kind: 'group'; id: string; name: string };

export interface Selection {
  kind: 'ca' | 'cert';
  id: string;
}

interface TimelineChartProps {
  rows: TimelineRow[];
  span: Span;
  today: Date;
  selected: Selection | null;
  onSelect: (selection: Selection) => void;
  /** An extra dated line in the warning colour, such as where an authority ends. */
  marker?: { date: string; label: string };
}

const ALERT_DAYS = 30;

export function TimelineChart({
  rows,
  span,
  today,
  selected,
  onSelect,
  marker,
}: TimelineChartProps) {
  const axis = buildAxis(span, today);
  const todayPos = axis.position(today);
  const showToday = todayPos >= 0 && todayPos <= 1;
  const alertEnd = axis.position(new Date(today.getTime() + ALERT_DAYS * 86_400_000));
  const markerPos = marker ? axis.position(marker.date) : -1;
  const showMarker = markerPos >= 0 && markerPos <= 1;

  return (
    <section className={classes.chart} aria-label="Validity chart">
      <div className={classes.chartInner}>
        <div className={`${classes.grid} ${classes.headRow}`}>
          <div className={classes.headLabel}>Name</div>
          <div className={classes.months}>
            {axis.cells.map((cell, i) => (
              <div key={i} className={classes.month}>
                <span>{cell.year}</span>
                <span>{cell.label}</span>
              </div>
            ))}
            {showToday && (
              <span className={classes.todayPill} style={{ left: percent(todayPos) }}>
                Today
              </span>
            )}
            {showMarker && (
              <span className={classes.markerPill} style={{ left: percent(markerPos) }}>
                {marker!.label}
              </span>
            )}
          </div>
          <div className={classes.headLabel} style={{ textAlign: 'right' }}>
            Left
          </div>
        </div>

        <div className={classes.body}>
          <div className={classes.backdrop} aria-hidden="true">
            {axis.cells.map((_, i) => (
              <span key={i} className={classes.gridline} />
            ))}
            {showToday && (
              <>
                <span
                  className={classes.alertWindow}
                  style={{
                    left: percent(todayPos),
                    width: percent(Math.max(0, clamp01(alertEnd) - todayPos)),
                  }}
                />
                <span className={classes.todayLine} style={{ left: percent(todayPos) }} />
              </>
            )}
            {showMarker && (
              <span className={classes.markerLine} style={{ left: percent(markerPos) }} />
            )}
          </div>

          <div className={classes.rows}>
            {rows.map((row) => {
              if (row.kind === 'group') {
                return (
                  <div
                    key={`group-${row.id}`}
                    className={`${classes.grid} ${classes.row}`}
                    style={{ cursor: 'default' }}
                  >
                    <span className={classes.nameCell}>
                      <span className={classes.groupName}>{row.name}</span>
                    </span>
                  </div>
                );
              }
              const pressed = selected?.kind === row.kind && selected.id === row.id;
              const words = row.days === null ? '' : expiryWords(row.days);
              const tone = row.days === null ? 'muted' : expiryTone(row.days);
              return (
                <button
                  key={`${row.kind}-${row.id}`}
                  type="button"
                  className={`${classes.grid} ${classes.row}`}
                  aria-pressed={pressed}
                  aria-label={`${row.name}, ${row.kind === 'ca' ? 'authority' : 'certificate'}, ${
                    words === 'expired'
                      ? 'expired'
                      : words
                        ? `expires in ${words}`
                        : 'expiry unknown'
                  }`}
                  onClick={() => onSelect({ kind: row.kind, id: row.id })}
                >
                  <span className={classes.nameCell}>
                    {row.kind === 'ca' ? (
                      <>
                        <span className={classes.caIcon}>
                          <IconShieldCheck size={16} stroke={1.8} aria-hidden="true" />
                        </span>
                        <span className={`${classes.name} ${classes.caName}`}>{row.name}</span>
                      </>
                    ) : (
                      <>
                        <span className={classes.branch} aria-hidden="true">
                          <span
                            className={classes.branchV}
                            style={{ bottom: row.last ? '50%' : 0 }}
                          />
                          <span className={classes.branchH} />
                        </span>
                        <span className={classes.name}>{row.name}</span>
                      </>
                    )}
                  </span>
                  <span className={classes.track}>
                    {row.kind === 'ca' ? (
                      <AuthorityBar row={row} position={axis.position} />
                    ) : (
                      <CertificateBar row={row} position={axis.position} />
                    )}
                  </span>
                  <span
                    className={classes.left}
                    style={{ color: tone === 'muted' ? 'var(--gl-text-muted)' : toneColor[tone] }}
                  >
                    {words}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

type Position = (date: string | Date) => number;

function AuthorityBar({
  row,
  position,
}: {
  row: Extract<TimelineRow, { kind: 'ca' }>;
  position: Position;
}) {
  const s = row.start ? position(row.start) : -1;
  const e = position(row.end);
  if (e < 0 || s > 1) return null;
  const fade = !row.start;
  const openLeft = s < 0;
  const openRight = e > 1;
  const L = clamp01(s);
  const R = clamp01(e);
  return (
    <span
      className={`${classes.bar} ${classes.caBar}`}
      style={{
        left: percent(L),
        width: percent(Math.max(0, R - L)),
        borderLeftWidth: openLeft ? 0 : undefined,
        borderRightWidth: openRight ? 0 : undefined,
        borderRadius: `${openLeft ? 0 : 4}px ${openRight ? 0 : 4}px ${openRight ? 0 : 4}px ${openLeft ? 0 : 4}px`,
        maskImage: fade ? 'linear-gradient(to right, transparent 0, #000 56px)' : undefined,
      }}
    />
  );
}

function CertificateBar({
  row,
  position,
}: {
  row: Extract<TimelineRow, { kind: 'cert' }>;
  position: Position;
}) {
  if (!row.end || row.days === null) return null;
  const e = position(row.end);
  // Without an issue date, assume the default one-year validity.
  const s = position(row.start ?? new Date(Date.parse(row.end) - 365 * 86_400_000));
  if (e < 0 || s > 1) return null;
  const L = clamp01(s);
  const R = clamp01(e);
  const outFrom = row.authorityEnd ? clamp01(position(row.authorityEnd)) : null;
  return (
    <>
      <span
        className={`${classes.bar} ${classes.certBar}`}
        style={{
          left: percent(L),
          width: percent(Math.max(0, R - L)),
          background: toneColor[expiryTone(row.days)],
        }}
      />
      {outFrom !== null && R > outFrom && (
        <span
          className={`${classes.outHatch} ${classes.hatch}`}
          style={{ left: percent(outFrom), width: percent(R - outFrom) }}
        />
      )}
    </>
  );
}

export function TimelineLegend() {
  return (
    <ul className={classes.legend} aria-label="Legend">
      <li>
        <span className={classes.swatch} style={{ background: 'var(--gl-text-muted)' }} />
        Certificate
      </li>
      <li>
        <span
          className={classes.swatch}
          style={{ height: 14, border: '2px solid var(--gl-text-muted)' }}
        />
        Authority
      </li>
      <li>
        <span className={`${classes.swatch} ${classes.hatch}`} />
        Past its authority's end
      </li>
      <li>
        <span
          className={classes.swatch}
          style={{
            height: 14,
            borderRadius: 0,
            borderLeft: '1px dashed var(--gl-text-soft)',
            background: 'var(--gl-fill-soft)',
          }}
        />
        Today and the 30-day alert window
      </li>
      <li>
        <span className={classes.swatch} style={{ background: 'var(--gl-warning)' }} />
        Within 30 days
      </li>
      <li>
        <span className={classes.swatch} style={{ background: 'var(--gl-danger)' }} />
        Within 7 days or expired
      </li>
    </ul>
  );
}
