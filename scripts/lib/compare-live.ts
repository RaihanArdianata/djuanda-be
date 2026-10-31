/**
 * Pure logic for scripts/compare-live.ts: compares two live track pictures
 * (e.g. AeroSwarm vs the new connection-service) sample by sample.
 */

export interface LiveTrack {
  trackId: string;
  icao24: string | null;
  callsign: string | null;
  lat: number | null;
  lon: number | null;
  status: string;
  lastSeenAt: number;
  flightPlan?: { phase?: string };
}

/** Latest known track per identity key. */
export type TrackMap = Map<string, LiveTrack>;

/** Track ids differ between systems, so match on what identifies the aircraft. */
export function keyOf(t: LiveTrack): string {
  return (
    t.icao24?.trim().toLowerCase() ||
    t.callsign?.trim().toUpperCase() ||
    t.trackId
  );
}

const EARTH_M = 6_371_000;

export function distanceM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, idx)] ?? 0;
}

export interface SampleDiff {
  onlyA: string[];
  onlyB: string[];
  both: number;
  /** Metres between the two systems' positions for the same aircraft. */
  distancesM: number[];
  statusMismatch: string[];
  phaseMismatch: string[];
}

/** Two reports further apart in time than this are not comparable for position. */
const MAX_SKEW_MS = 5_000;

function comparePair(
  key: string,
  a: LiveTrack,
  b: LiveTrack,
  out: SampleDiff,
): void {
  const comparable = Math.abs(a.lastSeenAt - b.lastSeenAt) <= MAX_SKEW_MS;
  if (
    comparable &&
    a.lat != null &&
    a.lon != null &&
    b.lat != null &&
    b.lon != null
  ) {
    out.distancesM.push(
      distanceM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }),
    );
  }
  if (comparable && a.status !== b.status) out.statusMismatch.push(key);
  if ((a.flightPlan?.phase ?? "NONE") !== (b.flightPlan?.phase ?? "NONE")) {
    out.phaseMismatch.push(key);
  }
}

export function diffMaps(a: TrackMap, b: TrackMap): SampleDiff {
  const out: SampleDiff = {
    onlyA: [],
    onlyB: [],
    both: 0,
    distancesM: [],
    statusMismatch: [],
    phaseMismatch: [],
  };
  for (const [key, ta] of a) {
    const tb = b.get(key);
    if (!tb) {
      out.onlyA.push(key);
      continue;
    }
    out.both++;
    comparePair(key, ta, tb, out);
  }
  for (const key of b.keys()) if (!a.has(key)) out.onlyB.push(key);
  return out;
}

export interface Report {
  samples: number;
  avgA: number;
  avgB: number;
  avgBoth: number;
  /** Share of all distinct aircraft that one system had and the other lacked. */
  onlyOneRate: number;
  distanceP50M: number;
  distanceP95M: number;
  distanceMaxM: number;
  statusMismatchRate: number;
  phaseMismatchRate: number;
  /** Aircraft most often present in only one system. */
  topOnlyA: Array<[string, number]>;
  topOnlyB: Array<[string, number]>;
  topPhaseMismatch: Array<[string, number]>;
}

const top = (m: Map<string, number>, n = 5): Array<[string, number]> =>
  [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n);

const bump = (m: Map<string, number>, keys: string[]): void => {
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
};

export class Accumulator {
  private samples = 0;
  private sumA = 0;
  private sumB = 0;
  private sumBoth = 0;
  private sumOnly = 0;
  private sumUnion = 0;
  private sumStatusMismatch = 0;
  private sumPhaseMismatch = 0;
  private distances: number[] = [];
  private onlyA = new Map<string, number>();
  private onlyB = new Map<string, number>();
  private phase = new Map<string, number>();

  add(d: SampleDiff): void {
    this.samples++;
    this.sumA += d.onlyA.length + d.both;
    this.sumB += d.onlyB.length + d.both;
    this.sumBoth += d.both;
    this.sumOnly += d.onlyA.length + d.onlyB.length;
    this.sumUnion += d.onlyA.length + d.onlyB.length + d.both;
    this.sumStatusMismatch += d.statusMismatch.length;
    this.sumPhaseMismatch += d.phaseMismatch.length;
    this.distances.push(...d.distancesM);
    bump(this.onlyA, d.onlyA);
    bump(this.onlyB, d.onlyB);
    bump(this.phase, d.phaseMismatch);
  }

  report(): Report {
    const sorted = [...this.distances].sort((x, y) => x - y);
    const n = Math.max(1, this.samples);
    return {
      samples: this.samples,
      avgA: this.sumA / n,
      avgB: this.sumB / n,
      avgBoth: this.sumBoth / n,
      onlyOneRate: this.sumUnion === 0 ? 0 : this.sumOnly / this.sumUnion,
      distanceP50M: percentile(sorted, 50),
      distanceP95M: percentile(sorted, 95),
      distanceMaxM: sorted.at(-1) ?? 0,
      statusMismatchRate:
        this.sumBoth === 0 ? 0 : this.sumStatusMismatch / this.sumBoth,
      phaseMismatchRate:
        this.sumBoth === 0 ? 0 : this.sumPhaseMismatch / this.sumBoth,
      topOnlyA: top(this.onlyA),
      topOnlyB: top(this.onlyB),
      topPhaseMismatch: top(this.phase),
    };
  }
}

export interface Thresholds {
  maxOnlyOneRate: number;
  maxDistanceP95M: number;
  maxStatusMismatchRate: number;
  maxPhaseMismatchRate: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  maxOnlyOneRate: 0.05,
  maxDistanceP95M: 100,
  maxStatusMismatchRate: 0.05,
  maxPhaseMismatchRate: 0.02,
};

export function verdict(
  r: Report,
  t: Thresholds = DEFAULT_THRESHOLDS,
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (r.samples === 0) failures.push("no samples were collected");
  if (r.onlyOneRate > t.maxOnlyOneRate) {
    failures.push(
      `aircraft present in only one system: ${pct(r.onlyOneRate)} > ${pct(t.maxOnlyOneRate)}`,
    );
  }
  if (r.distanceP95M > t.maxDistanceP95M) {
    failures.push(
      `position p95 ${r.distanceP95M.toFixed(0)} m > ${t.maxDistanceP95M} m`,
    );
  }
  if (r.statusMismatchRate > t.maxStatusMismatchRate) {
    failures.push(
      `status mismatch ${pct(r.statusMismatchRate)} > ${pct(t.maxStatusMismatchRate)}`,
    );
  }
  if (r.phaseMismatchRate > t.maxPhaseMismatchRate) {
    failures.push(
      `flight-plan phase mismatch ${pct(r.phaseMismatchRate)} > ${pct(t.maxPhaseMismatchRate)}`,
    );
  }
  return { ok: failures.length === 0, failures };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function formatReport(r: Report): string {
  const list = (e: Array<[string, number]>): string =>
    e.length === 0 ? "-" : e.map(([k, n]) => `${k} (${n})`).join(", ");
  return [
    `samples                 ${r.samples}`,
    `avg tracks  A / B / both ${r.avgA.toFixed(1)} / ${r.avgB.toFixed(1)} / ${r.avgBoth.toFixed(1)}`,
    `only in one system      ${pct(r.onlyOneRate)}`,
    `position diff           p50 ${r.distanceP50M.toFixed(0)} m, p95 ${r.distanceP95M.toFixed(0)} m, max ${r.distanceMaxM.toFixed(0)} m`,
    `status mismatch         ${pct(r.statusMismatchRate)}`,
    `flight-plan phase diff  ${pct(r.phaseMismatchRate)}`,
    `most often only in A    ${list(r.topOnlyA)}`,
    `most often only in B    ${list(r.topOnlyB)}`,
    `phase differs for       ${list(r.topPhaseMismatch)}`,
  ].join("\n");
}
