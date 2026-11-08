import type { TimelineEvent } from "../schema/playback.schema";

// `>=`: events placed exactly at the window start (NOTAM, ASHTAM, aerodrome)
// must be sent again after a seek back to the start.
export function cursorIndexAfterSeek(
  timeline: TimelineEvent[],
  cursor: number,
): number {
  const index = timeline.findIndex((event) => event.ts >= cursor);
  return index === -1 ? timeline.length : index;
}
