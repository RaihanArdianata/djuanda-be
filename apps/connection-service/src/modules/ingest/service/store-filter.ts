/**
 * Which track updates are worth a row in the database.
 *
 * Every sensor that sees an aircraft sends its own updates, so a fused track can change several times a second, while
 * the history, the trail and the replay need about one position a second. Writing them all multiplies the rows (and the
 * indexes) without adding anything. A track is stored when it is new, when something that matters changed, or when
 * `minIntervalMs` has passed since the last row stored for it.
 *
 * Only the storage is thinned. The realtime picture and the alert pipeline still get every update.
 */

export interface StoreCandidate {
  trackId: string;
  fusedAt: number;
  lifecycle?: string;
  identity?: { callsign?: string; targetType?: string };
  position?: { onGround?: boolean };
}

export interface StoreFilterOptions {
  /** Least time between two stored rows of one track. 0 = store everything (the filter is off). */
  minIntervalMs: number;
  /** Tracks remembered before the oldest ones are forgotten. A track not seen for `forgetAfterMs` is dropped from memory. */
  forgetAfterMs?: number;
}

interface LastStored {
  at: number;
  lifecycle?: string;
  callsign?: string;
  targetType?: string;
  onGround?: boolean;
}

export interface StoreFilter {
  /** True when this update should be written; records it as the last one stored for its track. */
  shouldStore(event: StoreCandidate): boolean;
  /** Tracks currently remembered. */
  readonly size: number;
}

const SWEEP_EVERY = 5_000;

/** Something that matters changed since the last row stored: it is a new track, or its lifecycle, name, kind or ground state differ. */
function changedSince(
  state: LastStored | undefined,
  event: StoreCandidate,
): boolean {
  if (state === undefined || event.lifecycle !== state.lifecycle) return true;
  // A field the update does not carry is no change: a sensor without callsign or ground bit must not make every update look new.
  const { callsign, targetType } = event.identity ?? {};
  const onGround = event.position?.onGround;
  return (
    (callsign !== undefined && callsign !== state.callsign) ||
    (targetType !== undefined && targetType !== state.targetType) ||
    (onGround !== undefined && onGround !== state.onGround)
  );
}

export function createStoreFilter(options: StoreFilterOptions): StoreFilter {
  const { minIntervalMs } = options;
  const forgetAfterMs = options.forgetAfterMs ?? 10 * 60_000;
  const last = new Map<string, LastStored>();
  let calls = 0;

  function sweep(now: number): void {
    for (const [trackId, state] of last) {
      if (now - state.at > forgetAfterMs) last.delete(trackId);
    }
  }

  return {
    get size(): number {
      return last.size;
    },
    shouldStore(event: StoreCandidate): boolean {
      if (minIntervalMs <= 0) return true;

      // A dropped track is stored (it ends the history) and forgotten.
      if (event.lifecycle === "dropped") {
        last.delete(event.trackId);
        return true;
      }

      const state = last.get(event.trackId);
      // `fusedAt` going backwards (a clock step, an out-of-order batch) never counts as "an interval has passed".
      const due =
        state !== undefined && event.fusedAt - state.at >= minIntervalMs;
      if (!due && !changedSince(state, event)) return false;

      last.set(event.trackId, {
        at: event.fusedAt,
        lifecycle: event.lifecycle,
        callsign: event.identity?.callsign ?? state?.callsign,
        targetType: event.identity?.targetType ?? state?.targetType,
        onGround: event.position?.onGround ?? state?.onGround,
      });
      if (++calls % SWEEP_EVERY === 0) sweep(event.fusedAt);
      return true;
    },
  };
}
