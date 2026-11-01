import type { CurrentTrack, FlightPhase } from "@aeroswarm/core/types";

export type MovementKind = "takeoff" | "landing";

/** Lepas landas = DEPARTURE, mendarat = ARRIVAL. */
const PHASE_OF: Readonly<Record<MovementKind, FlightPhase>> = {
  takeoff: "DEPARTURE",
  landing: "ARRIVAL",
};

export interface MovementPhaseStore {
  /** Catat takeoff/landing terakhir sebuah track. */
  set(trackId: string, kind: MovementKind): void;
  get(trackId: string): MovementKind | undefined;
  forget(trackId: string): void;
  readonly size: number;
  /**
   * Pasang fase hasil pergerakan ke track. Fase ini menang atas fase dari rencana penerbangan:
   * pesawat yang benar-benar lepas landas adalah DEPARTURE dan yang mendarat adalah ARRIVAL,
   * dengan atau tanpa pesan AFTN. Track tanpa pergerakan tidak diubah.
   *
   * Fase dititipkan di `flightPlan.phase` karena itu yang dibaca klien untuk warna label
   * (`@aeroswarm/client`). Tanpa rencana penerbangan dibuat ringkasan sintetis yang hanya
   * berisi id, status, dan fase. Fungsi panah supaya bisa dioper tanpa `this`.
   */
  readonly attach: (track: CurrentTrack) => CurrentTrack;
}

export function createMovementPhaseStore(): MovementPhaseStore {
  const kinds = new Map<string, MovementKind>();

  const attach = (track: CurrentTrack): CurrentTrack => {
    const kind = kinds.get(track.trackId);
    if (!kind) return track;

    const phase = PHASE_OF[kind];
    const plan = track.flightPlan;
    if (plan?.phase === phase) return track;

    return {
      ...track,
      flightPlan: plan
        ? { ...plan, phase }
        : {
            id: `movement:${track.trackId}`,
            status: kind === "takeoff" ? "departed" : "arrived",
            phase,
          },
    };
  };

  return {
    set: (trackId: string, kind: MovementKind): void => {
      kinds.set(trackId, kind);
    },
    get: (trackId: string): MovementKind | undefined => kinds.get(trackId),
    forget: (trackId: string): void => {
      kinds.delete(trackId);
    },
    get size(): number {
      return kinds.size;
    },
    attach,
  };
}
