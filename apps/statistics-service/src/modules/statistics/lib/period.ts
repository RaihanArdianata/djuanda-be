export const PERIOD_VALUES = ["daily", "weekly", "monthly"] as const;
export type PeriodType = (typeof PERIOD_VALUES)[number];

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const JAKARTA_OFFSET = "+07:00";

export function isValidCalendarDate(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export function startOfDayJakarta(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00${JAKARTA_OFFSET}`);
}

export function exclusiveEndBoundaryJakarta(dateOnly: string): Date {
  const start = startOfDayJakarta(dateOnly);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function toUtcDateOnly(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00Z`);
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysUtc(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function endOfIsoWeek(date: Date): Date {
  const day = date.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  return addDaysUtc(date, daysUntilSunday);
}

function endOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function enumerateDaysInclusive(
  startDate: string,
  endDate: string,
): string[] {
  const start = toUtcDateOnly(startDate);
  const end = toUtcDateOnly(endDate);
  const days: string[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    days.push(formatDateOnly(cursor));
    cursor = addDaysUtc(cursor, 1);
  }
  return days;
}

export interface PeriodBucket {
  period: string;
  periodStart: string;
  periodEnd: string;
}

export function computePeriodBuckets(
  period: PeriodType,
  startDate: string,
  endDate: string,
): PeriodBucket[] {
  if (period === "daily") {
    return enumerateDaysInclusive(startDate, endDate).map((day) => ({
      period: day,
      periodStart: day,
      periodEnd: day,
    }));
  }

  const start = toUtcDateOnly(startDate);
  const end = toUtcDateOnly(endDate);
  const endOfChunk = period === "weekly" ? endOfIsoWeek : endOfMonthUtc;

  const buckets: PeriodBucket[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    const chunkEnd = minDate(endOfChunk(cursor), end);
    const periodStart = formatDateOnly(cursor);
    const periodEnd = formatDateOnly(chunkEnd);
    buckets.push({ period: periodStart, periodStart, periodEnd });
    cursor = addDaysUtc(chunkEnd, 1);
  }
  return buckets;
}
