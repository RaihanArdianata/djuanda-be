import { env } from "@/config/env";

export interface SyncWindow {
  startDate: Date;
  endDate: Date;
}

export const intervalMsToCronExpression = (intervalMs: number): string => {
  if (intervalMs <= 0 || intervalMs % 60_000 !== 0) {
    throw new Error(
      `Sync interval must be a whole number of minutes, got ${intervalMs}ms`,
    );
  }

  const minutes = intervalMs / 60_000;

  if (minutes >= 60) {
    if (minutes % 60 !== 0) {
      throw new Error(
        `Sync interval over an hour must be a multiple of 60 minutes, got ${minutes}m`,
      );
    }
    return `0 */${minutes / 60} * * *`;
  }

  if (60 % minutes !== 0) {
    throw new Error(
      `Sync interval must evenly divide 60 minutes for a cron schedule, got ${minutes}m`,
    );
  }

  return `*/${minutes} * * * *`;
};

/**
 * Window incremental sync: lanjut dari watermark `latestStoredAt` dikurangi
 * overlap, tapi tidak pernah lebih dekat dari satu interval penuh ke `now`.
 * Dipakai sync NOTAM & ASHTAM (AFTN streaming via AeroSwarm, tidak pakai ini).
 */
export const resolveIncrementalWindow = (
  latestStoredAt: Date | null,
  now: Date,
  intervalMs: number,
  overlapMs: number = env.ADVISORY_SYNC_OVERLAP_MS,
): SyncWindow => {
  const fallbackStart = new Date(now.getTime() - intervalMs);
  const base = latestStoredAt ?? fallbackStart;
  const startCandidate = new Date(base.getTime() - overlapMs);

  const startDate =
    startCandidate.getTime() < fallbackStart.getTime()
      ? startCandidate
      : fallbackStart;

  return { startDate, endDate: now };
};
