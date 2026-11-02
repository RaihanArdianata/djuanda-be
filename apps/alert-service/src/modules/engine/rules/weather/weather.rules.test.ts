import { describe, expect, test } from "bun:test";
import type { AlertContext, WeatherContextData } from "../../types";
import { weatherCategoryRule } from "./weather-category.rule";
import { weatherCrosswindRule } from "./weather-crosswind.rule";
import { weatherMinimaRule } from "./weather-minima.rule";
import { weatherThunderstormRule } from "./weather-thunderstorm.rule";

const NOW = new Date("2026-11-02T07:00:00Z");

const TAF =
  "TAF WARR 020500Z 0206/0312 09008KT 9999 FEW020 BECMG 0208/0210 27012KT 4000 RA SCT015CB";
const TAF_CROSSWIND =
  "TAF WARR 020500Z 0206/0312 09008KT 9999 FEW020 BECMG 0208/0210 18025KT";

const weather = (
  metar: string | null,
  taf: string | null = TAF,
  observedAt = "2026-11-02T06:30:00Z",
): WeatherContextData => ({
  station: "WARR",
  current: metar
    ? {
        kind: "METAR",
        observedAt,
        raw: metar,
        parsed: {} as never,
        stale: false,
        staleSince: null,
      }
    : null,
  forecast: taf ? { raw: taf, forecast: {} as never, stale: false } : null,
});

/** Runway 3000 m x 45 m sepanjang 100 derajat true di Juanda. */
const runwayPolygon = (): [number, number][] => {
  const centre = { lat: -7.38, lon: 112.79 };
  const rad = (100 * Math.PI) / 180;
  const at = (along: number, across: number): [number, number] => {
    const east = Math.sin(rad) * along + Math.cos(rad) * across;
    const north = Math.cos(rad) * along - Math.sin(rad) * across;
    return [
      centre.lat + north / 111_320,
      centre.lon + east / (111_320 * Math.cos((centre.lat * Math.PI) / 180)),
    ];
  };
  return [at(-1500, -22), at(1500, -22), at(1500, 22), at(-1500, 22)];
};

const ctx = (
  data: WeatherContextData | null,
  runwayActive = true,
): AlertContext => ({
  airportId: "WARR",
  timestamp: NOW,
  tracks: [],
  weather: data,
  aerodrome: {
    features: [],
    runways: [
      {
        id: "rw",
        name: "10/28",
        status: null,
        active: runwayActive,
        polygon: runwayPolygon(),
      },
    ],
    surfaces: [],
    areas: [],
  },
});

const FOG = "METAR WARR 020630Z 09005KT 0800 FG VV001 28/27 Q1010 NOSIG";
const CLEAR = "METAR WARR 020630Z 09008KT 9999 FEW020 31/24 Q1010 NOSIG";

describe("WEATHER_MINIMA", () => {
  test("is inert until a minimum is configured", () => {
    expect(weatherMinimaRule.evaluate(ctx(weather(FOG)), {})).toEqual([]);
    expect(
      weatherMinimaRule.evaluate(ctx(weather(FOG)), { visibilityM: 0 }),
    ).toEqual([]);
  });

  test("CRITICAL when the observation is below the minimum, with the reasons", () => {
    const [alert] = weatherMinimaRule.evaluate(ctx(weather(FOG)), {
      visibilityM: 1000,
      ceilingFt: 200,
    });
    expect(alert).toMatchObject({
      alertId: "WEATHER_MINIMA|WARR|WARR|observed",
      type: "WEATHER_MINIMA",
      severity: "CRITICAL",
      trackId: "WX-WARR-OBS",
    });
    expect(alert?.data.message).toContain("visibility 800 m below 1000 m");
    expect(alert?.data.message).toContain("ceiling 100 ft below 200 ft");
    expect(alert?.data.message).toContain("METAR 0630Z");
    expect(alert?.data.weather).toBe(true);
    expect(typeof alert?.data.latitude).toBe("number"); // marker at the aerodrome
  });

  test("equal to the minimum is not below it", () => {
    expect(
      weatherMinimaRule.evaluate(
        ctx(
          weather(
            "METAR WARR 020630Z 09005KT 1000 FG FEW020 28/27 Q1010",
            null,
          ),
        ),
        { visibilityM: 1000 },
      ),
    ).toEqual([]);
  });

  test("WARNING when the TAF predicts below minima within the horizon", () => {
    const [alert] = weatherMinimaRule.evaluate(ctx(weather(CLEAR)), {
      visibilityM: 5000,
    });
    expect(alert).toMatchObject({
      severity: "WARNING",
      alertId: "WEATHER_MINIMA|WARR|WARR|forecast",
      trackId: "WX-WARR-FCST",
    });
    expect(alert?.data.message).toContain("from 1000Z");
    expect(alert?.triggeredAt).toEqual(NOW);
    expect(
      weatherMinimaRule.evaluate(ctx(weather(CLEAR)), {
        visibilityM: 5000,
        forecastHours: 1,
      }),
    ).toEqual([]);
  });

  test("an observation below minimum replaces the forecast alert", () => {
    const alerts = weatherMinimaRule.evaluate(ctx(weather(FOG)), {
      visibilityM: 1000,
    });
    expect(alerts.map((a) => a.data.kind)).toEqual(["observed"]);
  });

  test("RVR is checked per runway, and missing RVR never raises an alert", () => {
    const rvr = "METAR WARR 020630Z 09005KT 0400 R10/0300 FG VV001 28/27 Q1010";
    const [alert] = weatherMinimaRule.evaluate(ctx(weather(rvr, null)), {
      rvrM: 550,
      rvrRunways: ["10"],
    });
    expect(alert?.data.message).toContain("RVR 10 300 m below 550 m");
    expect(
      weatherMinimaRule.evaluate(ctx(weather(CLEAR, null)), { rvrM: 550 }),
    ).toEqual([]);
  });

  test("an old or stale observation raises nothing, unless the age limit is widened", () => {
    // the age comes from the time written in the report itself (0330Z), not from the cache time
    const old = weather(
      "METAR WARR 020330Z 09005KT 0800 FG VV001 28/27 Q1010 NOSIG",
      null,
    );
    expect(weatherMinimaRule.evaluate(ctx(old), { visibilityM: 1000 })).toEqual(
      [],
    );
    expect(
      weatherMinimaRule.evaluate(ctx(old), {
        visibilityM: 1000,
        maxObservationAgeMinutes: 600,
      }),
    ).toHaveLength(1);
    const stale = weather(FOG, null);
    if (stale.current) stale.current.stale = true;
    expect(
      weatherMinimaRule.evaluate(ctx(stale), { visibilityM: 1000 }),
    ).toEqual([]);
  });

  test("does nothing without weather, with a cancelled TAF, or with a message that is not a METAR", () => {
    expect(
      weatherMinimaRule.evaluate(ctx(null), { visibilityM: 1000 }),
    ).toEqual([]);
    expect(
      weatherMinimaRule.evaluate(
        ctx(weather(CLEAR, "TAF WARR 020500Z 0206/0312 CNL")),
        { visibilityM: 20_000 },
      ),
    ).toHaveLength(1); // only the observation (9999 -> 10000 < 20000)
    expect(
      weatherMinimaRule.evaluate(ctx(weather("garbage", null)), {
        visibilityM: 1000,
      }),
    ).toEqual([]);
  });

  test("declares that it needs weather", () => {
    expect(weatherMinimaRule.needs).toEqual(["weather"]);
  });
});

describe("WEATHER_CROSSWIND", () => {
  const crosswind = "METAR WARR 020630Z 19025KT 9999 FEW020 31/24 Q1010 NOSIG";

  test("is inert without a limit", () => {
    expect(weatherCrosswindRule.evaluate(ctx(weather(crosswind)), {})).toEqual(
      [],
    );
  });

  test("CRITICAL when the crosswind on the active runway exceeds the limit", () => {
    const [alert] = weatherCrosswindRule.evaluate(ctx(weather(crosswind)), {
      crosswindKt: 20,
    });
    expect(alert).toMatchObject({
      type: "WEATHER_CROSSWIND",
      severity: "CRITICAL",
      alertId: "WEATHER_CROSSWIND|WARR|WARR|observed",
    });
    expect(alert?.data.message).toContain(
      "crosswind 25 kt on runway 10/28 exceeds limit 20 kt",
    );
  });

  test("a wind along the runway, or a crosswind below the limit, raises nothing", () => {
    expect(
      weatherCrosswindRule.evaluate(
        ctx(
          weather("METAR WARR 020630Z 10025KT 9999 FEW020 31/24 Q1010", null),
        ),
        { crosswindKt: 20 },
      ),
    ).toEqual([]);
    expect(
      weatherCrosswindRule.evaluate(ctx(weather(crosswind, null)), {
        crosswindKt: 30,
      }),
    ).toEqual([]);
  });

  test("the gust counts", () => {
    const gusting = "METAR WARR 020630Z 19010G30KT 9999 FEW020 31/24 Q1010";
    expect(
      weatherCrosswindRule.evaluate(ctx(weather(gusting, null)), {
        crosswindKt: 20,
      }),
    ).toHaveLength(1);
    expect(
      weatherCrosswindRule.evaluate(
        ctx(
          weather("METAR WARR 020630Z 19010KT 9999 FEW020 31/24 Q1010", null),
        ),
        { crosswindKt: 20 },
      ),
    ).toEqual([]);
  });

  test("a variable wind gives no alert it cannot justify", () => {
    expect(
      weatherCrosswindRule.evaluate(
        ctx(
          weather("METAR WARR 020630Z VRB03KT 9999 FEW020 31/24 Q1010", null),
        ),
        { crosswindKt: 20 },
      ),
    ).toEqual([]);
  });

  test("uses only active runways unless asked otherwise, or an explicit runway list", () => {
    const inactive = ctx(weather(crosswind, null), false);
    expect(
      weatherCrosswindRule.evaluate(inactive, { crosswindKt: 20 }),
    ).toEqual([]);
    expect(
      weatherCrosswindRule.evaluate(inactive, {
        crosswindKt: 20,
        onlyActiveRunways: false,
      }),
    ).toHaveLength(1);
    const noAerodrome = { ...ctx(weather(crosswind, null)), aerodrome: null };
    expect(
      weatherCrosswindRule.evaluate(noAerodrome, { crosswindKt: 20 }),
    ).toEqual([]);
    expect(
      weatherCrosswindRule.evaluate(noAerodrome, {
        crosswindKt: 20,
        runways: [{ designator: "10", magneticHeadingDeg: 100 }],
      }),
    ).toHaveLength(1);
  });

  test("the magnetic variation turns an explicit magnetic heading into true (a polygon heading is already true)", () => {
    // wind 190 at 20 kt on a runway whose magnetic heading is 100: true 100 gives a crosswind of 20,
    // true 110 (variation +10) gives 20 * sin(80) = 19.7
    const wind = "METAR WARR 020630Z 19020KT 9999 FEW020 31/24 Q1010";
    const explicit = {
      aerodrome: null,
      runways: [{ designator: "10", magneticHeadingDeg: 100 }],
      crosswindKt: 19.8,
    };
    const noAerodrome = { ...ctx(weather(wind, null)), aerodrome: null };
    expect(weatherCrosswindRule.evaluate(noAerodrome, explicit)).toHaveLength(
      1,
    );
    expect(
      weatherCrosswindRule.evaluate(noAerodrome, {
        ...explicit,
        variationEastDeg: 10,
      }),
    ).toEqual([]);
    // from the polygon the variation changes nothing, because the polygon heading is geometric (true)
    expect(
      weatherCrosswindRule.evaluate(ctx(weather(wind, null)), {
        crosswindKt: 19.8,
        variationEastDeg: 10,
      }),
    ).toHaveLength(1);
  });

  test("WARNING from the TAF", () => {
    const [alert] = weatherCrosswindRule.evaluate(
      ctx(weather(CLEAR, TAF_CROSSWIND)),
      { crosswindKt: 20 },
    );
    expect(alert).toMatchObject({
      severity: "WARNING",
      alertId: "WEATHER_CROSSWIND|WARR|WARR|forecast",
    });
    expect(alert?.data.message).toContain("from 1000Z");
  });
});

describe("WEATHER_CATEGORY_DROP", () => {
  test("is inert without a valid alertFrom", () => {
    expect(weatherCategoryRule.evaluate(ctx(weather(FOG)), {})).toEqual([]);
    expect(
      weatherCategoryRule.evaluate(ctx(weather(FOG)), { alertFrom: "BAD" }),
    ).toEqual([]);
  });

  test("CRITICAL when the observed category is at or below alertFrom", () => {
    const [alert] = weatherCategoryRule.evaluate(ctx(weather(FOG)), {
      alertFrom: "IFR",
    });
    expect(alert).toMatchObject({
      severity: "CRITICAL",
      alertId: "WEATHER_CATEGORY_DROP|WARR|WARR|observed",
    });
    expect(alert?.data.message).toContain("flight category LIFR");
    expect(alert?.data.category).toBe("LIFR");
  });

  test("a better category than alertFrom does not alert", () => {
    expect(
      weatherCategoryRule.evaluate(ctx(weather(FOG, null)), {
        alertFrom: "LIFR",
      }),
    ).toHaveLength(1); // LIFR is LIFR
    expect(
      weatherCategoryRule.evaluate(
        ctx(
          weather(
            "METAR WARR 020630Z 09008KT 4000 HZ FEW020 31/24 Q1010",
            null,
          ),
        ),
        { alertFrom: "LIFR" },
      ),
    ).toEqual([]);
    expect(
      weatherCategoryRule.evaluate(
        ctx(
          weather(
            "METAR WARR 020630Z 09008KT 4000 HZ FEW020 31/24 Q1010",
            null,
          ),
        ),
        { alertFrom: "IFR" },
      ),
    ).toHaveLength(1);
  });

  test("WARNING when the TAF drops to alertFrom within the horizon", () => {
    const [alert] = weatherCategoryRule.evaluate(ctx(weather(CLEAR)), {
      alertFrom: "IFR",
    });
    expect(alert).toMatchObject({ severity: "WARNING" });
    expect(alert?.data.message).toContain(
      "forecast flight category IFR from 1000Z",
    );
  });
});

describe("WEATHER_THUNDERSTORM", () => {
  test("CRITICAL for a thunderstorm at the aerodrome", () => {
    const [alert] = weatherThunderstormRule.evaluate(
      ctx(
        weather(
          "METAR WARR 020630Z 09010KT 4000 +TSRA BKN014CB 27/25 Q1008",
          null,
        ),
      ),
      {},
    );
    expect(alert).toMatchObject({
      severity: "CRITICAL",
      alertId: "WEATHER_THUNDERSTORM|WARR|WARR|observed",
    });
  });

  test("WARNING for a thunderstorm in the vicinity or a CB, as a separate alert", () => {
    const [vc] = weatherThunderstormRule.evaluate(
      ctx(
        weather(
          "METAR WARR 020630Z 09010KT 9999 VCTS FEW016CB 28/25 Q1010",
          null,
        ),
      ),
      {},
    );
    expect(vc).toMatchObject({
      severity: "WARNING",
      trackId: "WX-WARR-VC",
      alertId: "WEATHER_THUNDERSTORM|WARR|WARR|vicinity",
    });
    const [cb] = weatherThunderstormRule.evaluate(
      ctx(
        weather("METAR WARR 020630Z 09010KT 9999 FEW016CB 28/25 Q1010", null),
      ),
      {},
    );
    expect(cb?.data.kind).toBe("vicinity");
  });

  test("WARNING from the TAF, and not when the observation already shows one", () => {
    const [forecast] = weatherThunderstormRule.evaluate(
      ctx(weather(CLEAR)),
      {},
    );
    expect(forecast).toMatchObject({
      severity: "WARNING",
      trackId: "WX-WARR-FCST",
    });
    expect(forecast?.data.message).toContain("from 0900Z");
    expect(
      weatherThunderstormRule.evaluate(ctx(weather(CLEAR)), {
        forecastHours: 1,
      }),
    ).toEqual([]);
    const both = weatherThunderstormRule.evaluate(
      ctx(weather("METAR WARR 020630Z 09010KT 9999 VCTS FEW016CB 28/25 Q1010")),
      {},
    );
    expect(both.map((a) => a.data.kind)).toEqual(["vicinity"]);
  });

  test("nothing for fair weather", () => {
    expect(
      weatherThunderstormRule.evaluate(
        ctx(weather(CLEAR, "TAF WARR 020500Z 0206/0312 09008KT 9999 FEW020")),
        {},
      ),
    ).toEqual([]);
    expect(weatherThunderstormRule.evaluate(ctx(null), {})).toEqual([]);
  });
});
