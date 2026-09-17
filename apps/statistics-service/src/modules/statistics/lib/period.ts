export const PERIOD_VALUES = ["hourly", "daily", "weekly", "monthly"] as const;
export type PeriodType = (typeof PERIOD_VALUES)[number];

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const JAKARTA_OFFSET = "+07:00";
const HOURS_PER_DAY = 24;

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
function pad2(value: number): string {
  return String(value).padStart(2, "0");
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

export function hourKeysForDayRange(
  startDay: string,
  endDayInclusive: string,
): string[] {
  const days = enumerateDaysInclusive(startDay, endDayInclusive);
  const keys: string[] = [];
  for (const day of days) {
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
      keys.push(`${day}T${pad2(hour)}:00`);
    }
  }
  return keys;
}
function parseTimeOfDayMinutes(time: string): number {
  const [hourStr, minuteStr] = time.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr ?? "0");
  return hour * 60 + minute;
}
function hourWithinTimeOfDay(
  hour: number,
  startTime: string | undefined,
  endTime: string | undefined,
): boolean {
  if (!startTime || !endTime) return true;
  const hourStartMinute = hour * 60;
  const startMinute = parseTimeOfDayMinutes(startTime);
  const endMinute = parseTimeOfDayMinutes(endTime);
  return hourStartMinute >= startMinute && hourStartMinute < endMinute;
}

export interface PeriodBucket {
  period: string;
  periodStart: string;
  periodEnd: string;
  hourKeys: string[];
}
export function computePeriodBuckets(
  period: PeriodType,
  startDate: string,
  endDate: string,
  startTime?: string,
  endTime?: string,
): PeriodBucket[] {
  if (period === "hourly") {
    const days = enumerateDaysInclusive(startDate, endDate);
    const buckets: PeriodBucket[] = [];
    for (const day of days) {
      for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        if (!hourWithinTimeOfDay(hour, startTime, endTime)) continue;
        const hh = pad2(hour);
        const label = `${day}T${hh}:00`;
        buckets.push({
          period: label,
          periodStart: `${day}T${hh}:00:00`,
          periodEnd: `${day}T${hh}:59:59`,
          hourKeys: [label],
        });
      }
    }
    return buckets;
  }

  if (period === "daily") {
    return enumerateDaysInclusive(startDate, endDate).map((day) => ({
      period: day,
      periodStart: day,
      periodEnd: day,
      hourKeys: hourKeysForDayRange(day, day),
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
    buckets.push({
      period: periodStart,
      periodStart,
      periodEnd,
      hourKeys: hourKeysForDayRange(periodStart, periodEnd),
    });
    cursor = addDaysUtc(chunkEnd, 1);
  }
  return buckets;
}
