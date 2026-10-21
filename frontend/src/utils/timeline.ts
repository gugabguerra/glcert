// Timeline geometry and expiry wording from the redesign handoff. Dates are compared as UTC
// calendar days so a row never shifts with the viewer's time zone.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

export type Span = '18m' | '6y';

/** Midnight UTC of the calendar day the timestamp falls on. */
function utcDay(value: string | Date): number {
  const d = typeof value === 'string' ? new Date(value) : value;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole days from `today` to `date`; negative once it has passed. */
export function daysUntil(date: string, today: Date): number {
  return Math.round((utcDay(date) - utcDay(today)) / DAY_MS);
}

/** "9 days", "5 weeks", "11 months", "2 years", or "expired". */
export function expiryWords(days: number): string {
  if (days < 0) return 'expired';
  if (days < 14) return days === 1 ? '1 day' : `${days} days`;
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? '1 week' : `${weeks} weeks`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30.44);
    return months === 1 ? '1 month' : `${months} months`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year' : `${years} years`;
}

export type Tone = 'danger' | 'warning' | 'muted';

/** Expiry is coloured only when close: 30 days or fewer warns, 7 or fewer (or expired) is danger. */
export function expiryTone(days: number): Tone {
  if (days <= 7) return 'danger';
  if (days <= 30) return 'warning';
  return 'muted';
}

export const toneColor: Record<Tone, string> = {
  danger: 'var(--gl-danger)',
  warning: 'var(--gl-warning)',
  muted: 'var(--gl-text-muted)',
};

export interface AxisCell {
  label: string;
  /** Year shown above the first cell and at each January (18-month span only). */
  year: string;
}

export interface Axis {
  cells: AxisCell[];
  /** Fraction (0 to 1, or outside when off the chart) of a date across the axis. */
  position: (date: string | Date) => number;
}

/**
 * Month columns of equal width. 18 months start three months before today's month; 6 years start
 * in January of the current year. A date sits at its month index plus its day as a fraction of
 * that month.
 */
export function buildAxis(span: Span, today: Date): Axis {
  const year0 = today.getUTCFullYear();
  const month0 = span === '18m' ? today.getUTCMonth() - 3 : 0;
  const months = span === '18m' ? 18 : 72;
  const start = year0 * 12 + month0;

  const position = (value: string | Date) => {
    const d = typeof value === 'string' ? new Date(value) : value;
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return (y * 12 + m - start + (d.getUTCDate() - 1) / daysInMonth) / months;
  };

  const cells: AxisCell[] = [];
  if (span === '18m') {
    for (let i = 0; i < months; i++) {
      const index = start + i;
      const month = ((index % 12) + 12) % 12;
      cells.push({
        label: MONTHS[month],
        year: i === 0 || month === 0 ? String(Math.floor(index / 12)) : '',
      });
    }
  } else {
    for (let i = 0; i < months / 12; i++) cells.push({ label: String(year0 + i), year: '' });
  }
  return { cells, position };
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function percent(x: number): string {
  return `${Math.round(x * 10000) / 100}%`;
}

/** "1 May 2027". */
export function formatDate(value: string): string {
  const d = new Date(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
