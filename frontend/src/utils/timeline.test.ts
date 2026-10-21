import { describe, expect, it } from 'vitest';
import { buildAxis, daysUntil, expiryTone, expiryWords, formatDate } from './timeline';

const today = new Date('2026-10-18T15:30:00Z');

describe('expiryWords', () => {
  it('uses days under 14, weeks under 60 days, months under a year, then years', () => {
    expect(expiryWords(1), 'one day').toBe('1 day');
    expect(expiryWords(13), 'last day count').toBe('13 days');
    expect(expiryWords(14), 'first week count').toBe('2 weeks');
    expect(expiryWords(59), 'last week count').toBe('8 weeks');
    expect(expiryWords(60), 'first month count').toBe('1 month');
    expect(expiryWords(330), 'months').toBe('10 months');
    expect(expiryWords(365), 'one year').toBe('1 year');
    expect(expiryWords(1825), 'years').toBe('5 years');
  });

  it('says expired once the date has passed', () => {
    expect(expiryWords(-3), 'past date').toBe('expired');
    expect(expiryWords(0), 'expires today').toBe('0 days');
  });
});

describe('expiryTone', () => {
  it('colours expiry only when close', () => {
    expect(expiryTone(31), 'far off').toBe('muted');
    expect(expiryTone(30), 'alert window').toBe('warning');
    expect(expiryTone(7), 'a week').toBe('danger');
    expect(expiryTone(-1), 'expired').toBe('danger');
  });
});

describe('daysUntil', () => {
  it('counts whole calendar days regardless of the time of day', () => {
    expect(daysUntil('2026-10-19T01:00:00Z', today), 'tomorrow').toBe(1);
    expect(daysUntil('2026-10-18T00:00:00Z', today), 'today').toBe(0);
    expect(daysUntil('2026-10-11T23:59:00Z', today), 'a week ago').toBe(-7);
  });
});

describe('buildAxis', () => {
  it('starts 18 months three months before today and labels years at the start and January', () => {
    const axis = buildAxis('18m', today);
    expect(axis.cells.length, 'month count').toBe(18);
    expect(axis.cells[0], 'first cell').toEqual({ label: 'Jul', year: '2026' });
    expect(axis.cells[6], 'January').toEqual({ label: 'Jan', year: '2027' });
    expect(axis.position('2026-07-01T00:00:00Z'), 'axis start').toBe(0);
    expect(axis.position('2028-01-01T00:00:00Z'), 'axis end').toBe(1);
  });

  it('places a date by month index plus day fraction', () => {
    const axis = buildAxis('18m', today);
    // 16 Oct 2026 is month 3, day 15 of 31.
    expect(axis.position('2026-10-16T00:00:00Z'), 'mid-October').toBeCloseTo((3 + 15 / 31) / 18);
  });

  it('spans six calendar years from January of this year', () => {
    const axis = buildAxis('6y', today);
    expect(
      axis.cells.map((c) => c.label),
      'year labels',
    ).toEqual(['2026', '2027', '2028', '2029', '2030', '2031']);
    expect(axis.position('2029-01-01T00:00:00Z'), 'halfway').toBe(0.5);
  });
});

describe('formatDate', () => {
  it('writes day, short month and year', () => {
    expect(formatDate('2027-05-01T00:00:00Z'), 'authority end').toBe('1 May 2027');
  });
});
