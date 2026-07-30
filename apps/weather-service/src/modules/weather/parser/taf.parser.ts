import type {
  TafParsedData,
  TafParsedPeriod,
  WeatherParsedCloud,
} from "@repo/database";

const WIND_RE = /\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/;
const VARIABLE_WIND_RE = /\b\d{3}V\d{3}\b/;
const CLOUD_RE = /\b(FEW|SCT|BKN|OVC|VV)(\d{3})\b/g;
const VISIBILITY_RE = /\b(\d{4})\b/;
const CHANGE_MARKER_RE = /\b(?:FM\d{6}|BECMG|TEMPO|PROB30|PROB40)\b/g;
const WEATHER_PHENOMENA_PATTERN =
  /\b[+-]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|VA|PY|SQ|PO|DS|SS|FC)\b/g;

interface RawTafSegment {
  changeType: string | null;
  probability: number | null;
  body: string;
}

const markerToChangeType = (
  marker: string,
): { changeType: string; probability: number | null } => {
  if (marker === "BECMG" || marker === "TEMPO") {
    return { changeType: marker, probability: null };
  }
  if (marker === "PROB30") {
    return { changeType: "PROB", probability: 30 };
  }
  if (marker === "PROB40") {
    return { changeType: "PROB", probability: 40 };
  }
  return { changeType: "FM", probability: null };
};

// Splits rawTAF into the base forecast plus one segment per FM/TEMPO/BECMG/
// PROB30/PROB40 change group, so each segment can be regex-parsed the same
// way as a standalone METAR body.
const splitTafSegments = (rawTaf: string): RawTafSegment[] => {
  const body = rawTaf.split(" RMK")[0];
  const markers = Array.from(body.matchAll(CHANGE_MARKER_RE));
  const segments: RawTafSegment[] = [];

  const firstMarkerIndex = markers[0]?.index ?? body.length;
  segments.push({
    changeType: null,
    probability: null,
    body: body.slice(0, firstMarkerIndex),
  });

  markers.forEach((marker, i) => {
    const start = (marker.index ?? 0) + marker[0].length;
    const end = markers[i + 1]?.index ?? body.length;
    const { changeType, probability } = markerToChangeType(marker[0]);
    segments.push({ changeType, probability, body: body.slice(start, end) });
  });

  return segments;
};

const parseSegment = (
  segment: RawTafSegment,
): Omit<TafParsedPeriod, "timeFrom" | "timeTo"> => {
  const wind = WIND_RE.exec(segment.body);
  const windDirectionVariable =
    wind?.[1] === "VRB" || VARIABLE_WIND_RE.test(segment.body);
  const windDirection =
    wind && wind[1] !== "VRB" ? Number.parseInt(wind[1], 10) : null;
  const windSpeedKt = wind ? Number.parseInt(wind[2], 10) : null;
  const gustKt = wind?.[3] ? Number.parseInt(wind[3], 10) : null;

  const cavok = segment.body.includes("CAVOK");
  const visibilityMatch = !cavok ? VISIBILITY_RE.exec(segment.body) : null;
  const visibilityM = cavok
    ? 9999
    : visibilityMatch
      ? Number.parseInt(visibilityMatch[1], 10)
      : null;

  const clouds: WeatherParsedCloud[] = Array.from(
    segment.body.matchAll(CLOUD_RE),
  ).map((m) => ({
    cover: m[1],
    baseFt: Number.parseInt(m[2], 10) * 100,
  }));

  const weather = Array.from(
    new Set(segment.body.match(WEATHER_PHENOMENA_PATTERN) ?? []),
  );

  return {
    changeType: segment.changeType,
    probability: segment.probability,
    windDirection,
    windDirectionVariable,
    windSpeedKt,
    gustKt,
    visibilityM,
    weather,
    clouds,
  };
};

const toIsoString = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toISOString();

export const parseTaf = (
  rawTaf: string,
  fcsts: { timeFrom: number; timeTo: number }[],
): TafParsedData => {
  const segments = splitTafSegments(rawTaf);

  const periods: TafParsedPeriod[] = fcsts.map((fcst, index) => {
    const segment = segments[index];
    const parsed = segment
      ? parseSegment(segment)
      : {
          changeType: null,
          probability: null,
          windDirection: null,
          windDirectionVariable: false,
          windSpeedKt: null,
          gustKt: null,
          visibilityM: null,
          weather: [],
          clouds: [],
        };

    return {
      ...parsed,
      timeFrom: toIsoString(fcst.timeFrom),
      timeTo: toIsoString(fcst.timeTo),
    };
  });

  return {
    periods,
    partial: segments.length !== fcsts.length,
  };
};
