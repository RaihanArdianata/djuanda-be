import { describe, expect, it } from "bun:test";
import { createTraceStore, verdict } from "./trace-store";

const base = { icao24: "8a02ee", callsign: "GIA322", trackId: "ast_1" };

describe("createTraceStore", () => {
  it("finds an aircraft by callsign, with or without spaces and case, by icao24 and by track id", () => {
    const store = createTraceStore();
    store.record({ ...base, stage: "ingest", outcome: "diterima" });
    expect(store.query("GIA322")).toHaveLength(1);
    expect(store.query("gia 322")).toHaveLength(1);
    expect(store.query("322")).toHaveLength(1);
    expect(store.query("8A02EE")).toHaveLength(1);
    expect(store.query("ast_1")).toHaveLength(1);
    expect(store.query("BTK")).toHaveLength(0);
    expect(store.query("  ")).toHaveLength(0);
  });

  it("merges the same step recorded again into one entry with a count", () => {
    const store = createTraceStore();
    store.record(
      { ...base, stage: "gambaran-udara", outcome: "tampil", lat: 1, lon: 2 },
      1_000,
    );
    store.record(
      { ...base, stage: "gambaran-udara", outcome: "tampil", lat: 3, lon: 4 },
      2_000,
    );
    const [a] = store.query("GIA322");
    expect(a?.entries).toHaveLength(1);
    expect(a?.entries[0]).toMatchObject({
      count: 2,
      firstAt: 1_000,
      lastAt: 2_000,
      lat: 3,
      lon: 4,
    });
  });

  it("keeps a step that changed as a new entry", () => {
    const store = createTraceStore();
    store.record({ ...base, stage: "fusi", outcome: "dipakai" });
    store.record({ ...base, stage: "gambaran-udara", outcome: "ditolak" });
    store.record({ ...base, stage: "gambaran-udara", outcome: "tampil" });
    expect(store.query("GIA322")[0]?.entries.map((e) => e.outcome)).toEqual([
      "dipakai",
      "ditolak",
      "tampil",
    ]);
  });

  it("keeps only the latest entries of an aircraft, and forgets the aircraft not seen for longest", () => {
    const store = createTraceStore({ perAircraft: 3, maxAircraft: 2 });
    for (let i = 0; i < 6; i++)
      store.record({ ...base, stage: "ingest", outcome: `o${i}` });
    expect(store.query("GIA322")[0]?.entries.map((e) => e.outcome)).toEqual([
      "o3",
      "o4",
      "o5",
    ]);
    store.record({
      icao24: "aaaaaa",
      callsign: "AAA1",
      stage: "ingest",
      outcome: "x",
    });
    store.record({
      icao24: "bbbbbb",
      callsign: "BBB1",
      stage: "ingest",
      outcome: "x",
    });
    expect(store.size).toBe(2);
    expect(store.query("GIA322")).toHaveLength(0);
  });

  it("ignores a record with neither an icao24 nor a track id", () => {
    const store = createTraceStore();
    store.record({ stage: "ingest", outcome: "x" });
    expect(store.size).toBe(0);
  });

  it("joins the records of one aircraft whichever of the two keys they carried", () => {
    const store = createTraceStore();
    store.record({
      icao24: "8a02ee",
      callsign: "GIA322",
      stage: "ingest",
      outcome: "diterima",
    });
    store.record({
      icao24: "8a02ee",
      trackId: "ast_9",
      stage: "fusi",
      outcome: "dipakai",
    });
    const [a] = store.query("GIA322");
    expect(a?.trackId).toBe("ast_9");
    expect(a?.entries).toHaveLength(2);
  });
});

describe("verdict", () => {
  const T = 100_000;
  const aircraft = (...steps: [string, string, string?][]) => {
    const store = createTraceStore();
    for (const [stage, outcome, detail] of steps)
      store.record({ ...base, stage: stage as "ingest", outcome, detail }, T);
    const found = store.query("GIA322")[0];
    if (!found) throw new Error("not recorded");
    return found;
  };

  it("names the step that dropped it, and says it never reached the map", () => {
    const v = verdict(
      aircraft(["ingest", "dibuang: tanpa posisi", "radar 50:26 tanpa antena"]),
      T + 5_000,
    );
    expect(v).toContain("Dibuang di ingest");
    expect(v).toContain("radar 50:26 tanpa antena");
    expect(v).toContain("5 dtk lalu");
  });

  it("says when it reached the live picture but was not shown, and why", () => {
    const v = verdict(
      aircraft(
        ["fusi", "dipakai"],
        ["gambaran-udara", "ditolak", "di luar area cakupan"],
      ),
      T,
    );
    expect(v).toContain("tidak ditampilkan: ditolak (di luar area cakupan)");
  });

  it("points at the client when the live picture has it", () => {
    expect(
      verdict(
        aircraft(["fusi", "dipakai"], ["gambaran-udara", "tampil (active)"]),
        T,
      ),
    ).toContain("masalahnya di tampilan klien");
  });

  it("is plain without any record", () => {
    expect(verdict({ entries: [] }, T)).toBe("Tidak ada catatan.");
  });
});
