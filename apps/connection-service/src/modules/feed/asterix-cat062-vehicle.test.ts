import { describe, expect, it } from "bun:test";
import { AsterixFeedSource } from "@aeroswarm/ingest";

// Two real CAT062 records from the WIII A-SMGCS feed, packed into one data block the way the sender does (a dozen per
// datagram). With the old decoder only the first record of a block was read, so vehicles further down never reached the
// map. A second copy of an old @aeroswarm/codec under @aeroswarm/ingest brings that back: this test guards it.
// The same records also carry the aircraft type, wake category and route, and a CAT020 reference transponder must not
// become a track: what the decoder reads has to reach the event that is stored.

/** BTK7158, an A320 on the ground. */
const AIRCRAFT =
  "bfdda7842633002f570affee9722012f5a31fff40efffd600027000f0100005f81108a060302008a600111010000000800004fc842544b37313538413332304d5753535357494949202020024006240008042d00612938c0000400040000";

/** MLAT reference transponder (CAT020, RAB set), shown as an aircraft before the descriptor extension octets were read. */
const REFERENCE_TRANSPONDER =
  "140059ff494584010141a0366b53ffeb06480140d1d0000010fffffd00391a00000000002abe00001000000000000000000000000000000e071c001ed8d00000000000000006000b000400050003000200000000366b820800";

/** AMC2D, a vehicle (I062/300). */
const VEHICLE =
  "bf9d83442633002f570affee95ab012f5c0cfff642ffff1e00010000ff00c1108a0aca04d0f212082002008c1101110100004c414d4330312020202020202000c0000400040000";

const datagram = (...records: string[]): Buffer => {
  const body = Buffer.concat(records.map((r) => Buffer.from(r, "hex")));
  const head = Buffer.from([62, 0, 0]);
  head.writeUInt16BE(3 + body.length, 1);
  return Buffer.concat([head, body]);
};

interface TrackEvent {
  kind: string;
  event: {
    trackId: string;
    lifecycle?: string;
    identity: {
      icao24?: string;
      callsign?: string;
      targetType?: string;
      vehicleFleet?: number;
      aircraftType?: string;
      wake?: string;
    };
    route?: { adep?: string; ades?: string };
    position?: { onGround?: boolean };
    details?: { trackNumber?: number; lengthM?: number };
  };
}

describe("CAT062 vehicles through the ingest feed", () => {
  it("emits the vehicle that follows an aircraft in the same datagram", async () => {
    const source = new AsterixFeedSource({
      transport: "udp",
      port: 0,
      bindHost: "127.0.0.1",
      airportId: "WARR",
      sourceId: "fixture-062",
    });
    const all: TrackEvent[] = [];
    source.start((e) => {
      if ((e as { kind?: string }).kind === "track")
        all.push(e as unknown as TrackEvent);
    });
    source.processDatagram(datagram(AIRCRAFT, VEHICLE));
    await source.stop(); // stopping drops every track: those events are not what is being checked

    const tracks = all.filter((t) => t.event.lifecycle !== "dropped");
    expect(tracks).toHaveLength(2);

    const aircraft = tracks.find((t) => t.event.identity.icao24 === "8a0603");
    expect(aircraft?.event.identity.callsign).toBe("BTK7158");
    expect(aircraft?.event.identity.targetType).not.toBe("vehicle");

    const vehicle = tracks.find((t) => t.event.identity.icao24 === "8a0aca");
    expect(vehicle?.event.identity.targetType).toBe("vehicle");
    expect(vehicle?.event.identity.callsign).toBe("AMC2D");
    expect(vehicle?.event.identity.vehicleFleet).toBe(0);
  });

  it("carries the aircraft type, wake category, route, ground state and details into the event", async () => {
    const all: TrackEvent[] = [];
    const source = new AsterixFeedSource({
      transport: "udp",
      port: 0,
      bindHost: "127.0.0.1",
      airportId: "WARR",
      sourceId: "fixture-062-details",
    });
    source.start((e) => {
      if ((e as { kind?: string }).kind === "track")
        all.push(e as unknown as TrackEvent);
    });
    source.processDatagram(datagram(AIRCRAFT));
    await source.stop();

    const event = all.find((t) => t.event.lifecycle !== "dropped")?.event;
    expect(event?.identity.aircraftType).toBe("A320");
    expect(event?.identity.wake).toBe("M");
    expect(event?.route).toEqual({ adep: "WSSS", ades: "WIII" });
    expect(event?.position?.onGround).toBe(true);
    expect(event?.details?.trackNumber).toBe(35424);
    expect(event?.details?.lengthM).toBe(48);
  });

  it("does not turn an MLAT reference transponder into a track", async () => {
    const all: TrackEvent[] = [];
    const source = new AsterixFeedSource({
      transport: "udp",
      port: 0,
      bindHost: "127.0.0.1",
      airportId: "WARR",
      sourceId: "fixture-020-rab",
    });
    source.start((e) => {
      if ((e as { kind?: string }).kind === "track")
        all.push(e as unknown as TrackEvent);
    });
    source.processDatagram(Buffer.from(REFERENCE_TRANSPONDER, "hex"));
    await source.stop();

    expect(all.filter((t) => t.event.lifecycle !== "dropped")).toHaveLength(0);
  });
});
