import type { TimelineEvent } from "@/modules/schema/playback.schema";

/**
 * NOTAM, ASHTAM and Aerodrome data aren't wired up yet. This produces a
 * handful of placeholder events spread across the requested window so the
 * timeline shape matches the final Playback flow. Swap this out once those
 * services exist — nothing else in the engine needs to change, since it
 * only cares about TimelineEvent.
 */
export function buildDummyEvents(
  airportId: string,
  fromMs: number,
  toMs: number,
): TimelineEvent[] {
  const span = toMs - fromMs;
  const events: TimelineEvent[] = [];

  const notamCount = 3;
  for (let i = 0; i < notamCount; i++) {
    const ts = fromMs + Math.round((span * (i + 1)) / (notamCount + 1));
    events.push({
      type: "notam",
      ts,
      timestamp: new Date(ts).toISOString(),
      data: {
        id: `DUMMY-NOTAM-${airportId}-${i + 1}`,
        airportId,
        series: "A",
        text: `RWY 10/28 EDGE LIGHT U/S (DUMMY DATA #${i + 1})`,
      },
    });
  }

  const ashtamCount = 2;
  for (let i = 0; i < ashtamCount; i++) {
    const ts = fromMs + Math.round((span * (i + 1)) / (ashtamCount + 1));
    events.push({
      type: "ashtam",
      ts,
      timestamp: new Date(ts).toISOString(),
      data: {
        id: `DUMMY-ASHTAM-${airportId}-${i + 1}`,
        airportId,
        volcano: "MOUNT SEMERU",
        ashAdvisory: "NIL ASH EXPECTED (DUMMY DATA)",
      },
    });
  }

  events.push({
    type: "aerodrome",
    ts: fromMs,
    timestamp: new Date(fromMs).toISOString(),
    data: {
      airportId,
      status: "OPERATIONAL",
      runwayCondition: "DRY",
      note: "DUMMY aerodrome status snapshot",
    },
  });

  return events;
}
