import type { FusedTrackEvent } from "@aeroswarm/core";
import type { CurrentTrack } from "@aeroswarm/core/types";

/** Di bawah ketinggian ini dan di bawah kecepatan taksi, target dianggap di darat (sama dengan detektor takeoff/landing). */
export const SURFACE_MAX_ALT_FT = 100;
/** Pesawat yang lebih cepat dari ini tidak sedang taksi atau parkir. */
export const SURFACE_MAX_SPEED_KT = 40;
/** Tanpa flag dari feed, di atas ketinggian ini target jelas di udara (sama dengan aturan alert). */
export const AIRBORNE_MIN_ALT_FT = 500;

/** Track dengan status darat/udara yang sudah dinormalkan; field ikut ke klien. */
export type TrackWithSurface = CurrentTrack & { onGround?: boolean };

/**
 * Satu keputusan "di darat atau di udara" untuk semua pemakai (peta, alert, statistik).
 *
 * Flag `onGround` dari feed tidak bisa dipercaya sendirian: target taksi kadang ditandai
 * `false` (mis. MLAT tanpa penanda surface), sehingga alert menganggapnya terbang. Aturannya:
 *  - kendaraan selalu di darat;
 *  - flag `true` dipercaya;
 *  - rendah (<= 100 ft) dan lambat (< 40 kt) berarti di darat walaupun flag `false`;
 *  - flag `false` selain itu dipercaya;
 *  - tanpa flag: di atas 500 ft berarti di udara, selain itu tidak diketahui (undefined).
 */
export function deriveOnGround(event: FusedTrackEvent): boolean | undefined {
  if (event.identity?.targetType === "vehicle") return true;

  const flag = event.position?.onGround;
  if (flag === true) return true;

  const alt = event.position?.alt;
  const speed = event.velocity?.groundSpeed;
  const lowAndSlow =
    alt !== undefined &&
    alt <= SURFACE_MAX_ALT_FT &&
    speed !== undefined &&
    speed < SURFACE_MAX_SPEED_KT;
  if (lowAndSlow) return true;

  if (flag === false) return false;
  if (alt !== undefined && alt > AIRBORNE_MIN_ALT_FT) return false;
  return undefined;
}

/**
 * Ketinggian barometrik dari feed bisa sedikit di bawah nol di bandara dataran rendah (mis. -100 ft
 * saat tekanan lebih tinggi dari standar). Itu bukan ketinggian sungguhan: dibulatkan ke 0.
 */
export function clampAltitude(event: FusedTrackEvent): FusedTrackEvent {
  const alt = event.position?.alt;
  if (event.position === undefined || alt === undefined || alt >= 0) {
    return event;
  }
  return { ...event, position: { ...event.position, alt: 0 } };
}

/**
 * Event yang ketinggiannya tidak negatif dan `position.onGround`-nya sudah dinormalkan; event
 * yang sama bila tidak ada yang berubah.
 */
export function applySurfaceState(input: FusedTrackEvent): FusedTrackEvent {
  if (input.lifecycle === "dropped" || !input.position) return input;
  const event = clampAltitude(input);
  const derived = deriveOnGround(event);
  if (derived === undefined || derived === event.position?.onGround) {
    return event;
  }
  return {
    ...event,
    position: { ...event.position, onGround: derived },
  } as FusedTrackEvent;
}

export interface SurfaceStateStore {
  set(trackId: string, onGround: boolean | undefined): void;
  forget(trackId: string): void;
  readonly size: number;
  /** Tambahkan `onGround` ke track yang dikirim ke klien. Fungsi panah supaya bisa dioper. */
  readonly attach: (track: CurrentTrack) => CurrentTrack;
}

export function createSurfaceStateStore(): SurfaceStateStore {
  const states = new Map<string, boolean>();

  return {
    set: (trackId: string, onGround: boolean | undefined): void => {
      if (onGround === undefined) states.delete(trackId);
      else states.set(trackId, onGround);
    },
    forget: (trackId: string): void => {
      states.delete(trackId);
    },
    get size(): number {
      return states.size;
    },
    attach: (track: CurrentTrack): CurrentTrack => {
      const onGround = states.get(track.trackId);
      if (onGround === undefined) return track;
      if ((track as TrackWithSurface).onGround === onGround) return track;
      return { ...track, onGround } as TrackWithSurface;
    },
  };
}
