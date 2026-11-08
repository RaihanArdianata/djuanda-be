import type { TimelineEvent } from "../schema/playback.schema";

const CONTEXT_TYPES: ReadonlySet<TimelineEvent["type"]> = new Set([
  "notam",
  "ashtam",
  "aerodrome",
]);

function inForceAt(event: TimelineEvent, cursor: number): boolean {
  const { effectiveTo } = (event.data ?? {}) as {
    effectiveTo?: string | null;
  };
  return !effectiveTo || Date.parse(effectiveTo) >= cursor;
}

// These events are sent once, so a seek past them would leave the operator
// with empty panels that read as "nothing in force". Events at or after the
// cursor are left to the tick loop.
export function contextInForceAtSeek(
  timeline: TimelineEvent[],
  cursor: number,
): TimelineEvent[] {
  return timeline.filter(
    (event) =>
      CONTEXT_TYPES.has(event.type) &&
      event.ts < cursor &&
      inForceAt(event, cursor),
  );
}

// `>=`: events placed exactly at the window start (NOTAM, ASHTAM, aerodrome)
// must be sent again after a seek back to the start.
export function cursorIndexAfterSeek(
  timeline: TimelineEvent[],
  cursor: number,
): number {
  const index = timeline.findIndex((event) => event.ts >= cursor);
  return index === -1 ? timeline.length : index;
}
