import { describe, expect, it } from "bun:test";
import { mapAeroswarmFlightPlanEvent } from "./aeroswarm.mapper";

const fplEvent = {
  messageId: "msg-1",
  sourceId: "aftn-feed",
  feedId: "warr-udp",
  airportId: "WARR",
  receivedAt: 1760688000000,
  message: {
    type: "FPL",
    header: { raw: "FF WADDZTZX" },
    text: "(FPL-GA123-IS-A320/M-SDFGIRWY/S-WADD1500-WARR-N0470F350 DCT)",
    callsign: "GA123",
    flightRules: "I",
    flightType: "S",
    aircraftType: "A320",
    wake: "M",
    equipment: "SDFGIRWY/S",
    adep: "WADD",
    ades: "WARR",
    eobt: "1500",
    eet: "0100",
    cruiseSpeed: "N0470",
    cruiseLevel: "F350",
    route: "DCT",
    registration: "PKGAA",
    icao24: "8A1234",
    dof: "251017",
    eobtAt: 1760688000000,
  },
};

describe("mapAeroswarmFlightPlanEvent", () => {
  it("maps FPL fields to normalized message", () => {
    const result = mapAeroswarmFlightPlanEvent(fplEvent);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.messageType).toBe("FPL");
    expect(result.callSign).toBe("GA123");
    expect(result.registration).toBe("PKGAA");
    expect(result.aircraftType).toBe("A320");
    expect(result.departure).toBe("WADD");
    expect(result.destination).toBe("WARR");
    expect(result.departureTime).toBe("1500");
    expect(result.destinationTime).toBeNull();
    expect(result.duration).toBe("0100");
    expect(result.speed).toBe("N0470");
    expect(result.altitude).toBe("F350");
    expect(result.route).toBe("DCT");
    expect(result.raw).toBe(fplEvent.message.text);
    expect(result.datetime.toISOString()).toBe("2025-10-17T08:00:00.000Z");
    expect(result.parsed?.messageId).toBe("msg-1");
    expect(result.parsed?.icao24).toBe("8A1234");
  });

  it("falls back to atd for departureTime on DEP messages", () => {
    const dep = {
      receivedAt: 1760688000000,
      message: {
        type: "DEP",
        text: "(DEP-GA123-WARR1200-WADD)",
        callsign: "GA123",
        atd: "1200",
      },
    };
    const result = mapAeroswarmFlightPlanEvent(dep);
    expect(result?.departureTime).toBe("1200");
  });

  it("rejects non-event payloads", () => {
    expect(mapAeroswarmFlightPlanEvent(null)).toBeNull();
    expect(mapAeroswarmFlightPlanEvent("x")).toBeNull();
    expect(mapAeroswarmFlightPlanEvent({ receivedAt: 1 })).toBeNull();
  });

  it("rejects events without message.type", () => {
    expect(
      mapAeroswarmFlightPlanEvent({ receivedAt: 1, message: { text: "raw" } }),
    ).toBeNull();
  });
});
