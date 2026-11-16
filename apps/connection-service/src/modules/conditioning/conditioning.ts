import type { FusedTrackEvent } from "@aeroswarm/core";
import type { ConditioningConfig } from "./conditioning-config";
import {
  createGhostFilter,
  type GhostFilter,
  type GhostStats,
} from "./ghost-filter";
import {
  createMlatValidator,
  type MlatValidator,
  type MlatValidatorStats,
} from "./mlat-validator";
import {
  createTrackStabilizer,
  type StabilizerStats,
  type TrackStabilizer,
} from "./track-stabilizer";

export interface Conditioning {
  /** Sebelum fusi. `event` null = jangan diteruskan; `reason` menjelaskan untuk catatan penelusuran. */
  admit(event: FusedTrackEvent): {
    event: FusedTrackEvent | null;
    reason?: string;
  };
  /** Sesudah fusi. Menstabilkan posisi dan arah target di permukaan; event lain dikembalikan apa adanya. */
  stabilize(event: FusedTrackEvent): FusedTrackEvent;
  /** Track dihapus dari gambaran udara. */
  forget(trackId: string): void;
  sweep(): void;
  stats(): {
    ghost: GhostStats | null;
    stabilizer: StabilizerStats | null;
    mlat: MlatValidatorStats | null;
  };
}

export function createConditioning(config: ConditioningConfig): Conditioning {
  const ghost: GhostFilter | null = config.ghost.enabled
    ? createGhostFilter(config.ghost.options)
    : null;
  const stabilizer: TrackStabilizer | null = config.stabilizer.enabled
    ? createTrackStabilizer(config.stabilizer.options)
    : null;
  const mlat: MlatValidator | null = config.mlat?.enabled
    ? createMlatValidator(config.mlat.options)
    : null;

  return {
    admit(event: FusedTrackEvent): {
      event: FusedTrackEvent | null;
      reason?: string;
    } {
      if (ghost) {
        const verdict = ghost.check(event);
        switch (verdict.action) {
          case "pass":
            break;
          case "retract":
            // Sempat tampil, ternyata bayangan: teruskan sebagai `dropped` sekali supaya hilang dari peta.
            return {
              event: { ...event, lifecycle: "dropped" },
              reason: "bayangan: ditarik dari gambaran udara",
            };
          case "hold":
            return {
              event: null,
              reason:
                verdict.reason === "baru"
                  ? "target tanpa identitas, menunggu laporan berikutnya"
                  : "bayangan target lain dari sensor yang sama",
            };
        }
      }

      if (mlat) {
        const verdict = mlat.check(event);
        switch (verdict.action) {
          case "pass":
            break;
          case "retract":
            return {
              event: { ...event, lifecycle: "dropped" },
              reason: `mlat-unreliable: ${verdict.reason}`,
            };
          case "hold":
            return {
              event: null,
              reason: `mlat-unreliable: ${verdict.reason}`,
            };
        }
      }

      return { event };
    },

    stabilize(event: FusedTrackEvent): FusedTrackEvent {
      return stabilizer ? stabilizer.apply(event) : event;
    },

    forget(trackId: string): void {
      ghost?.forget(trackId);
      stabilizer?.forget(trackId);
      mlat?.forget(trackId);
    },

    sweep(): void {
      ghost?.sweep();
      stabilizer?.sweep();
      mlat?.sweep();
    },

    stats(): {
      ghost: GhostStats | null;
      stabilizer: StabilizerStats | null;
      mlat: MlatValidatorStats | null;
    } {
      return {
        ghost: ghost?.stats() ?? null,
        stabilizer: stabilizer?.stats() ?? null,
        mlat: mlat?.stats() ?? null,
      };
    },
  };
}
