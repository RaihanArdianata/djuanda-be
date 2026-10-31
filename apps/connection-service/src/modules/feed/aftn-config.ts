import type { AftnFeedConfig } from "@aeroswarm/ingest";
import { type Env, isPort, portFromEnv, str } from "./feed-env";

export interface NamedAftnFeed {
  /** Stable label for logs and stats, e.g. "aftn-udp". */
  name: string;
  config: AftnFeedConfig;
}

export interface AftnConfigResult {
  feeds: NamedAftnFeed[];
  warnings: string[];
}

type Shared = Pick<AftnFeedConfig, "airportId">;

/**
 * Builds the AFTN/ATS feeds from env. As with ASTERIX, UDP and TCP can run
 * side by side, and `AFTN_FEEDS` adds any number more.
 *
 *   UDP   AFTN_FEED_UDP_PORT (+ AFTN_FEED_SOURCE_ID, AFTN_FEED_MULTICAST_GROUP, AFTN_FEED_MULTICAST_IFACE)
 *         one AFTN message per datagram; always listens on 0.0.0.0
 *   TCP   AFTN_TCP_HOST + AFTN_TCP_PORT (+ AFTN_TCP_SOURCE_ID)
 *         a client: connects out to the AFTN gateway, reconnects every 5 s;
 *         a message ends at NNNN / ETX
 *   more  AFTN_FEEDS, a JSON array of {name, transport, port, host?, sourceId?,
 *         airportId?, multicastGroup?, multicastIface?}
 *
 * A feed is simply absent when its port is unset.
 */
export function loadAftnFeedConfigs(env: Env): AftnConfigResult {
  const warnings: string[] = [];
  const shared: Shared = { airportId: env.AEROSWARM_AIRPORT_ID || undefined };
  const feeds = [
    udpFeed(env, shared, warnings),
    tcpFeed(env, shared, warnings),
  ].filter((f): f is NamedAftnFeed => f !== null);

  for (const extra of listedFeeds(env, shared, warnings)) {
    const clash = feedClash(feeds, extra);
    if (clash) warnings.push(`AFTN_FEEDS "${extra.name}": ${clash} — skipped`);
    else feeds.push(extra);
  }
  return { feeds, warnings };
}

function udpFeed(
  env: Env,
  shared: Shared,
  warnings: string[],
): NamedAftnFeed | null {
  const port = portFromEnv(env, "AFTN_FEED_UDP_PORT", "AFTN UDP", warnings);
  if (port === null) return null;
  return {
    name: "aftn-udp",
    config: {
      ...shared,
      transport: "udp",
      port,
      sourceId: env.AFTN_FEED_SOURCE_ID || "aftn-udp",
      multicastGroup: env.AFTN_FEED_MULTICAST_GROUP || undefined,
      multicastIface: env.AFTN_FEED_MULTICAST_IFACE || undefined,
    },
  };
}

function tcpFeed(
  env: Env,
  shared: Shared,
  warnings: string[],
): NamedAftnFeed | null {
  const host = env.AFTN_TCP_HOST?.trim();
  const portSet = Boolean(env.AFTN_TCP_PORT?.trim());
  const port = portFromEnv(env, "AFTN_TCP_PORT", "AFTN TCP", warnings);
  if (!host && !portSet) return null;
  if (!host || port === null) {
    // An invalid port was already reported above; report the pairing rule once.
    if (!host || !portSet) {
      warnings.push(
        "AFTN_TCP_HOST and AFTN_TCP_PORT must both be set — AFTN TCP feed disabled",
      );
    }
    return null;
  }
  return {
    name: "aftn-tcp",
    config: {
      ...shared,
      transport: "tcp",
      host,
      port,
      sourceId: env.AFTN_TCP_SOURCE_ID || "aftn-tcp",
    },
  };
}

interface ListedFeed {
  name?: unknown;
  transport?: unknown;
  host?: unknown;
  port?: unknown;
  sourceId?: unknown;
  airportId?: unknown;
  multicastGroup?: unknown;
  multicastIface?: unknown;
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

function listedFeed(
  entry: ListedFeed,
  index: number,
  shared: Shared,
  warnings: string[],
): NamedAftnFeed | null {
  const ep = endpointOf(entry);
  if (typeof ep === "string") {
    warnings.push(`AFTN_FEEDS[${index}]: ${ep} — skipped`);
    return null;
  }
  const name = str(entry.name) ?? `aftn-${ep.transport}-${index + 1}`;
  return {
    name,
    config: {
      airportId: str(entry.airportId) ?? shared.airportId,
      transport: ep.transport,
      port: ep.port,
      sourceId: str(entry.sourceId) ?? name,
      ...(ep.transport === "tcp"
        ? { host: ep.host }
        : {
            multicastGroup: str(entry.multicastGroup),
            multicastIface: str(entry.multicastIface),
          }),
    },
  };
}

function listedFeeds(
  env: Env,
  shared: Shared,
  warnings: string[],
): NamedAftnFeed[] {
  const raw = env.AFTN_FEEDS?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push("AFTN_FEEDS is not valid JSON — ignored");
    return [];
  }
  if (!Array.isArray(parsed)) {
    warnings.push("AFTN_FEEDS must be a JSON array — ignored");
    return [];
  }
  const out: NamedAftnFeed[] = [];
  parsed.forEach((entry, i) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      warnings.push(`AFTN_FEEDS[${i}] is not an object — skipped`);
      return;
    }
    const feed = listedFeed(entry as ListedFeed, i, shared, warnings);
    if (feed) out.push(feed);
  });
  return out;
}

function feedClash(existing: NamedAftnFeed[], f: NamedAftnFeed): string | null {
  if (existing.some((e) => e.name === f.name)) return "name already used";
  if (f.config.transport !== "udp") return null;
  // Two listeners on one UDP port both receive every datagram: duplicate plans.
  const same = existing.find(
    (e) => e.config.transport === "udp" && e.config.port === f.config.port,
  );
  return same
    ? `UDP port ${f.config.port} is already used by "${same.name}"`
    : null;
}
