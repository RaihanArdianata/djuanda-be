import type { FusedTrackEvent } from "@aeroswarm/core";

/** Berapa lama sebuah callsign diingat sejak pesawatnya terakhir terlihat. */
export const DEFAULT_IDENTITY_TTL_MS = 30 * 60_000;

export interface IdentityMemoryOptions {
  ttlMs?: number;
  clock?: () => number;
  /**
   * Sumber cadangan callsign untuk pesawat yang belum pernah mengirim identitas sejak start
   * (mis. dari rencana penerbangan AFTN). Dipanggil hanya bila ingatan tidak punya jawaban.
   */
  fallback?: (icao24: string, now: number) => string | undefined;
}

export interface IdentityMemory {
  /** Catat callsign yang diketahui dari luar aliran (mis. dipulihkan dari database saat start). */
  remember(icao24: string, callsign: string, at?: number): void;
  /**
   * Isi callsign yang hilang dari sebuah update dengan callsign terakhir pesawat itu.
   *
   * ASTERIX hanya sesekali menyertakan identitas target (CAT020 I245), sedangkan posisi datang
   * tiap detik. Tanpa ingatan ini, update tanpa identitas menimpa callsign yang sudah diketahui:
   * label pesawat kembali ke kode Mode-S (mis. "8a1812"), dan hal yang sama terjadi pada saat
   * track menjadi lost. Update yang membawa callsign baru selalu menang.
   */
  fill(event: FusedTrackEvent): FusedTrackEvent;
  /** Lupakan pesawat yang sudah lama tidak terlihat. */
  sweep(now?: number): void;
  readonly size: number;
}

interface Remembered {
  callsign: string;
  seenAt: number;
}

const normalizeIcao24 = (value: string | undefined): string | undefined => {
  const v = value?.trim().toLowerCase();
  return v ? v : undefined;
};

export function createIdentityMemory(
  options: IdentityMemoryOptions = {},
): IdentityMemory {
  const ttlMs = options.ttlMs ?? DEFAULT_IDENTITY_TTL_MS;
  const clock = options.clock ?? Date.now;
  const byIcao24 = new Map<string, Remembered>();

  return {
    remember(icao24: string, callsign: string, at: number = clock()): void {
      const key = normalizeIcao24(icao24);
      const name = callsign.trim();
      if (!(key && name)) return;
      const known = byIcao24.get(key);
      // Jangan menimpa yang lebih baru dengan catatan lama.
      if (known && known.seenAt >= at) return;
      byIcao24.set(key, { callsign: name, seenAt: at });
    },
    fill(event: FusedTrackEvent): FusedTrackEvent {
      if (event.lifecycle === "dropped") return event;
      const icao24 = normalizeIcao24(event.identity?.icao24);
      if (!icao24) return event;

      const now = clock();
      const callsign = event.identity?.callsign?.trim();
      if (callsign) {
        byIcao24.set(icao24, { callsign, seenAt: now });
        return event;
      }

      const known = byIcao24.get(icao24);
      if (!known || now - known.seenAt > ttlMs) {
        const fromFallback = options.fallback?.(icao24, now);
        if (!fromFallback) return event;
        return {
          ...event,
          identity: { ...event.identity, callsign: fromFallback },
        };
      }
      // Selama pesawat masih terlihat, ingatannya tidak kedaluwarsa.
      known.seenAt = now;
      return {
        ...event,
        identity: { ...event.identity, callsign: known.callsign },
      };
    },
    sweep(now: number = clock()): void {
      for (const [key, known] of byIcao24) {
        if (now - known.seenAt > ttlMs) byIcao24.delete(key);
      }
    },
    get size(): number {
      return byIcao24.size;
    },
  };
}
