/**
 * Date-only ("YYYY-MM-DD") and Asia/Jakarta timezone helpers for the
 * operational statistics endpoint.
 *
 * Jakarta (WIB) is a fixed UTC+7 offset with no daylight-saving rules, so a
 * hardcoded "+07:00" offset is safe here and we don't need an IANA tz
 * database / date library dependency for it.
 */

export const PERIOD_VALUES = ["daily", "weekly", "monthly"] as const;
export type PeriodType = (typeof PERIOD_VALUES)[number];

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const JAKARTA_OFFSET = "+07:00";

/** Rejects both malformed strings and calendar-invalid ones (e.g.
 *  "2026-02-30", which `new Date()` would otherwise silently roll over into
 *  March). */
export function isValidCalendarDate(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/** Inclusive start-of-day boundary for a YYYY-MM-DD date in Asia/Jakarta,
 *  returned as the equivalent UTC instant for use in DB range filters. */
export function startOfDayJakarta(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00${JAKARTA_OFFSET}`);
}

/** endDate is inclusive per the requirement, but is applied to queries as
 *  the exclusive start of the following day (per the PDF's Technical Notes)
 *  so events up to 23:59:59.999 on endDate aren't dropped by a `<=`
 *  comparison against a truncated timestamp. */
export function exclusiveEndBoundaryJakarta(dateOnly: string): Date {
  const start = startOfDayJakarta(dateOnly);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** Postgres date_trunc() unit matching the requested statistics period. */
export function truncUnitFor(period: PeriodType): "day" | "week" | "month" {
  switch (period) {
    case "daily":
      return "day";
    case "weekly":
      return "week";
    case "monthly":
      return "month";
  }
}

function toUtcDateOnly(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00Z`);
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday of the ISO-8601 week containing `date` — matches Postgres'
 *  date_trunc('week', ...) semantics (weeks start Monday), so the JS-side
 *  bucket keys line up with the DB-side grouping key. */
function isoWeekStart(date: Date): Date {
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() + mondayOffset);
  return monday;
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Every trend bucket's start date (YYYY-MM-DD) covering [startDate,
 *  endDate] inclusive, so the trend series returned to the frontend can be
 *  zero-filled for buckets with no activity instead of silently omitting
 *  them (a chart with gaps is worse than a chart with explicit zeros). */
export function listBucketKeys(
  period: PeriodType,
  startDate: string,
  endDate: string,
): string[] {
  const start = toUtcDateOnly(startDate);
  const end = toUtcDateOnly(endDate);
  const keys: string[] = [];

  if (period === "daily") {
    const cursor = new Date(start);
    while (cursor.getTime() <= end.getTime()) {
      keys.push(formatDateOnly(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return keys;
  }

  if (period === "weekly") {
    let cursor = isoWeekStart(start);
    const last = isoWeekStart(end);
    while (cursor.getTime() <= last.getTime()) {
      keys.push(formatDateOnly(cursor));
      cursor = new Date(cursor.getTime());
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return keys;
  }

  let cursor = monthStart(start);
  const last = monthStart(end);
  while (cursor.getTime() <= last.getTime()) {
    keys.push(formatDateOnly(cursor));
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    );
  }
  return keys;
}
