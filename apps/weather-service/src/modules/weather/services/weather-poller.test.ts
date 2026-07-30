import { beforeEach, describe, expect, it, mock } from "bun:test";

const fetchLatestMetar = mock();
const fetchLatestTaf = mock();
const saveObservation = mock();
const saveForecast = mock();

mock.module("../provider/metar.provider", () => ({ fetchLatestMetar }));
mock.module("../provider/taf.provider", () => ({ fetchLatestTaf }));
mock.module("./weather.service", () => ({ saveObservation, saveForecast }));

// Imported dynamically, after the mocks above are registered, so the poller
// picks up the mocked provider + persistence layer instead of the real ones
// (no network call, no DB required to exercise the polling logic itself).
// biome-ignore lint/nursery/useExplicitType: destructured from a dynamic import, already fully typed by ./weather-poller
const { pollMetar, pollTaf } = await import("./weather-poller");

const metarItem = {
  icaoId: "WARR",
  receiptTime: "2026-07-08 05:00",
  obsTime: 1_800_000_000,
  reportTime: "2026-07-08 05:00",
  temp: 30,
  dewp: 24,
  wdir: 90,
  wspd: 8,
  wgst: null,
  visib: "9000",
  altim: null,
  metarType: "METAR",
  rawOb: "METAR WARR 080500Z 09008KT 9000 FEW018 30/24 Q1009=",
  clouds: [],
};

const tafItem = {
  icaoId: "WARR",
  bulletinTime: "2026-07-08 05:00",
  issueTime: "2026-07-08T05:00:00Z",
  validTimeFrom: 1_800_000_000,
  validTimeTo: 1_800_010_000,
  // biome-ignore lint/style/useNamingConvention: mirrors TafProviderItem's rawTAF field, named after the provider's API response
  rawTAF: "TAF WARR 080500Z 0806/0818 09008KT 9000 SCT018",
  fcsts: [{ timeFrom: 1_800_000_000, timeTo: 1_800_010_000 }],
};

beforeEach(() => {
  fetchLatestMetar.mockReset();
  fetchLatestTaf.mockReset();
  saveObservation.mockReset();
  saveForecast.mockReset();
});

describe("pollMetar", () => {
  it("fetches, parses, and saves a new observation", async () => {
    fetchLatestMetar.mockResolvedValue(metarItem);

    await pollMetar();

    expect(saveObservation).toHaveBeenCalledTimes(1);
    const [saved] = saveObservation.mock.calls[0] as [Record<string, unknown>];
    expect(saved.station).toBe("WARR");
    expect(saved.kind).toBe("METAR");
    expect(saved.raw).toBe(metarItem.rawOb);
    expect(saved.source).toBe("aviationweather");
    expect((saved.parsed as { windDirection: number }).windDirection).toBe(90);
  });

  it("does not save anything when the provider fails gracefully (returns null)", async () => {
    fetchLatestMetar.mockResolvedValue(null);

    // Should resolve, not throw -- a provider outage must not stop the poller.
    await expect(pollMetar()).resolves.toBeUndefined();
    expect(saveObservation).not.toHaveBeenCalled();
  });

  it("propagates a persistence failure instead of swallowing it", async () => {
    fetchLatestMetar.mockResolvedValue(metarItem);
    saveObservation.mockRejectedValue(new Error("db unavailable"));

    await expect(pollMetar()).rejects.toThrow("db unavailable");
  });
});

describe("pollTaf", () => {
  it("fetches, parses, and saves a new forecast", async () => {
    fetchLatestTaf.mockResolvedValue(tafItem);

    await pollTaf();

    expect(saveForecast).toHaveBeenCalledTimes(1);
    const [saved] = saveForecast.mock.calls[0] as [Record<string, unknown>];
    expect(saved.station).toBe("WARR");
    expect(saved.raw).toBe(tafItem.rawTAF);
    expect(saved.source).toBe("aviationweather");
    expect((saved.parsed as { periods: unknown[] }).periods).toHaveLength(1);
  });

  it("does not save anything when the provider fails gracefully (returns null)", async () => {
    fetchLatestTaf.mockResolvedValue(null);

    await expect(pollTaf()).resolves.toBeUndefined();
    expect(saveForecast).not.toHaveBeenCalled();
  });

  it("propagates a persistence failure instead of swallowing it", async () => {
    fetchLatestTaf.mockResolvedValue(tafItem);
    saveForecast.mockRejectedValue(new Error("db unavailable"));

    await expect(pollTaf()).rejects.toThrow("db unavailable");
  });
});
