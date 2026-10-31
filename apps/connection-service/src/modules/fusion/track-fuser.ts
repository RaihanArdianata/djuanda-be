import type { FusedTrackEvent } from "@aeroswarm/core";

/**
 * Several sensors (radar, MLAT, ...) often see the same aircraft. Each feed
 * produces its own track id, so without this layer they replace one another
 * on every update. The fuser keeps ONE canonical track per aircraft and picks
 * which sensor's position to show.
 *
 *   feed events ──► fuser.ingest ──► one event per aircraft ──► storage, live picture
 *
 * Matching: by Mode-S address when both have one. Tracks without it (surface
 * vehicles, SSR-only radar: ids like "r50-176-42") only match across sensors
 * when `spatial` is on, by position and time.
 */

export interface FusionOptions {
  /** Preferred sources while the aircraft is on the ground, best first. Each entry is a protocol ("asterix-cat010") or a source id. */
  surfacePriority: string[];
  /** Same, for an aircraft in the air. */
  airbornePriority: string[];
  /** A sensor silent for longer than this stops competing for the position. */
  maxSourceAgeMs: number;
  /** A sensor's contribution is forgotten after this long without an update. */
  forgetAfterMs: number;
  /** Also match tracks that share no Mode-S address, by distance and time. */
  spatial: boolean;
  matchRadiusM: number;
  matchMaxSkewMs: number;
  /** Two sensors further apart than this are reported as disagreeing. */
  disagreeM: number;
  now?: () => number;
}

export interface FusionStats {
  /** Canonical tracks held. */
  aircraft: number;
  /** Of those, how many are fed by more than one sensor right now. */
  merged: number;
  /** Tracks joined by position because they shared no id. */
  spatialMatches: number;
  /** New tracks with several possible partners, left unmerged. */
  ambiguous: number;
  /** Emitted updates where the sensors were further apart than `disagreeM`. */
  disagreements: number;
}

export interface TrackFuser {
  /** The event to store and show, or null when it adds nothing new. */
  ingest(event: FusedTrackEvent): FusedTrackEvent | null;
  /** Forget a canonical track, e.g. when the live picture removed it. */
  forget(trackId: string): void;
  /** Drop sensors that went silent and tracks with none left. */
  sweep(): void;
  stats(): FusionStats;
}

const SYNTHETIC_ID = /^[rtv]\d+-\d+-\d+$/;
const EARTH_M = 6_371_000;

/** Ids the ingest package builds from sensor + track number when there is no Mode-S address. */
export const isSyntheticId = (icao24: string): boolean =>
  SYNTHETIC_ID.test(icao24);

interface LatLon {
  lat: number;
  lon: number;
}

export function distanceM(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface Contribution {
  event: FusedTrackEvent;
  sourceId: string;
  /** When we received it. */
  at: number;
}

interface Entry {
  id: string;
  keys: Set<string>;
  contributions: Map<string, Contribution>;
  realIcao24: string | null;
  lastPrimary: string;
  lastSources: string;
}

const sourceOf = (event: FusedTrackEvent): string => event.sources[0];

const keyFor = (event: FusedTrackEvent): string => {
  const icao24 = event.identity.icao24;
  return isSyntheticId(icao24)
    ? `s:${sourceOf(event)}:${icao24}`
    : `m:${icao24}`;
};

function rank(list: readonly string[], event: FusedTrackEvent): number {
  const idx = list.findIndex(
    (s) => s === event.protocol || s === sourceOf(event),
  );
  return idx < 0 ? list.length : idx;
}

/** Best sensor first; the more recent one wins a tie. */
function pickPrimary(
  fresh: Contribution[],
  list: readonly string[],
): Contribution | null {
  const sorted = [...fresh].sort(
    (a, b) => rank(list, a.event) - rank(list, b.event) || b.at - a.at,
  );
  return sorted[0] ?? null;
}

function mergeIdentity(
  primary: Contribution,
  others: Contribution[],
): FusedTrackEvent["identity"] {
  const out = { ...primary.event.identity };
  for (const other of others) {
    const id = other.event.identity;
    out.callsign ??= id.callsign;
    out.squawk ??= id.squawk;
    out.targetType ??= id.targetType;
    out.vehicleFleet ??= id.vehicleFleet;
    if (isSyntheticId(out.icao24) && !isSyntheticId(id.icao24)) {
      out.icao24 = id.icao24;
    }
  }
  return out;
}

/** Furthest another sensor's position is from the primary's, in metres. */
function maxSpreadM(primary: Contribution, others: Contribution[]): number {
  const base = primary.event.position;
  if (!base) return 0;
  let max = 0;
  for (const other of others) {
    const pos = other.event.position;
    if (pos) max = Math.max(max, distanceM(base, pos));
  }
  return max;
}

class Fuser implements TrackFuser {
  private readonly opts: FusionOptions;
  private readonly now: () => number;
  private readonly byKey = new Map<string, Entry>();
  private readonly byId = new Map<string, Entry>();
  private spatialMatches = 0;
  private ambiguous = 0;
  private disagreements = 0;

  constructor(opts: FusionOptions) {
    this.opts = opts;
    this.now = opts.now ?? ((): number => Date.now());
  }

  ingest(event: FusedTrackEvent): FusedTrackEvent | null {
    const now = this.now();
    const src = sourceOf(event);
    const key = keyFor(event);
    const known = this.byKey.get(key);
    if (event.lifecycle === "dropped") return this.drop(known, event, src, now);

    const entry =
      known ?? this.matchSpatially(event, src, now) ?? this.create(event);
    this.link(entry, key, event);
    entry.contributions.set(src, { event, sourceId: src, at: now });
    return this.output(entry, src, now, false);
  }

  forget(trackId: string): void {
    const entry = this.byId.get(trackId);
    if (entry) this.remove(entry);
  }

  sweep(): void {
    const now = this.now();
    for (const entry of [...this.byId.values()]) {
      for (const [src, c] of entry.contributions) {
        if (now - c.at > this.opts.forgetAfterMs)
          entry.contributions.delete(src);
      }
      if (entry.contributions.size === 0) this.remove(entry);
    }
  }

  stats(): FusionStats {
    const now = this.now();
    let merged = 0;
    for (const entry of this.byId.values()) {
      if (this.fresh(entry, now).length > 1) merged++;
    }
    return {
      aircraft: this.byId.size,
      merged,
      spatialMatches: this.spatialMatches,
      ambiguous: this.ambiguous,
      disagreements: this.disagreements,
    };
  }

  private fresh(entry: Entry, now: number): Contribution[] {
    return [...entry.contributions.values()].filter(
      (c) => now - c.at <= this.opts.maxSourceAgeMs,
    );
  }

  private create(event: FusedTrackEvent): Entry {
    const entry: Entry = {
      id: event.trackId,
      keys: new Set(),
      contributions: new Map(),
      realIcao24: null,
      lastPrimary: "",
      lastSources: "",
    };
    this.byId.set(entry.id, entry);
    return entry;
  }

  private link(entry: Entry, key: string, event: FusedTrackEvent): void {
    entry.keys.add(key);
    this.byKey.set(key, entry);
    if (!isSyntheticId(event.identity.icao24)) {
      entry.realIcao24 = event.identity.icao24;
    }
  }

  private remove(entry: Entry): void {
    for (const key of entry.keys) this.byKey.delete(key);
    this.byId.delete(entry.id);
  }

  private drop(
    entry: Entry | undefined,
    event: FusedTrackEvent,
    src: string,
    now: number,
  ): FusedTrackEvent | null {
    if (!entry) return event;
    entry.contributions.delete(src);
    if (entry.contributions.size > 0) return this.output(entry, src, now, true);
    this.remove(entry);
    return { ...event, trackId: entry.id };
  }

  /** The partner for a track nobody else shares an id with, or null. */
  private matchSpatially(
    event: FusedTrackEvent,
    src: string,
    now: number,
  ): Entry | null {
    const pos = event.position;
    if (!this.opts.spatial || !pos) return null;
    const hasMode = !isSyntheticId(event.identity.icao24);
    const found: Entry[] = [];
    for (const entry of this.byId.values()) {
      // Never merge two different Mode-S addresses, nor one sensor with itself.
      if (entry.contributions.has(src) || (hasMode && entry.realIcao24))
        continue;
      if (this.isNear(entry, pos, now)) found.push(entry);
    }
    if (found.length > 1) this.ambiguous++;
    if (found.length !== 1) return null;
    this.spatialMatches++;
    return found[0] ?? null;
  }

  private isNear(entry: Entry, pos: LatLon, now: number): boolean {
    for (const c of entry.contributions.values()) {
      const other = c.event.position;
      if (!other || now - c.at > this.opts.matchMaxSkewMs) continue;
      if (distanceM(pos, other) <= this.opts.matchRadiusM) return true;
    }
    return false;
  }

  /**
   * The event for the aircraft as it stands now. Null when `src` is not the
   * sensor being shown and nothing else changed, so a lower-priority sensor
   * does not make the picture jump.
   */
  private output(
    entry: Entry,
    src: string,
    now: number,
    force: boolean,
  ): FusedTrackEvent | null {
    const fresh = this.fresh(entry, now);
    const onGround = fresh.some((c) => c.event.position?.onGround === true);
    const list = onGround
      ? this.opts.surfacePriority
      : this.opts.airbornePriority;
    const primary = pickPrimary(fresh, list);
    if (!primary) return null;

    const sources = fresh
      .map((c) => c.sourceId)
      .sort()
      .join(",");
    const changed =
      force ||
      primary.sourceId === src ||
      primary.sourceId !== entry.lastPrimary ||
      sources !== entry.lastSources;
    entry.lastPrimary = primary.sourceId;
    entry.lastSources = sources;
    return changed ? this.build(entry, primary, fresh) : null;
  }

  private build(
    entry: Entry,
    primary: Contribution,
    fresh: Contribution[],
  ): FusedTrackEvent {
    const others = fresh
      .filter((c) => c !== primary)
      .sort((a, b) => b.at - a.at);
    const { event } = primary;
    const out: FusedTrackEvent = {
      ...event,
      trackId: entry.id,
      sources: [primary.sourceId, ...others.map((c) => c.sourceId)],
      identity: mergeIdentity(primary, others),
      lifecycle: others.length > 0 ? "merged" : event.lifecycle,
    };
    const velocity =
      event.velocity ?? others.find((c) => c.event.velocity)?.event.velocity;
    if (velocity) out.velocity = velocity;
    if (others.length > 0) this.scoreAgreement(out, primary, others);
    return out;
  }

  private scoreAgreement(
    out: FusedTrackEvent,
    primary: Contribution,
    others: Contribution[],
  ): void {
    const spread = maxSpreadM(primary, others);
    if (spread > this.opts.disagreeM) this.disagreements++;
    out.confidence = {
      ...out.confidence,
      sourceAgreement: Math.max(0, 1 - spread / this.opts.disagreeM),
    };
  }
}

export function createTrackFuser(opts: FusionOptions): TrackFuser {
  return new Fuser(opts);
}
