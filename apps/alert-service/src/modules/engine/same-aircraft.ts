import type { MovementTrack } from "./types";

/**
 * One aircraft, one track.
 *
 * Radar, ADS-B and MLAT each see the same aircraft. When they are not fused into a single track (a sensor without the
 * Mode-S address, a feed that is not fused at all), the picture holds two or three tracks of one aircraft. The rules
 * compare tracks with each other, so BTK241 seen by MLAT on the runway and again by ADS-B on the same runway is read as a
 * second aircraft entering: a runway incursion against itself, and the same for taxiway, area and separation alerts and for
 * the occupancy count.
 *
 * Before the rules run, the tracks of one aircraft are reduced to one:
 *  - by name: the same callsign (or, without one, the same registration) is the same aircraft;
 *  - by place: a track with no name that sits on top of a named track of the same kind, moving the same way, is that track
 *    seen by a sensor that does not carry the name.
 *
 * The track kept for an aircraft is remembered and kept for as long as it is still there. An alert is identified by its track,
 * so a choice that flipped with every update would end the alert and start another one: one occurrence has to stay one alert.
 */

export interface SameAircraftOptions {
  /** A nameless track this close (metres) to a named one of the same kind is the same aircraft. 0 = never judge by place. */
  twinRadiusM: number;
  /** ...and its ground speed may differ by at most this (knots), when both are known. */
  twinMaxSpeedDiffKt: number;
}

export const DEFAULT_SAME_AIRCRAFT: SameAircraftOptions = {
  twinRadiusM: 60,
  twinMaxSpeedDiffKt: 15,
};

export function sameAircraftFromEnv(
  env: Record<string, string | undefined>,
): SameAircraftOptions {
  const number = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return raw !== undefined &&
      raw.trim() !== "" &&
      Number.isFinite(n) &&
      n >= 0
      ? n
      : fallback;
  };
  return {
    twinRadiusM: number(
      env.ALERT_TWIN_RADIUS_M,
      DEFAULT_SAME_AIRCRAFT.twinRadiusM,
    ),
    twinMaxSpeedDiffKt: number(
      env.ALERT_TWIN_MAX_SPEED_DIFF_KT,
      DEFAULT_SAME_AIRCRAFT.twinMaxSpeedDiffKt,
    ),
  };
}

/**
 * The name of an aircraft as a comparable key, or null when it has none. Callsigns are written with and without a zero
 * after the airline (BTK0241 and BTK241 are one flight), with spaces and dashes in places.
 */
export function aircraftKey(
  track: Pick<MovementTrack, "callsign" | "registration">,
): string | null {
  const callsign = normalise(track.callsign);
  if (callsign) return `cs:${callsign.replace(/^([A-Z]{3})0+(?=\d)/, "$1")}`;
  const registration = normalise(track.registration);
  return registration ? `reg:${registration}` : null;
}

function normalise(value: string | undefined): string {
  return (value ?? "").toUpperCase().replace(/[\s-]+/g, "");
}

const METRES_PER_DEGREE = 111_320;

/** Distance in metres between two positions, flat-earth: exact enough for tens of metres. */
function distanceM(a: MovementTrack, b: MovementTrack): number {
  const dy = (a.latitude - b.latitude) * METRES_PER_DEGREE;
  const dx =
    (a.longitude - b.longitude) *
    METRES_PER_DEGREE *
    Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

const kindOf = (track: MovementTrack): string =>
  String(track.targetType ?? "").toUpperCase();

/** The named tracks grouped by the aircraft they name. */
function groupByName(tracks: MovementTrack[]): Map<string, MovementTrack[]> {
  const groups = new Map<string, MovementTrack[]>();
  for (const track of tracks) {
    const key = aircraftKey(track);
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), track]);
  }
  return groups;
}

export interface SameAircraftFilter {
  /** The tracks with every aircraft counted once. The order of what is kept is the order given. */
  apply(airportId: string, tracks: MovementTrack[]): MovementTrack[];
  /** How many tracks were dropped as duplicates since the start. */
  readonly merged: number;
}

export function createSameAircraftFilter(
  options: SameAircraftOptions = DEFAULT_SAME_AIRCRAFT,
): SameAircraftFilter {
  /** `airport|aircraft key` -> the track id kept for it. */
  const chosen = new Map<string, string>();
  let merged = 0;

  function pick(
    airportId: string,
    key: string,
    group: MovementTrack[],
  ): MovementTrack {
    const stickyId = chosen.get(`${airportId}|${key}`);
    const sticky = group.find((t) => t.trackId === stickyId);
    if (sticky) return sticky;
    // Nothing remembered (or it is gone): the freshest, and the lowest id among equals so the choice does not depend on order.
    const best = [...group].sort(
      (a, b) =>
        b.timestamp.getTime() - a.timestamp.getTime() ||
        (a.trackId < b.trackId ? -1 : 1),
    )[0] as MovementTrack;
    chosen.set(`${airportId}|${key}`, best.trackId);
    return best;
  }

  function isTwinByPlace(
    nameless: MovementTrack,
    named: MovementTrack,
  ): boolean {
    if (options.twinRadiusM <= 0) return false;
    if (kindOf(nameless) !== kindOf(named)) return false;
    if (distanceM(nameless, named) > options.twinRadiusM) return false;
    const a = nameless.groundSpeed;
    const b = named.groundSpeed;
    return (
      a === undefined ||
      b === undefined ||
      Math.abs(a - b) <= options.twinMaxSpeedDiffKt
    );
  }

  /** Forget the track kept for a name that is no longer in the picture. */
  function forgetGone(
    airportId: string,
    names: Map<string, MovementTrack[]>,
  ): void {
    const prefix = `${airportId}|`;
    for (const entry of chosen.keys()) {
      if (entry.startsWith(prefix) && !names.has(entry.slice(prefix.length)))
        chosen.delete(entry);
    }
  }

  /** The tracks of aircraft that have several, minus the one kept for each. */
  function dropSameName(
    airportId: string,
    tracks: MovementTrack[],
  ): Set<MovementTrack> {
    const names = groupByName(tracks);
    const dropped = new Set<MovementTrack>();
    for (const [key, group] of names) {
      if (group.length === 1) continue;
      const keep = pick(airportId, key, group);
      for (const track of group) if (track !== keep) dropped.add(track);
    }
    forgetGone(airportId, names);
    return dropped;
  }

  return {
    get merged(): number {
      return merged;
    },
    apply(airportId: string, tracks: MovementTrack[]): MovementTrack[] {
      const dropped = dropSameName(airportId, tracks);
      // A nameless track is judged against the named ones only: two nameless vehicles side by side are two vehicles.
      const named = tracks.filter(
        (t) => aircraftKey(t) !== null && !dropped.has(t),
      );
      const keep = new Set(named);
      for (const track of tracks) {
        if (
          aircraftKey(track) === null &&
          !named.some((n) => isTwinByPlace(track, n))
        )
          keep.add(track);
      }
      merged += tracks.length - keep.size;
      return tracks.filter((t) => keep.has(t));
    },
  };
}
