const numberEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export const surveillanceConfig = {
  airportId: process.env.AIRPORT_ID || process.env.AEROSWARM_AIRPORT_ID || "",
  sourceId:
    process.env.SOURCE_ID ||
    process.env.AEROSWARM_FEED_SOURCE_ID ||
    "radar-main",
  sourceBindHost:
    process.env.SOURCE_BIND_HOST ||
    process.env.AEROSWARM_FEED_UDP_HOST ||
    "0.0.0.0",
  sourcePort: numberEnv(
    "SOURCE_PORT",
    Number(process.env.AEROSWARM_FEED_UDP_PORT || 2026),
  ),
  sourceTransport: process.env.SOURCE_TRANSPORT || "udp",
  sourceMulticastGroup:
    process.env.SOURCE_MULTICAST_GROUP ||
    process.env.AEROSWARM_FEED_MULTICAST_GROUP,
  sourceMulticastIface:
    process.env.SOURCE_MULTICAST_IFACE ||
    process.env.AEROSWARM_FEED_MULTICAST_IFACE,
  aftnEnabled: process.env.AFTN_ENABLED === "true",
  aftnTransport: process.env.AFTN_TRANSPORT || "udp",
  aftnBindHost: process.env.AFTN_BIND_HOST || "0.0.0.0",
  aftnPort: numberEnv("AFTN_PORT", 2028),
  aftnSourceId: process.env.AFTN_SOURCE_ID || "aftn",
  httpHost: process.env.HTTP_HOST || "0.0.0.0",
  httpPort: numberEnv(
    "HTTP_PORT",
    Number(process.env.CONNECTION_SERVICE_PORT || 18086),
  ),
  token:
    process.env.AERO_TOKEN ||
    process.env.AEROSWARM_MONITOR_TOKENS?.split(",")[0]?.trim() ||
    "",
  maxTracks: numberEnv("MAX_TRACKS", 10_000),
  maxDatagramBytes: numberEnv("MAX_DATAGRAM_BYTES", 65_507),
} as const;

export function isValidAeroToken(token: string | null): boolean {
  return Boolean(token) && token === surveillanceConfig.token;
}
