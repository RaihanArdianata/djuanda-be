import { describe, expect, it } from "bun:test";
import type { AftnMessage } from "@repo/database";
import { PgDialect } from "drizzle-orm/pg-core";
import { aftnRowToEvent, aftnWindowFilter } from "./playback-data.service";

const at = new Date("2026-11-08T01:00:00.000Z");
const row = {
  id: "11111111-1111-1111-1111-111111111111",
  providerId: "provider-1",
  contentHash: "hash-1",
  datetime: at,
  messageType: "FPL",
  callSign: "GIA322",
  registration: "PKGFA",
  aircraftType: "B738",
  departure: "WARR",
  departureTime: "0100",
  destination: "WIII",
  destinationTime: null,
  duration: "0130",
  speed: "N0450",
  altitude: "F350",
  route: "DCT",
  raw: "(FPL-GIA322-IS)",
  parsed: { icao24: "8A0001" },
  providerRaw: { secret: "provider-payload" },
  source: "aeroswarm",
  createdAt: at,
  updatedAt: at,
} as AftnMessage;

describe("aftnRowToEvent", () => {
  it("memakai datetime sebagai waktu event", () => {
    const event = aftnRowToEvent(row);
    expect(event.type).toBe("aftn");
    expect(event.ts).toBe(at.getTime());
    expect(event.timestamp).toBe("2026-11-08T01:00:00.000Z");
  });

  it("membawa kolom pesan AFTN", () => {
    expect(aftnRowToEvent(row).data).toMatchObject({
      id: row.id,
      messageType: "FPL",
      callSign: "GIA322",
      departure: "WARR",
      destination: "WIII",
      raw: "(FPL-GIA322-IS)",
      parsed: { icao24: "8A0001" },
      source: "aeroswarm",
    });
  });

  it("tidak membawa kolom internal", () => {
    const { data } = aftnRowToEvent(row);
    expect(data).not.toHaveProperty("providerRaw");
    expect(data).not.toHaveProperty("contentHash");
  });

  it("tidak ikut terhitung sebagai track unik", () => {
    const { data } = aftnRowToEvent(row);
    expect(data).not.toHaveProperty("trackId");
    expect(data).not.toHaveProperty("icao24");
  });

  it("menerima kolom opsional yang null", () => {
    const event = aftnRowToEvent({
      ...row,
      callSign: null,
      departure: null,
    });
    expect(event.data).toMatchObject({ callSign: null, departure: null });
  });
});

describe("aftnWindowFilter", () => {
  it("cocok di keberangkatan atau kedatangan, inklusif di kedua batas", () => {
    const from = new Date("2026-11-08T00:00:00.000Z");
    const to = new Date("2026-11-08T02:00:00.000Z");
    const filter = aftnWindowFilter("WARR", from, to);
    if (!filter) throw new Error("filter kosong");
    const { sql, params } = new PgDialect().sqlToQuery(filter);

    expect(sql).toContain(
      '("aftn_messages"."departure" = $1 or "aftn_messages"."destination" = $2)',
    );
    expect(sql).toContain('"aftn_messages"."datetime" >= $3');
    expect(sql).toContain('"aftn_messages"."datetime" <= $4');
    expect(params.slice(0, 2)).toEqual(["WARR", "WARR"]);
  });
});
