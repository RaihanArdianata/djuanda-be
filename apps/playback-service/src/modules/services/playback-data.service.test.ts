import { describe, expect, it } from "bun:test";
import type {
  AerodromeFeature,
  AftnMessage,
  AshtamMessage,
  NotamMessage,
} from "@repo/database";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  aerodromeSnapshotEvents,
  aerodromeSnapshotFilter,
  aftnRowToEvent,
  aftnWindowFilter,
  ashtamRowToEvent,
  ashtamWindowFilter,
  latestPerKey,
  notamRowToEvent,
  notamWindowFilter,
} from "./playback-data.service";

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

const windowStart = new Date("2026-11-08T00:00:00.000Z");
const windowEnd = new Date("2026-11-08T02:00:00.000Z");
const fromMs = windowStart.getTime();

const notamRow = {
  id: "22222222-2222-2222-2222-222222222222",
  source: "navsim",
  providerId: "provider-2",
  series: "A",
  number: "1234",
  year: 2026,
  type: "NOTAMN",
  icaoLocation: "WARR",
  effectiveFrom: at,
  effectiveTo: new Date("2026-11-09T00:00:00.000Z"),
  body: "RWY 10/28 EDGE LIGHT U/S",
  status: "ACTIVE",
  contentHash: "hash-2",
  raw: "(A1234/26 NOTAMN)",
} as NotamMessage;

const ashtamRow = {
  id: "33333333-3333-3333-3333-333333333333",
  source: "navsim",
  providerId: "ASHTAM 7836",
  type: "ASHTAM",
  affectedFir: "WAAF",
  effectiveFrom: at,
  effectiveTo: new Date("2026-11-09T00:00:00.000Z"),
  volcanoName: "SEMERU",
  volcanicAsh: "ASH TO FL150",
  status: "ACTIVE",
  contentHash: "hash-3",
  raw: "ASHTAM 7836",
  providerRaw: { secret: "provider-payload" },
} as unknown as AshtamMessage;

describe("notamRowToEvent", () => {
  it("memakai effectiveFrom bila mulai di dalam rentang", () => {
    const event = notamRowToEvent(notamRow, fromMs);
    expect(event.type).toBe("notam");
    expect(event.ts).toBe(at.getTime());
  });

  it("muncul di awal rentang bila sudah berlaku sebelumnya", () => {
    const event = notamRowToEvent(
      { ...notamRow, effectiveFrom: new Date("2026-11-01T00:00:00.000Z") },
      fromMs,
    );
    expect(event.ts).toBe(fromMs);
    expect(event.timestamp).toBe("2026-11-08T00:00:00.000Z");
    expect(event.data).toMatchObject({
      effectiveFrom: "2026-11-01T00:00:00.000Z",
    });
  });

  it("mempertahankan nama field lama dan membawa status", () => {
    expect(notamRowToEvent(notamRow, fromMs).data).toMatchObject({
      id: notamRow.id,
      airportId: "WARR",
      series: "A",
      text: "RWY 10/28 EDGE LIGHT U/S",
      status: "ACTIVE",
      effectiveTo: "2026-11-09T00:00:00.000Z",
    });
  });

  it("tidak membawa kolom internal atau identitas track", () => {
    const { data } = notamRowToEvent(notamRow, fromMs);
    expect(data).not.toHaveProperty("contentHash");
    expect(data).not.toHaveProperty("trackId");
  });
});

describe("notamWindowFilter", () => {
  it("memilih NOTAM bandara yang masa berlakunya beririsan", () => {
    const filter = notamWindowFilter("WARR", windowStart, windowEnd);
    if (!filter) throw new Error("filter kosong");
    const { sql, params } = new PgDialect().sqlToQuery(filter);

    expect(sql).toContain('"notam_messages"."icao_location" = $1');
    expect(sql).toContain('"notam_messages"."effective_from" <= $2');
    expect(sql).toContain('"notam_messages"."effective_to" >= $3');
    expect(sql).not.toContain('"notam_messages"."status"');
    expect(params[0]).toBe("WARR");
  });
});

describe("ashtamRowToEvent", () => {
  it("muncul di awal rentang bila sudah berlaku sebelumnya", () => {
    const event = ashtamRowToEvent(
      { ...ashtamRow, effectiveFrom: new Date("2026-11-01T00:00:00.000Z") },
      "WARR",
      fromMs,
    );
    expect(event.type).toBe("ashtam");
    expect(event.ts).toBe(fromMs);
  });

  it("mempertahankan nama field lama dan membawa FIR", () => {
    expect(ashtamRowToEvent(ashtamRow, "WARR", fromMs).data).toMatchObject({
      id: ashtamRow.id,
      airportId: "WARR",
      volcano: "SEMERU",
      ashAdvisory: "ASH TO FL150",
      affectedFir: "WAAF",
      status: "ACTIVE",
    });
  });

  it("tidak membawa kolom internal", () => {
    const { data } = ashtamRowToEvent(ashtamRow, "WARR", fromMs);
    expect(data).not.toHaveProperty("providerRaw");
    expect(data).not.toHaveProperty("contentHash");
  });
});

describe("ashtamWindowFilter", () => {
  it("memilih berdasarkan masa berlaku saja", () => {
    const filter = ashtamWindowFilter(windowStart, windowEnd);
    if (!filter) throw new Error("filter kosong");
    const { sql } = new PgDialect().sqlToQuery(filter);

    expect(sql).toContain('"ashtam_messages"."effective_from" <= $1');
    expect(sql).toContain('"ashtam_messages"."effective_to" >= $2');
    expect(sql).not.toContain('"ashtam_messages"."affected_fir"');
  });
});

const feature = (over: Partial<AerodromeFeature>): AerodromeFeature =>
  ({
    id: "44444444-4444-4444-4444-444444444444",
    airportId: "WARR",
    layer: "RUNWAY",
    name: "10/28",
    status: "ACTIVE",
    geometry: { type: "Polygon", coordinates: [] },
    properties: { active: true, surface: "asphalt" },
    ...over,
  }) as AerodromeFeature;

describe("aerodromeSnapshotEvents", () => {
  it("tidak menghasilkan event bila tidak ada fitur", () => {
    expect(aerodromeSnapshotEvents([], "WARR", fromMs)).toEqual([]);
  });

  it("menghasilkan satu event aerodrome di awal rentang", () => {
    const events = aerodromeSnapshotEvents([feature({})], "WARR", fromMs);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("aerodrome");
    expect(events[0].ts).toBe(fromMs);
    expect(events[0].timestamp).toBe("2026-11-08T00:00:00.000Z");
  });

  it("mengambil status bandara dari fitur AERODROME dan membawa fitur", () => {
    const [event] = aerodromeSnapshotEvents(
      [feature({ layer: "AERODROME", status: "RESTRICTED" }), feature({})],
      "WARR",
      fromMs,
    );
    expect(event.data).toMatchObject({
      airportId: "WARR",
      status: "RESTRICTED",
      features: [
        { layer: "AERODROME", status: "RESTRICTED" },
        { layer: "RUNWAY", name: "10/28", properties: { active: true } },
      ],
    });
  });

  it("status null bila tidak ada fitur AERODROME", () => {
    const [event] = aerodromeSnapshotEvents([feature({})], "WARR", fromMs);
    expect(event.data).toMatchObject({ status: null });
  });

  it("membawa geometri tanpa identitas track", () => {
    const [event] = aerodromeSnapshotEvents([feature({})], "WARR", fromMs);
    const data = event.data as { features: object[] };
    expect(data.features[0]).toHaveProperty("geometry", {
      type: "Polygon",
      coordinates: [],
    });
    expect(data).not.toHaveProperty("trackId");
    expect(data).not.toHaveProperty("icao24");
  });
});

describe("aerodromeSnapshotFilter", () => {
  it("memilih layer operasional bandara", () => {
    const filter = aerodromeSnapshotFilter("WARR");
    if (!filter) throw new Error("filter kosong");
    const { sql, params } = new PgDialect().sqlToQuery(filter);

    expect(sql).toContain('"aerodrome_features"."airport_id" = $1');
    expect(sql).toContain('"aerodrome_features"."layer" in');
    expect(params).toEqual([
      "WARR",
      "AERODROME",
      "RUNWAY",
      "TAXIWAY",
      "APRON",
      "RESTRICTED",
    ]);
  });
});

describe("latestPerKey", () => {
  const stored = (key: string, updatedAt: string) => ({
    key,
    updatedAt: new Date(updatedAt),
  });

  it("menyisakan baris terbaru untuk tiap kunci", () => {
    const older = stored("A1", "2026-11-01T00:00:00.000Z");
    const newer = stored("A1", "2026-11-02T00:00:00.000Z");
    const other = stored("A2", "2026-11-01T00:00:00.000Z");

    const result = latestPerKey([older, other, newer], (row) => row.key);

    expect(result).toHaveLength(2);
    expect(result).toContain(newer);
    expect(result).toContain(other);
  });
});

describe("ashtamWindowFilter sumber data", () => {
  it("mengecualikan baris dari sumber mock", () => {
    const filter = ashtamWindowFilter(windowStart, windowEnd);
    if (!filter) throw new Error("filter kosong");
    const { sql, params } = new PgDialect().sqlToQuery(filter);

    expect(sql).toContain('"ashtam_messages"."source" <> $3');
    expect(params[2]).toBe("ashtam-mock");
  });
});

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
