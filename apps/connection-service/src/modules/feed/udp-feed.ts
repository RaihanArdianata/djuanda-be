import { createSocket, type Socket } from "node:dgram";
import {
  type AsterixFields,
  parseAsterix,
  type RadarSite,
  resolveAsterixAltitudeFt,
  resolveAsterixPosition,
} from "@aeroswarm/codec";
import { logger } from "@repo/logger";
import {
  enqueueTrackEvent,
  type FusedTrackEventLike,
} from "../ingest/service/ingest.service";

/** Idle track identities are evicted after this — prevents unbounded growth
 *  on feeds with churning target identities (CAT62 track numbers, ADS-B). */
const TRACK_MAP_TTL_MS = 10 * 60_000;
const TRACK_MAP_SWEEP_MS = 60_000;

/** Per-target continuity: stable trackId + last kinematics/position so
 *  velocity-less reports (e.g. surface CAT021) don't snap heading/speed to 0. */
interface TrackEntry {
  trackId: string;
  lastSeenAt: number;
  lastVel?: { gs: number; hdg: number };
  lastPos?: { lat: number; lon: number; at: number };
}

export interface UdpFeedState {
  running: boolean;
  port: number;
  packetsReceived: number;
  packetsForwarded: number;
  packetsRejected: number;
  packetsSkipped: number;
  packetsUndecoded: number;
  lastError: string | null;
  lastDecoded: {
    category: number;
    edition: string;
    icao24?: string;
    lat?: number;
    lon?: number;
    at: number;
  } | null;
}

interface UdpFeedOptions {
  port: number;
  host?: string;
  sourceId: string;
  airportId?: string;
  allowedCats: Set<number>;
  forcedEditions?: Record<number, string>;
  multicastGroup?: string;
  multicastIface?: string;
  radarSite?: RadarSite | null;
}

/** Direct ASTERIX UDP ingest — decodes datagrams locally via @aeroswarm/codec
 *  and enqueues track events into the shared ingest pipeline (same path as
 *  the HTTP/WS/Kafka ingest). No AeroSwarm processing layer involved. */
export class AsterixUdpFeed {
  readonly state: UdpFeedState = {
    running: false,
    port: 0,
    packetsReceived: 0,
    packetsForwarded: 0,
    packetsRejected: 0,
    packetsSkipped: 0,
    packetsUndecoded: 0,
    lastError: null,
    lastDecoded: null,
  };

  private socket: Socket | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private readonly trackMap = new Map<string, TrackEntry>();
  private readonly opts: UdpFeedOptions;

  constructor(opts: UdpFeedOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.socket) return;

    const socket = createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;
    socket.on("message", (buf: Buffer) => this.processDatagram(buf));
    socket.on("error", (err) => {
      this.state.lastError = err.message;
      logger.warn({ err: err.message }, "asterix udp feed: socket error");
    });

    socket.bind(this.opts.port, this.opts.host ?? "0.0.0.0", () => {
      if (this.opts.multicastGroup) {
        try {
          socket.addMembership(
            this.opts.multicastGroup,
            this.opts.multicastIface || undefined,
          );
          logger.info(
            { group: this.opts.multicastGroup },
            "asterix udp feed: joined multicast group",
          );
        } catch (err) {
          logger.error(
            { err, group: this.opts.multicastGroup },
            "asterix udp feed: failed to join multicast group",
          );
        }
      }
      this.state.running = true;
      this.state.port = this.opts.port;
      this.sweepTimer = setInterval(
        () => this.sweepTrackMap(),
        TRACK_MAP_SWEEP_MS,
      );
      logger.info(
        {
          port: this.opts.port,
          multicast: this.opts.multicastGroup || "disabled",
          airport: this.opts.airportId ?? "unscoped",
          allowedCats: [...this.opts.allowedCats],
        },
        "asterix udp feed started",
      );
    });
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.state.running = false;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-category filtering + mapping branches mirror the proven AeroSwarm AsterixUdpService — splitting scatters the datagram lifecycle
  processDatagram(buf: Buffer): void {
    this.state.packetsReceived++;
    if (buf.length < 3) {
      this.state.packetsSkipped++;
      return;
    }

    try {
      const records = parseAsterix(
        buf,
        this.opts.forcedEditions &&
          Object.keys(this.opts.forcedEditions).length > 0
          ? this.opts.forcedEditions
          : undefined,
      );
      if (records.length === 0) {
        this.state.packetsUndecoded++;
        if (
          this.state.packetsUndecoded === 1 ||
          this.state.packetsUndecoded % 1000 === 0
        ) {
          logger.warn(
            {
              count: this.state.packetsUndecoded,
              cat: buf[0],
              len: buf.length,
              head: buf.subarray(0, 16).toString("hex"),
            },
            "asterix udp feed: packet parsed to zero records — no edition decoded it",
          );
        }
        return;
      }

      for (const rec of records) {
        // CAT23 = ground-station status, not a track — just log state changes.
        if (rec.category === 23) {
          const gs = rec.fields.gsStatus;
          if (gs) {
            const status = gs.nogo
              ? "offline"
              : gs.odp || gs.oxt || gs.tsv
                ? "degraded"
                : "healthy";
            logger.info(
              {
                sac: rec.fields.dataSource?.sac,
                sic: rec.fields.dataSource?.sic,
                status,
              },
              "asterix udp feed: ground station status",
            );
          }
          continue;
        }
        // CAT34/63 radar service messages + CAT19/247 system housekeeping —
        // expected traffic, not tracks.
        if (
          rec.category === 34 ||
          rec.category === 63 ||
          rec.category === 19 ||
          rec.category === 247
        )
          continue;
        if (!this.opts.allowedCats.has(rec.category)) {
          this.state.packetsSkipped++;
          continue;
        }

        const f = rec.fields;
        const event = this.toTrackEvent(rec.category, rec.edition, f);
        if (!event) {
          this.state.packetsSkipped++;
          continue;
        }

        enqueueTrackEvent(event, { awaitFlush: false });
        this.state.packetsForwarded++;
      }
    } catch (err) {
      this.state.packetsRejected++;
      this.state.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: identity keying, track-number recycling detection, and kinematics derivation form one decision chain — extracting steps obscures the flow
  private toTrackEvent(
    category: number,
    edition: string,
    f: AsterixFields,
  ): FusedTrackEventLike | null {
    const isSurface = category === 10 || category === 11;

    // Identity key: real icao24 when present; otherwise a synthetic id from the
    // sensor-recycled track-number namespace (v = surface CAT010/011,
    // t = CAT062 system track, r = radar/other airborne CAT048/020/021 —
    // e.g. SSR plots often carry no Mode-S address).
    let key = f.icao24;
    if (!key && f.trackNumber !== undefined) {
      const prefix = isSurface ? "v" : category === 62 ? "t" : "r";
      key = `${prefix}${f.dataSource?.sac ?? 0}-${f.dataSource?.sic ?? 0}-${f.trackNumber}`;
    }
    if (!key) return null;

    const pos = resolveAsterixPosition(f, this.opts.radarSite);
    if (!pos) return null;

    const now = Date.now();
    let prev = this.trackMap.get(key);
    // Synthetic track-number ids recycle fast — if the implied jump is too
    // fast for that target class, treat it as a new physical target.
    if (
      (key.startsWith("v") || key.startsWith("t") || key.startsWith("r")) &&
      prev?.lastPos
    ) {
      const dtS = (now - prev.lastPos.at) / 1000;
      if (dtS > 0.2) {
        const kx = 111320 * Math.cos((pos.lat * Math.PI) / 180);
        const dxM = (pos.lon - prev.lastPos.lon) * kx;
        const dyM = (pos.lat - prev.lastPos.lat) * 111320;
        const derivedKt = (Math.hypot(dxM, dyM) / dtS) * 1.94384;
        const maxPlausibleKt = key.startsWith("v") ? 100 : 700;
        if (derivedKt > maxPlausibleKt) prev = undefined;
      }
    }
    const trackId = prev?.trackId ?? `ast_${crypto.randomUUID()}`;

    let gs = f.velocity?.groundSpeedKt;
    let hdg = f.velocity?.headingDeg;
    if (gs !== undefined && (gs < 0 || gs > 1200)) gs = undefined;
    // No velocity item → derive from displacement, else keep last known.
    if ((gs === undefined || hdg === undefined) && prev?.lastPos) {
      const dtS = (now - prev.lastPos.at) / 1000;
      if (dtS > 0.2 && dtS < 30) {
        const kx = 111320 * Math.cos((pos.lat * Math.PI) / 180);
        const dxM = (pos.lon - prev.lastPos.lon) * kx;
        const dyM = (pos.lat - prev.lastPos.lat) * 111320;
        const distM = Math.hypot(dxM, dyM);
        const derivedKt = (distM / dtS) * 1.94384;
        if (distM > 2 && derivedKt <= 700) {
          if (hdg === undefined)
            hdg = ((Math.atan2(dxM, dyM) * 180) / Math.PI + 360) % 360;
          if (gs === undefined) gs = derivedKt;
        }
      }
    }
    if (gs === undefined) gs = prev?.lastVel?.gs ?? 0;
    if (hdg === undefined) hdg = prev?.lastVel?.hdg ?? 0;

    this.trackMap.set(key, {
      trackId,
      lastSeenAt: now,
      lastVel: { gs, hdg },
      lastPos: { lat: pos.lat, lon: pos.lon, at: now },
    });

    this.state.lastDecoded = {
      category,
      edition,
      icao24: key,
      lat: pos.lat,
      lon: pos.lon,
      at: now,
    };

    const protocol = `asterix-cat${String(category).padStart(3, "0")}`;

    return {
      trackId,
      fusedAt: now,
      airportId: this.opts.airportId,
      lifecycle: "updated",
      protocol,
      source: this.opts.sourceId,
      identity: {
        icao24: f.icao24 ?? key,
        callsign: f.callsign,
        squawk: f.squawk,
        targetType: isSurface
          ? (f.targetType ?? (f.icao24 ? "aircraft" : "unknown"))
          : "aircraft",
        ...(f.vehicleFleet !== undefined && { vehicleFleet: f.vehicleFleet }),
      },
      position: {
        lat: pos.lat,
        lon: pos.lon,
        alt: resolveAsterixAltitudeFt(f) ?? 0,
        onGround: isSurface,
      },
      velocity: { groundSpeed: gs, heading: hdg },
    };
  }

  /** Evict stale identities + emit a `dropped` lifecycle event so downstream
   *  consumers see the track end instead of it silently going stale. */
  private sweepTrackMap(): void {
    const cutoff = Date.now() - TRACK_MAP_TTL_MS;
    for (const [key, entry] of this.trackMap) {
      if (entry.lastSeenAt >= cutoff) continue;
      this.trackMap.delete(key);
      enqueueTrackEvent(
        {
          trackId: entry.trackId,
          fusedAt: Date.now(),
          airportId: this.opts.airportId,
          lifecycle: "dropped",
          source: this.opts.sourceId,
        },
        { awaitFlush: false },
      );
    }
  }
}

// ── Env-driven lifecycle (same opt-in posture as the kafka ingest consumer) ──

let feed: AsterixUdpFeed | null = null;

function parseCatList(raw: string | undefined): Set<number> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
}

/** "21:2.4,48:1.21" → { 21: "2.4", 48: "1.21" } */
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

export function getUdpFeedState(): UdpFeedState | null {
  return feed?.state ?? null;
}

/** No-op when AEROSWARM_FEED_UDP_PORT is unset — the HTTP/WS/Kafka ingest
 *  paths work independently of this feed. */
export function startUdpFeed(): void {
  const port = Number(process.env.AEROSWARM_FEED_UDP_PORT);
  if (!port || !Number.isInteger(port) || port < 1 || port > 65535) {
    logger.info("AEROSWARM_FEED_UDP_PORT not set — direct UDP feed disabled");
    return;
  }

  // Empty string must mean "unset" — Number("") is 0, which would silently
  // resolve every CAT048 target relative to 0°N 0°E (Gulf of Guinea).
  const radarLat = process.env.RADAR_SITE_LAT?.trim()
    ? Number(process.env.RADAR_SITE_LAT)
    : NaN;
  const radarLon = process.env.RADAR_SITE_LON?.trim()
    ? Number(process.env.RADAR_SITE_LON)
    : NaN;
  const radarSite =
    Number.isFinite(radarLat) && Number.isFinite(radarLon)
      ? { lat: radarLat, lon: radarLon }
      : null;
  if (!radarSite) {
    logger.warn(
      "RADAR_SITE_LAT/LON not set — CAT048 targets without lat/lon will be skipped",
    );
  }

  feed = new AsterixUdpFeed({
    port,
    host: process.env.AEROSWARM_FEED_UDP_HOST || undefined,
    sourceId: process.env.AEROSWARM_FEED_SOURCE_ID || "asterix-udp",
    airportId: process.env.AEROSWARM_AIRPORT_ID || undefined,
    allowedCats: parseCatList(
      process.env.ASTERIX_ALLOWED_CATS ?? "10,11,20,21,48,62",
    ),
    forcedEditions: parseForcedEditions(process.env.ASTERIX_FORCED_EDITIONS),
    multicastGroup: process.env.AEROSWARM_FEED_MULTICAST_GROUP,
    multicastIface: process.env.AEROSWARM_FEED_MULTICAST_IFACE,
    radarSite,
  });
  feed.start();
}

export function stopUdpFeed(): void {
  feed?.stop();
  feed = null;
}
