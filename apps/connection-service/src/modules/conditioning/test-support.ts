import type { FusedTrackEvent } from "@aeroswarm/core";

const M_PER_DEG = 111_320;
const ORIGIN = { lat: -7.376, lon: 112.795 };

/** Titik `northM` ke utara dan `eastM` ke timur dari titik acuan (apron Juanda). */
export const offset = (
  northM: number,
  eastM: number,
): { lat: number; lon: number } => ({
  lat: ORIGIN.lat + northM / M_PER_DEG,
  lon:
    ORIGIN.lon + eastM / (M_PER_DEG * Math.cos((ORIGIN.lat * Math.PI) / 180)),
});

export interface EventInit {
  trackId: string;
  icao24?: string;
  callsign?: string;
  north?: number;
  east?: number;
  groundSpeed?: number;
  heading?: number;
  onGround?: boolean;
  protocol?: FusedTrackEvent["protocol"];
  sac?: number;
  sic?: number;
  lifecycle?: FusedTrackEvent["lifecycle"];
}

export function track(init: EventInit): FusedTrackEvent {
  const pos = offset(init.north ?? 0, init.east ?? 0);
  return {
    trackId: init.trackId,
    sources: ["asterix-udp"],
    airportId: "WARR",
    identity: {
      icao24: init.icao24 ?? init.trackId,
      ...(init.callsign ? { callsign: init.callsign } : {}),
    },
    protocol: init.protocol ?? "asterix-cat020",
    dataSource: { sac: init.sac ?? 1, sic: init.sic ?? 1 },
    position: { ...pos, onGround: init.onGround ?? true },
    velocity: {
      groundSpeed: init.groundSpeed ?? 0,
      heading: init.heading ?? 0,
    },
    confidence: {
      overall: 1,
      position: 1,
      identity: 1,
      velocity: 1,
      sourceAgreement: 1,
      spoofRisk: 0,
    },
    fusedAt: 0,
    updatedAt: 0,
    lifecycle: init.lifecycle ?? "updated",
  };
}

/** Jam yang bisa digeser, supaya tes tidak bergantung pada waktu sungguhan. */
export function clock(start = 1_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number): void => {
      t += ms;
    },
  };
}
