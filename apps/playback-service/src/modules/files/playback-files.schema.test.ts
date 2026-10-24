import { describe, expect, it } from "bun:test";
import {
  createRecordingSchema,
  importFileSchema,
  listPlaybackFilesSchema,
  patchPlaybackFileSchema,
  playFileSchema,
} from "./playback-files.schema";

describe("playback file request schemas", () => {
  it("accepts a valid generation request", () => {
    expect(
      createRecordingSchema.safeParse({
        airportId: "WARR",
        from: "2026-07-08T05:00:00.000Z",
        to: "2026-07-08T06:00:00.000Z",
      }).success,
    ).toBe(true);
  });
  it("rejects non-PBK import names", () => {
    expect(
      importFileSchema.safeParse({
        airportId: "WARR",
        fileName: "recording.zip",
      }).success,
    ).toBe(false);
  });
  it("accepts import metadata with only an airport, and a .pbk file name override", () => {
    expect(importFileSchema.safeParse({ airportId: "WARR" }).success).toBe(
      true,
    );
    expect(
      importFileSchema.safeParse({ airportId: "WARR", fileName: "a.PBK" })
        .success,
    ).toBe(true);
  });
  it("requires an airport on import", () => {
    expect(importFileSchema.safeParse({ fileName: "a.pbk" }).success).toBe(
      false,
    );
  });
  it("applies bounded pagination defaults", () => {
    expect(listPlaybackFilesSchema.parse({}).limit).toBe(20);
    expect(listPlaybackFilesSchema.safeParse({ limit: 1000 }).success).toBe(
      false,
    );
  });
  it("rejects empty metadata patches", () => {
    expect(patchPlaybackFileSchema.safeParse({}).success).toBe(false);
  });
  it("rejects an unknown source on import and patch", () => {
    expect(
      importFileSchema.safeParse({
        airportId: "WARR",
        fileName: "a.pbk",
        source: "other",
      }).success,
    ).toBe(false);
    expect(patchPlaybackFileSchema.safeParse({ source: "other" }).success).toBe(
      false,
    );
  });
  it("rejects a list date range where from is after to", () => {
    expect(
      listPlaybackFilesSchema.safeParse({
        from: "2026-07-08T06:00:00.000Z",
        to: "2026-07-08T05:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      listPlaybackFilesSchema.safeParse({
        from: "2026-07-08T05:00:00.000Z",
        to: "2026-07-08T06:00:00.000Z",
      }).success,
    ).toBe(true);
  });
  it("defaults play speed to 1 and bounds it", () => {
    expect(playFileSchema.parse({}).speed).toBe(1);
    expect(playFileSchema.safeParse({ speed: 0 }).success).toBe(false);
    expect(playFileSchema.safeParse({ speed: 17 }).success).toBe(false);
  });
});
