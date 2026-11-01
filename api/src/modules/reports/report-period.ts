import { BadRequestException } from '@nestjs/common';
import { ReportPeriod } from './dto/report-query.dto';

/**
 * A resolved reporting window. `from`/`to` are inclusive calendar dates (UTC midnight), which is how
 * the @db.Date columns (BatchItem.date, Invoice.issueDate) come back from Prisma. Null = unbounded.
 */
export interface ResolvedPeriod {
  period: ReportPeriod;
  from: Date | null;
  to: Date | null;
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const ym = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;

/** Today's calendar date in the workspace timezone, as a UTC-midnight Date. */
export function todayIn(timezone: string | null | undefined): Date {
  let parts: string;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    parts = ymd(new Date());
  }
  return parseYmd(parts);
}

export function parseYmd(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
  return date;
}

/** Last calendar day of a YYYY-MM month (UTC midnight). */
export function monthEnd(month: string): Date {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) throw new BadRequestException(`Invalid month: ${month}`);
  return new Date(Date.UTC(y, m, 0));
}

export function resolvePeriod(
  period: ReportPeriod | undefined,
  from: string | undefined,
  to: string | undefined,
  timezone: string | null | undefined,
): ResolvedPeriod {
  const p: ReportPeriod = period ?? (from || to ? 'custom' : 'this_month');
  const today = todayIn(timezone);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  switch (p) {
    case 'this_month': {
      const start = new Date(Date.UTC(y, m, 1));
      return { period: p, from: start, to: new Date(Date.UTC(y, m + 1, 0)), label: `This month (${ym(start)})` };
    }
    case 'last_month': {
      const start = new Date(Date.UTC(y, m - 1, 1));
      return { period: p, from: start, to: new Date(Date.UTC(y, m, 0)), label: `Last month (${ym(start)})` };
    }
    case 'ytd': {
      const start = new Date(Date.UTC(y, 0, 1));
      return { period: p, from: start, to: today, label: `Year to date (${ymd(start)} – ${ymd(today)})` };
    }
    case 'all':
      return { period: p, from: null, to: null, label: 'All time' };
    case 'custom': {
      const f = from ? parseYmd(from) : null;
      const t = to ? parseYmd(to) : null;
      if (f && t && f > t) throw new BadRequestException('"from" must be on or before "to"');
      return { period: p, from: f, to: t, label: `${f ? ymd(f) : 'inception'} – ${t ? ymd(t) : 'now'}` };
    }
  }
}

/** Prisma date filter for an inclusive window on a @db.Date column. */
export function dateFilter(r: { from: Date | null; to: Date | null }): { gte?: Date; lte?: Date } | undefined {
  if (!r.from && !r.to) return undefined;
  const f: { gte?: Date; lte?: Date } = {};
  if (r.from) f.gte = r.from;
  if (r.to) f.lte = r.to;
  return f;
}
