import { RecurrenceInterval } from '@prisma/client';

/** Rounds a floating point money value to 2 decimal places, avoiding binary float drift. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Advances `date` by one occurrence of `interval` — used to compute the next recurrence run. */
export function advanceByInterval(date: Date, interval: RecurrenceInterval): Date {
  const d = new Date(date);
  switch (interval) {
    case 'WEEKLY':
      d.setDate(d.getDate() + 7);
      break;
    case 'MONTHLY':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'QUARTERLY':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'ANNUALLY':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}
