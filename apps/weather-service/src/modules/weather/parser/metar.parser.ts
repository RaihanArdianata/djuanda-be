import type { MetarParsedData, WeatherParsedCloud } from "@repo/database";

const WIND_RE = /\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/;
const CLOUD_RE = /\b(FEW|SCT|BKN|OVC)(\d{3})\b/g;
const TEMP_DEWPOINT_RE = /\b(M?\d{2})\/(M?\d{2})\b/;
const QNH_RE = /\bQ(\d{4})\b/;
const ALTIM_RE = /\bA(\d{4})\b/;
const VISIBILITY_RE = /\b(\d{4})\b/;
const RVR_RE = /\bR\d{2}[LRC]?\/[MP]?\d{3,4}(?:V[MP]?\d{3,4})?FT?\b/;
const WEATHER_PHENOMENA_PATTERN =
  /\b[+-]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|VA|PY|SQ|PO|DS|SS|FC)\b/g;

const toSignedInt = (raw: string): number =>
  raw.startsWith("M")
    ? -Number.parseInt(raw.slice(1), 10)
    : Number.parseInt(raw, 10);

const parseQnh = (body: string): number | null => {
  const qnh = QNH_RE.exec(body);
  if (qnh) {
    return Number.parseInt(qnh[1], 10);
  }

  const altim = ALTIM_RE.exec(body);
  if (!altim) {
    return null;
  }

  return Math.round((Number.parseInt(altim[1], 10) / 100) * 33.8639);
};

const parseVisibility = (body: string, cavok: boolean): number | null => {
  if (cavok) {
    return 9999;
  }

  const match = VISIBILITY_RE.exec(body.replace(/\d{6}Z/, ""));
  return match ? Number.parseInt(match[1], 10) : null;
};

export const parseMetar = (rawOb: string): MetarParsedData => {
  const body = rawOb.split(" RMK")[0];

  const cavok = body.includes("CAVOK");
  const nosig = body.includes("NOSIG");

  const wind = WIND_RE.exec(body);
  const windDirectionVariable = wind?.[1] === "VRB";
  const windDirection =
    wind && !windDirectionVariable ? Number.parseInt(wind[1], 10) : null;
  const windSpeedKt = wind ? Number.parseInt(wind[2], 10) : null;
  const gustKt = wind?.[3] ? Number.parseInt(wind[3], 10) : null;

  const tempDewpoint = TEMP_DEWPOINT_RE.exec(body);
  const temperatureC = tempDewpoint ? toSignedInt(tempDewpoint[1]) : null;
  const dewPointC = tempDewpoint ? toSignedInt(tempDewpoint[2]) : null;

  const qnhHpa = parseQnh(body);
  const visibilityM = parseVisibility(body, cavok);

  const clouds: WeatherParsedCloud[] = Array.from(body.matchAll(CLOUD_RE)).map(
    (m) => ({
      cover: m[1],
      baseFt: Number.parseInt(m[2], 10) * 100,
    }),
  );

  const phenomena = Array.from(
    new Set(body.match(WEATHER_PHENOMENA_PATTERN) ?? []),
  );

  return {
    windDirection,
    windDirectionVariable,
    windSpeedKt,
    gustKt,
    visibilityM,
    temperatureC,
    dewPointC,
    qnhHpa,
    clouds,
    phenomena,
    cavok,
    nosig,
    hasRvr: RVR_RE.test(body),
    partial: !wind || (!cavok && visibilityM === null),
  };
};
