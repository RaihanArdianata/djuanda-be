import type { FlightPlanEvent } from "@aeroswarm/core";
import type { FlightPlanStore } from "@aeroswarm/live-server";
import { logger } from "@repo/logger";

/** Matches the plan store's own TTL (48 h): older plans would be swept at once. */
const DEFAULT_WINDOW_MS = 48 * 3_600_000;

export interface RestoreResult {
  rows: number;
  /** Rows that rebuilt into a plan update. */
  applied: number;
  /** Rows whose stored payload was not a flight plan event. */
  skipped: number;
}

export interface RestoreOptions {
  windowMs?: number;
  now?: () => number;
}

const isFlightPlanEvent = (v: unknown): v is FlightPlanEvent => {
  if (typeof v !== "object" || v === null) return false;
  const e = v as { receivedAt?: unknown; message?: unknown };
  const m = e.message as { type?: unknown } | null | undefined;
  return (
    typeof e.receivedAt === "number" &&
    typeof m === "object" &&
    m !== null &&
    typeof m.type === "string"
  );
};

/**
 * Rebuilds the in-memory flight plans after a restart by replaying the stored
 * AFTN events (oldest first, so FPL comes before its CHG/DEP/ARR). Without
 * this, every label turns white until the next AFTN message for that flight.
 *
 * `fetchRows` returns each stored row's original event payload.
 */
export async function restoreFlightPlans(
  plans: FlightPlanStore,
  fetchRows: (since: Date) => Promise<unknown[]>,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
  const now = (opts.now ?? Date.now)();
  const since = new Date(now - (opts.windowMs ?? DEFAULT_WINDOW_MS));
  const rows = await fetchRows(since);

  const events = rows.filter(isFlightPlanEvent);
  events.sort((a, b) => a.receivedAt - b.receivedAt);

  let applied = 0;
  for (const event of events) {
    try {
      if (plans.apply(event)) applied++;
    } catch (err) {
      logger.warn(
        { err, messageId: event.messageId },
        "flight plan restore: event skipped",
      );
    }
  }
  return { rows: rows.length, applied, skipped: rows.length - events.length };
}
