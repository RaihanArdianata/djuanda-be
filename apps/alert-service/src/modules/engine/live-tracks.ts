import type { MovementTrack } from "./types";

/**
 * Posisi terakhir tiap track yang masih "hidup", disimpan di memori proses.
 *
 * Sebelumnya setiap pesan track membaca seluruh Redis (SCAN + MGET + parse) untuk mengumpulkan
 * track bandara, dan kuncinya baru kedaluwarsa setelah 5 menit: pesawat yang sudah pergi masih ikut
 * dievaluasi (alert untuk pesawat yang tak ada lagi di peta) dan biaya per pesan membengkak
 * sehingga konsumen Kafka tertinggal berjam-jam. Di sini evaluasi hanya melihat track yang
 * diperbarui dalam `maxAgeMs` terakhir menurut jam proses ini (bukan jam event, supaya tetap benar
 * saat konsumen sedang mengejar antrean).
 */
export interface LiveTracks {
  upsert(track: MovementTrack, now?: number): void;
  remove(airportId: string, trackId: string): void;
  /** Track segar milik bandara ini; yang sudah lewat `maxAgeMs` dibuang. */
  snapshot(airportId: string, now?: number): MovementTrack[];
  /** Jumlah track tersimpan (termasuk yang belum dibuang). */
  readonly size: number;
}

interface Entry {
  track: MovementTrack;
  seenAt: number;
}

export function createLiveTracks(
  maxAgeMs: number,
  clock: () => number = Date.now,
): LiveTracks {
  const byAirport = new Map<string, Map<string, Entry>>();

  return {
    upsert(track: MovementTrack, now: number = clock()): void {
      let tracks = byAirport.get(track.airportId);
      if (!tracks) {
        tracks = new Map();
        byAirport.set(track.airportId, tracks);
      }
      tracks.set(track.trackId, { track, seenAt: now });
    },
    remove(airportId: string, trackId: string): void {
      byAirport.get(airportId)?.delete(trackId);
    },
    snapshot(airportId: string, now: number = clock()): MovementTrack[] {
      const tracks = byAirport.get(airportId);
      if (!tracks) return [];
      const fresh: MovementTrack[] = [];
      for (const [trackId, entry] of tracks) {
        if (now - entry.seenAt > maxAgeMs) tracks.delete(trackId);
        else fresh.push(entry.track);
      }
      return fresh;
    },
    get size(): number {
      let total = 0;
      for (const tracks of byAirport.values()) total += tracks.size;
      return total;
    },
  };
}

/** Berapa lama track tanpa update masih ikut evaluasi. Bawaan 30 detik. */
export function trackMaxAgeFromEnv(
  env: Record<string, string | undefined>,
): number {
  const raw = Number(env.ALERT_TRACK_MAX_AGE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}
