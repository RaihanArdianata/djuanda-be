import { describe, expect, it } from "bun:test";
import type { FlightPlanEvent } from "@aeroswarm/core";
import { createFlightPlanStore } from "@aeroswarm/live-server";
import { restoreFlightPlans } from "./flightplan-restore";

const NOW = 1_800_000_000_000;
const ev = (
  type: string,
  at: number,
  over: Record<string, unknown> = {},
): FlightPlanEvent =>
  ({
    messageId: `m-${type}-${at}`,
    sourceId: "aftn",
    airportId: "WARR",
    receivedAt: at,
    message: {
      type,
      header: { addressees: [] },
      text: "",
      callsign: "GIA123",
      adep: "WARR",
      ades: "WIII",
      status: "filed",
      phase: "UNKNOWN",
      other: {},
      ...over,
    },
  }) as unknown as FlightPlanEvent;

describe("restoreFlightPlans", () => {
  it("rebuilds plans and correlates them with a track afterwards", async () => {
    const plans = createFlightPlanStore();
    const r = await restoreFlightPlans(
      plans,
      async () => [ev("FPL", NOW - 3600_000)],
      { now: () => NOW },
    );
    expect(r).toEqual({ rows: 1, applied: 1, skipped: 0 });
    const track = {
      trackId: "t",
      callsign: "GIA123",
      icao24: null,
      airportId: "WARR",
    } as never;
    expect(
      (plans.attach(track) as { flightPlan?: { phase: string } }).flightPlan
        ?.phase,
    ).toBe("DEPARTURE");
  });

  it("replays oldest first even when rows arrive out of order, so DEP follows FPL", async () => {
    const plans = createFlightPlanStore();
    const rows = [
      ev("DEP", NOW - 1000, { atdAt: NOW - 1000 }),
      ev("FPL", NOW - 7200_000),
    ];
    const r = await restoreFlightPlans(plans, async () => rows, {
      now: () => NOW,
    });
    expect(r.applied).toBe(2);
    expect(plans.size).toBe(1);
    expect(plans.list()[0]?.status).toBe("departed");
  });

  it("asks only for the retention window", async () => {
    let since: Date | undefined;
    await restoreFlightPlans(
      createFlightPlanStore(),
      async (s) => {
        since = s;
        return [];
      },
      { now: () => NOW, windowMs: 1000 },
    );
    expect(since?.getTime()).toBe(NOW - 1000);
  });

  it("skips rows that are not flight plan events", async () => {
    const plans = createFlightPlanStore();
    const r = await restoreFlightPlans(
      plans,
      async () => [
        null,
        "x",
        {},
        { receivedAt: 1 },
        { receivedAt: 1, message: {} },
        ev("FPL", NOW - 10),
      ],
      { now: () => NOW },
    );
    expect(r).toEqual({ rows: 6, applied: 1, skipped: 5 });
  });

  it("does not throw on an event the store ignores", async () => {
    const plans = createFlightPlanStore();
    const bad = ev("FPL", NOW - 10, { callsign: undefined });
    const r = await restoreFlightPlans(plans, async () => [bad], {
      now: () => NOW,
    });
    expect(r.applied).toBe(0);
  });

  it("propagates a failing query so the caller can log it", async () => {
    await expect(
      restoreFlightPlans(createFlightPlanStore(), async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");
  });
});
