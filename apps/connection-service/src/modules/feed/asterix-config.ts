import type { RadarSite } from "@aeroswarm/codec";
import type { AsterixFeedConfig } from "@aeroswarm/ingest";
import { type Env, isPort, portFromEnv, str } from "./feed-env";

export interface NamedFeedConfig {
  /** Stable label for logs and stats, e.g. "asterix-udp". */
  name: string;
  config: AsterixFeedConfig;
}

export interface FeedConfigResult {
  feeds: NamedFeedConfig[];
  warnings: string[];
}

const DEFAULT_CATS = "10,11,20,21,48,62";

function parseCatList(raw: string | undefined): Set<number> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
}

/** "21:2.4,48:1.21" -> { 21: "2.4", 48: "1.21" } */
function parseForcedEditions(
  raw: string | undefined,
): Record<number, string> | undefined {
  if (!raw) return undefined;
  const out: Record<number, string> = {};
  for (const pair of raw.split(",")) {
    const [cat, ed] = pair.split(":").map((s) => s.trim());
    const n = Number(cat);
    if (Number.isInteger(n) && n > 0 && ed) out[n] = ed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseSite(lat: unknown, lon: unknown): RadarSite | null {
  if (typeof lat === "string" && !lat.trim()) return null;
  if (typeof lon === "string" && !lon.trim()) return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lon: lo };
}

/** Validates a `{"sac:sic": {lat, lon}}` map; invalid entries are skipped with a warning. */
function validateRadarSites(
  obj: unknown,
  label: string,
  warnings: string[],
): Record<string, RadarSite> | undefined {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    warnings.push(
      `${label} must be an object of "sac:sic" -> {lat,lon} — ignored`,
    );
    return undefined;
  }
  const out: Record<string, RadarSite> = {};
  for (const [key, value] of Object.entries(obj)) {
    const v = value as { lat?: unknown; lon?: unknown } | null;
    const site = v ? parseSite(v.lat, v.lon) : null;
    if (site && /^\d+:\d+$/.test(key)) out[key] = site;
    else
      warnings.push(
        `${label}["${key}"] is not a valid "sac:sic" -> {lat,lon} entry — skipped`,
      );
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `{"50:176":{"lat":-7.38,"lon":112.78}}` */
function parseRadarSites(
  raw: string | undefined,
  warnings: string[],
): Record<string, RadarSite> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return validateRadarSites(JSON.parse(raw), "ASTERIX_RADAR_SITES", warnings);
  } catch {
    warnings.push("ASTERIX_RADAR_SITES is not valid JSON — ignored");
    return undefined;
  }
}

/**
 * Builds the ASTERIX feeds from env. A UDP listener and a TCP client can run
 * side by side.
 *
 *   UDP   AEROSWARM_FEED_UDP_PORT (+ _HOST, _MULTICAST_GROUP, _MULTICAST_IFACE, _SOURCE_ID)
 *   TCP   ASTERIX_TCP_HOST + ASTERIX_TCP_PORT (+ ASTERIX_TCP_SOURCE_ID)
 *         TCP is a client: it connects out to the radar/gateway and reconnects.
 *   both  AEROSWARM_AIRPORT_ID, ASTERIX_ALLOWED_CATS, ASTERIX_FORCED_EDITIONS,
 *         RADAR_SITE_LAT/LON, ASTERIX_RADAR_SITES (per "sac:sic" override)
 *
 * Any number of further feeds (several UDP ports, several TCP radars) go in
 * ASTERIX_FEEDS, a JSON array — see `listedFeeds`. They run in addition to the
 * two above.
 *
 * A feed is simply absent when its port is unset, so the other ingest paths
 * keep working without it.
 */
export function loadAsterixFeedConfigs(env: Env): FeedConfigResult {
  const warnings: string[] = [];
  const shared = sharedConfig(env, warnings);
  const feeds = [
    udpFeed(env, shared, warnings),
    tcpFeed(env, shared, warnings),
  ].filter((f): f is NamedFeedConfig => f !== null);
  for (const extra of listedFeeds(env, shared, warnings)) {
    const clash = feedClash(feeds, extra);
    if (clash)
      warnings.push(`ASTERIX_FEEDS "${extra.name}": ${clash} — skipped`);
    else feeds.push(extra);
  }
  return { feeds, warnings };
}

function feedClash(
  existing: NamedFeedConfig[],
  f: NamedFeedConfig,
): string | null {
  if (existing.some((e) => e.name === f.name)) return "name already used";
  if (f.config.transport !== "udp") return null;
  const bind = f.config.bindHost ?? "0.0.0.0";
  const same = existing.find(
    (e) =>
      e.config.transport === "udp" &&
      e.config.port === f.config.port &&
      (e.config.bindHost ?? "0.0.0.0") === bind,
  );
  // Two listeners on one UDP port both receive every datagram: duplicate tracks.
  return same
    ? `UDP port ${f.config.port} is already used by "${same.name}"`
    : null;
}

type Shared = Pick<
  AsterixFeedConfig,
  "airportId" | "allowedCats" | "forcedEditions" | "radarSite" | "radarSites"
>;

function sharedConfig(env: Env, warnings: string[]): Shared {
  // An empty RADAR_SITE_* must mean "unset": Number("") is 0, which would
  // silently place every CAT048 target relative to 0N 0E.
  const radarSite = parseSite(env.RADAR_SITE_LAT, env.RADAR_SITE_LON);
  const radarSites = parseRadarSites(env.ASTERIX_RADAR_SITES, warnings);
  if (!radarSite && !radarSites) {
    warnings.push(
      "RADAR_SITE_LAT/LON not set — CAT048/CAT020 targets without lat/lon will be skipped",
    );
  }
  return {
    airportId: env.AEROSWARM_AIRPORT_ID || undefined,
    allowedCats: parseCatList(env.ASTERIX_ALLOWED_CATS ?? DEFAULT_CATS),
    forcedEditions: parseForcedEditions(env.ASTERIX_FORCED_EDITIONS),
    ...(radarSite && { radarSite }),
    ...(radarSites && { radarSites }),
  };
}

function udpFeed(
  env: Env,
  shared: Shared,
  warnings: string[],
): NamedFeedConfig | null {
  const port = portFromEnv(env, "AEROSWARM_FEED_UDP_PORT", "UDP", warnings);
  if (port === null) return null;
  return {
    name: "asterix-udp",
    config: {
      ...shared,
      transport: "udp",
      port,
      bindHost: env.AEROSWARM_FEED_UDP_HOST || undefined,
      sourceId: env.AEROSWARM_FEED_SOURCE_ID || "asterix-udp",
      multicastGroup: env.AEROSWARM_FEED_MULTICAST_GROUP || undefined,
      multicastIface: env.AEROSWARM_FEED_MULTICAST_IFACE || undefined,
    },
  };
}

function tcpFeed(
  env: Env,
  shared: Shared,
  warnings: string[],
): NamedFeedConfig | null {
  const host = env.ASTERIX_TCP_HOST?.trim();
  const portSet = Boolean(env.ASTERIX_TCP_PORT?.trim());
  const port = portFromEnv(env, "ASTERIX_TCP_PORT", "TCP", warnings);
  if (!host && !portSet) return null;
  if (!host || port === null) {
    // An invalid port was already reported above; only report the pairing rule once.
    if (!host || !portSet) {
      warnings.push(
        "ASTERIX_TCP_HOST and ASTERIX_TCP_PORT must both be set — TCP feed disabled",
      );
    }
    return null;
  }
  return {
    name: "asterix-tcp",
    config: {
      ...shared,
      transport: "tcp",
      host,
      port,
      sourceId: env.ASTERIX_TCP_SOURCE_ID || "asterix-tcp",
    },
  };
}

interface ListedFeed {
  name?: unknown;
  transport?: unknown;
  host?: unknown;
  port?: unknown;
  bindHost?: unknown;
  sourceId?: unknown;
  airportId?: unknown;
  allowedCats?: unknown;
  forcedEditions?: unknown;
  radarSite?: unknown;
  radarSites?: unknown;
  multicastGroup?: unknown;
  multicastIface?: unknown;
}

/** `allowedCats` as `[21,48]` or `"21,48"`. */
function catsOf(
  v: unknown,
  fallback: Set<number> | undefined,
): Set<number> | undefined {
  if (Array.isArray(v)) return parseCatList(v.join(","));
  if (typeof v === "string") return parseCatList(v);
  return fallback;
}

/** `forcedEditions` as `{"21":"2.4"}` or `"21:2.4"`. */
function editionsOf(
  v: unknown,
  fallback: Record<number, string> | undefined,
): Record<number, string> | undefined {
  if (typeof v === "string") return parseForcedEditions(v);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return parseForcedEditions(
      Object.entries(v)
        .map(([k, ed]) => `${k}:${ed}`)
        .join(","),
    );
  }
  return fallback;
}

interface Endpoint {
  transport: "udp" | "tcp";
  port: number;
  host?: string;
}

/** The transport/port/host triple, or why the entry is unusable. */
function endpointOf(entry: ListedFeed): Endpoint | string {
  const transport =
    entry.transport === "udp" || entry.transport === "tcp"
      ? entry.transport
      : null;
  if (!transport) return 'transport must be "udp" or "tcp"';
  const port =
    typeof entry.port === "number" && isPort(entry.port) ? entry.port : null;
  if (port === null) return "port must be an integer 1-65535";
  const host = str(entry.host);
  if (transport === "tcp" && !host) return "host is required for tcp";
  return { transport, port, host };
}

/** Per-feed radar override, falling back to the shared env when the key is absent. */
function radarOf(
  entry: ListedFeed,
  shared: Shared,
  label: string,
  warnings: string[],
): Pick<Shared, "radarSite" | "radarSites"> {
  const site = entry.radarSite as { lat?: unknown; lon?: unknown } | undefined;
  return {
    radarSite:
      entry.radarSite === undefined
        ? shared.radarSite
        : (parseSite(site?.lat, site?.lon) ?? undefined),
    radarSites:
      entry.radarSites === undefined
        ? shared.radarSites
        : validateRadarSites(entry.radarSites, `${label}.radarSites`, warnings),
  };
}

function listedFeed(
  entry: ListedFeed,
  index: number,
  shared: Shared,
  warnings: string[],
): NamedFeedConfig | null {
  const label = `ASTERIX_FEEDS[${index}]`;
  const ep = endpointOf(entry);
  if (typeof ep === "string") {
    warnings.push(`${label}: ${ep} — skipped`);
    return null;
  }
  const name = str(entry.name) ?? `${ep.transport}-${index + 1}`;
  const { radarSite, radarSites } = radarOf(entry, shared, label, warnings);

  return {
    name,
    config: {
      airportId: str(entry.airportId) ?? shared.airportId,
      allowedCats: catsOf(entry.allowedCats, shared.allowedCats),
      forcedEditions: editionsOf(entry.forcedEditions, shared.forcedEditions),
      ...(radarSite && { radarSite }),
      ...(radarSites && { radarSites }),
      transport: ep.transport,
      port: ep.port,
      sourceId: str(entry.sourceId) ?? name,
      ...(ep.transport === "tcp"
        ? { host: ep.host }
        : {
            bindHost: str(entry.bindHost),
            multicastGroup: str(entry.multicastGroup),
            multicastIface: str(entry.multicastIface),
          }),
    },
  };
}

/**
 * ASTERIX_FEEDS: JSON array, one object per feed. Anything omitted falls back
 * to the shared env (airport, categories, editions, radar site).
 *
 *   [
 *     {"name":"radar-a","transport":"udp","port":30000,"multicastGroup":"224.0.0.1"},
 *     {"name":"radar-b","transport":"udp","port":30001,"radarSite":{"lat":-7.4,"lon":112.8}},
 *     {"name":"mlat","transport":"tcp","host":"10.0.0.5","port":2000,"allowedCats":[10,11]}
 *   ]
 *
 * Names must be unique; two UDP feeds may not share a port + bind address.
 */
function listedFeeds(
  env: Env,
  shared: Shared,
  warnings: string[],
): NamedFeedConfig[] {
  const raw = env.ASTERIX_FEEDS?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push("ASTERIX_FEEDS is not valid JSON — ignored");
    return [];
  }
  if (!Array.isArray(parsed)) {
    warnings.push("ASTERIX_FEEDS must be a JSON array — ignored");
    return [];
  }
  const out: NamedFeedConfig[] = [];
  parsed.forEach((entry, i) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      warnings.push(`ASTERIX_FEEDS[${i}] is not an object — skipped`);
      return;
    }
    const feed = listedFeed(entry as ListedFeed, i, shared, warnings);
    if (feed) out.push(feed);
  });
  return out;
}
