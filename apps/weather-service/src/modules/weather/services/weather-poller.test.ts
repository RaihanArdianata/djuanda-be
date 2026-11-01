import { beforeEach, describe, expect, it, mock } from "bun:test";

const fetchLatestBmkgMetar = mock();
const fetchLatestBmkgSpeci = mock();
const fetchLatestBmkgTaf = mock();
const saveObservation = mock();
const saveForecast = mock();

mock.module("../provider/bmkg.provider", () => ({
  fetchLatestBmkgMetar,
  fetchLatestBmkgSpeci,
  fetchLatestBmkgTaf,
}));
mock.module("./weather.service", () => ({ saveObservation, saveForecast }));
mock.module("../../messaging/weather.producer", () => ({
  publishWeatherEvent: mock(),
}));
mock.module("@repo/shared/sse/publisher", () => ({
  publishToTopic: mock(),
}));

// Imported dynamically, after the mocks above are registered, so the poller
// picks up the mocked provider + persistence layer instead of the real ones
// (no network call, no DB required to exercise the polling logic itself).
const { pollMetar, pollTaf, syncWeatherNow } = await import("./weather-poller");

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
  rawTAF: "TAF WARR 080500Z 0806/0818 09008KT 9000 SCT018",
  fcsts: [{ timeFrom: 1_800_000_000, timeTo: 1_800_010_000 }],
};

beforeEach(() => {
  fetchLatestBmkgMetar.mockReset();
  fetchLatestBmkgSpeci.mockReset();
  fetchLatestBmkgTaf.mockReset();
  saveObservation.mockReset();
  saveForecast.mockReset();
});

describe("pollMetar", () => {
  it("fetches, parses, and saves a new observation", async () => {
    fetchLatestBmkgMetar.mockResolvedValue({
      icaoId: "WARR",
      obsTime: 1_800_000_000,
      rawOb: metarItem.rawOb,
      reportId: "bmkg-metar-1",
      providerRaw: {},
    });

    await pollMetar();

    expect(saveObservation).toHaveBeenCalledTimes(1);
    const [saved] = saveObservation.mock.calls[0] as [Record<string, unknown>];
    expect(saved.station).toBe("WARR");
    expect(saved.kind).toBe("METAR");
    expect(saved.raw).toBe(metarItem.rawOb);
    expect(saved.source).toBe("bmkg");
    expect((saved.parsed as { windDirection: number }).windDirection).toBe(90);
  });

  it("does not save anything when the provider fails gracefully (returns null)", async () => {
    fetchLatestBmkgMetar.mockResolvedValue(null);

    // Should resolve, not throw -- a provider outage must not stop the poller.
    await expect(pollMetar()).resolves.toBeUndefined();
    expect(saveObservation).not.toHaveBeenCalled();
  });

  it("propagates a persistence failure instead of swallowing it", async () => {
    fetchLatestBmkgMetar.mockResolvedValue({
      icaoId: "WARR",
      obsTime: 1_800_000_000,
      rawOb: metarItem.rawOb,
      reportId: "bmkg-metar-1",
      providerRaw: {},
    });
    saveObservation.mockRejectedValue(new Error("db unavailable"));

    await expect(pollMetar()).rejects.toThrow("db unavailable");
  });
});

describe("pollSpeci", () => {
  it("saves a BMKG SPECI as a distinct observation kind", async () => {
    fetchLatestBmkgSpeci.mockResolvedValue({
      icaoId: "WARR",
      obsTime: 1_800_000_000,
      rawOb: "SPECI WARR 080500Z 09008KT 9000 FEW018 30/24 Q1009=",
      reportId: "bmkg-speci-1",
      providerRaw: {},
    });

    const { pollSpeci } = await import("./weather-poller");
    await pollSpeci();

    const [saved] = saveObservation.mock.calls[0] as [Record<string, unknown>];
    expect(saved.kind).toBe("SPECI");
    expect(saved.source).toBe("bmkg");
  });
});

describe("pollTaf", () => {
  it("fetches, parses, and saves a new forecast", async () => {
    fetchLatestBmkgTaf.mockResolvedValue({
      icaoId: "WARR",
      issueTime: tafItem.issueTime,
      validTimeFrom: tafItem.validTimeFrom * 1000,
      validTimeTo: tafItem.validTimeTo * 1000,
      rawTaf: tafItem.rawTAF,
      reportId: "bmkg-taf-1",
      providerRaw: {},
    });

    await pollTaf();

    expect(saveForecast).toHaveBeenCalledTimes(1);
    const [saved] = saveForecast.mock.calls[0] as [Record<string, unknown>];
    expect(saved.station).toBe("WARR");
    expect(saved.raw).toBe(tafItem.rawTAF);
    expect(saved.source).toBe("bmkg");
    expect((saved.parsed as { periods: unknown[] }).periods).toHaveLength(1);
    expect(saved.validFrom).toEqual(new Date(tafItem.validTimeFrom * 1000));
    expect(saved.validTo).toEqual(new Date(tafItem.validTimeTo * 1000));
  });

  it("does not save anything when the provider fails gracefully (returns null)", async () => {
    fetchLatestBmkgTaf.mockResolvedValue(null);

    await expect(pollTaf()).resolves.toBeUndefined();
    expect(saveForecast).not.toHaveBeenCalled();
  });

  it("propagates a persistence failure instead of swallowing it", async () => {
    fetchLatestBmkgTaf.mockResolvedValue({
      icaoId: "WARR",
      issueTime: tafItem.issueTime,
      validTimeFrom: tafItem.validTimeFrom * 1000,
      validTimeTo: tafItem.validTimeTo * 1000,
      rawTaf: tafItem.rawTAF,
      reportId: "bmkg-taf-1",
      providerRaw: {},
    });
    saveForecast.mockRejectedValue(new Error("db unavailable"));

    await expect(pollTaf()).rejects.toThrow("db unavailable");
  });
});

describe("syncWeatherNow", () => {
  it("polls all three feeds, reports each one, and rate limits the next call", async () => {
    fetchLatestBmkgMetar.mockResolvedValue(null);
    fetchLatestBmkgSpeci.mockResolvedValue(null);
    fetchLatestBmkgTaf.mockRejectedValue(new Error("bmkg down"));

    const t0 = 1_000_000_000_000;
    const first = await syncWeatherNow(t0);
    expect(first?.results).toEqual({ metar: "ok", speci: "ok", taf: "failed" });

    expect(await syncWeatherNow(t0 + 5_000)).toBeNull();
    expect(await syncWeatherNow(t0 + 31_000)).not.toBeNull();
  });
});
