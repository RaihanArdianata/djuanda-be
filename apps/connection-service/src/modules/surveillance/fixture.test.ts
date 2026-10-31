import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { AsterixFeedSource } from "@aeroswarm/ingest";

describe("R&D ASTERIX fixture", () => {
  it("decodes the sanitized CAT020 sample without undecoded packets", async () => {
    const hex = await readFile(
      `${import.meta.dir}/../../../test-fixtures/asterix-cat020.hex`,
      "utf8",
    );
    const source = new AsterixFeedSource({
      transport: "udp",
      port: 0,
      bindHost: "127.0.0.1",
      airportId: "WARR",
      sourceId: "fixture",
    });
    const events: unknown[] = [];
    source.start((event) => events.push(event));
    source.processDatagram(Buffer.from(hex.replace(/[^0-9a-f]/gi, ""), "hex"));
    await source.stop();

    expect(source.stats.packetsReceived).toBe(1);
    expect(source.stats.packetsUndecoded).toBe(0);
    expect(
      events.some((event) => (event as { kind?: string }).kind === "track"),
    ).toBe(true);
  });
});
