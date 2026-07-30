import { beforeEach, describe, expect, it, mock } from "bun:test";

// Auth is a cross-cutting concern owned by auth-service (JWT + DB lookup) --
// stub it out with a pass-through so these tests exercise weather-service's
// own routing/validation/response logic in isolation, without a real DB.
const passthroughMiddleware = async (
  _c: unknown,
  next: () => Promise<void>,
): Promise<void> => {
  await next();
};

mock.module("@repo/auth-service/src/middleware/auth.middleware", () => ({
  authentication: passthroughMiddleware,
  rbacMiddleware: passthroughMiddleware,
}));

const getCurrentObservation = mock();
const getObservationHistory = mock();
const getObservationHistoryCount = mock();
const getActiveForecast = mock();

mock.module("../services/weather.service", () => ({
  getCurrentObservation,
  getObservationHistory,
  getObservationHistoryCount,
  getActiveForecast,
  saveObservation: mock(),
  saveForecast: mock(),
}));

// Imported dynamically, after the mocks above are registered, so the route
// (via the controller) picks up the mocked auth middleware and service layer
// instead of the real ones.
// biome-ignore lint/nursery/useExplicitType: destructured from a dynamic import, already fully inferred from ./weather.route
const { default: weatherRoute } = await import("./weather.route");

const sampleObservation = {
  station: "WARR",
  kind: "METAR",
  observedAt: "2026-07-08T05:00:00.000Z",
  raw: "METAR WARR 080500Z 09008KT 9000 FEW018 30/24 Q1009=",
  parsed: {
    windDirection: 90,
    windDirectionVariable: false,
    windSpeedKt: 8,
    gustKt: null,
    visibilityM: 9000,
    temperatureC: 30,
    dewPointC: 24,
    qnhHpa: 1009,
    clouds: [],
    phenomena: [],
    cavok: false,
    nosig: false,
    hasRvr: false,
    partial: false,
  },
  stale: false,
  staleSince: null,
};

const sampleForecast = {
  station: "WARR",
  issuedAt: "2026-07-08T05:00:00.000Z",
  validFrom: "2026-07-08T06:00:00.000Z",
  validTo: "2026-07-08T18:00:00.000Z",
  raw: "TAF WARR 080500Z 0806/0818 09008KT 9000 SCT018",
  forecast: { periods: [], partial: false },
  stale: false,
};

beforeEach(() => {
  getCurrentObservation.mockReset();
  getObservationHistory.mockReset();
  getObservationHistoryCount.mockReset();
  getActiveForecast.mockReset();
});

describe("GET /current", () => {
  it("returns the latest observation wrapped in the ApiResponse envelope", async () => {
    getCurrentObservation.mockResolvedValue(sampleObservation);

    const res = await weatherRoute.request("/current");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data.station).toBe("WARR");
    expect(body.data.stale).toBe(false);
    expect(getCurrentObservation).toHaveBeenCalledWith(undefined);
  });

  it("forwards the station query param to the service", async () => {
    getCurrentObservation.mockResolvedValue(sampleObservation);

    await weatherRoute.request("/current?station=WARR");

    expect(getCurrentObservation).toHaveBeenCalledWith("WARR");
  });

  it("returns 404 with a NOT_FOUND error when no observation has been recorded yet", async () => {
    getCurrentObservation.mockResolvedValue(null);

    const res = await weatherRoute.request("/current");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 with a VALIDATION_ERROR when the station param isn't exactly 4 characters", async () => {
    const res = await weatherRoute.request("/current?station=TOOLONG");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /forecast", () => {
  it("returns the active TAF wrapped in the ApiResponse envelope", async () => {
    getActiveForecast.mockResolvedValue(sampleForecast);

    const res = await weatherRoute.request("/forecast");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.station).toBe("WARR");
    expect(body.data.forecast.periods).toEqual([]);
  });

  it("returns 404 with a NOT_FOUND error when no forecast has been recorded yet", async () => {
    getActiveForecast.mockResolvedValue(null);

    const res = await weatherRoute.request("/forecast");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("GET /history", () => {
  it("returns a paginated list of past observations", async () => {
    getObservationHistory.mockResolvedValue([sampleObservation]);
    getObservationHistoryCount.mockResolvedValue(25);

    const res = await weatherRoute.request("/history?page=1&size=10");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.meta.pagination).toEqual({
      page: 1,
      size: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it("defaults page/size when they're omitted", async () => {
    getObservationHistory.mockResolvedValue([]);
    getObservationHistoryCount.mockResolvedValue(0);

    await weatherRoute.request("/history");

    expect(getObservationHistory).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, size: 10 }),
    );
  });

  it("rejects a kind other than METAR/SPECI with a validation error", async () => {
    const res = await weatherRoute.request("/history?kind=BOGUS");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
