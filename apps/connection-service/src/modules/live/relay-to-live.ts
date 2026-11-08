import type { FusedTrackEvent } from "@aeroswarm/core";

/**
 * Track dari jalur relay (topic Kafka AeroSwarm dan WebSocket ingest) ke gambaran udara yang dikirim ke klien.
 *
 * Jalur relay menyimpan track ke database dan mengirimkannya ke layanan alert, tetapi dulu tidak pernah sampai ke gambaran udara:
 * hanya feed ASTERIX langsung yang masuk ke sana. Akibatnya pesawat yang hanya datang lewat relay (mis. ADS-B) terlihat oleh layanan
 * alert (segmen aerodrome terisi, alert terpicu) tetapi tidak ada di peta. Di sini track relay yang lolos penyaring kembar
 * (primary-feed-gate: pesawat yang baru dilihat feed langsung dibuang) diteruskan lewat normalisasi dan fusi yang sama dengan feed
 * langsung, jadi satu pesawat tetap satu track.
 */

export interface RelayToLiveDeps {
  enabled: boolean;
  /** Isi callsign yang hilang dan normalkan status darat/udara, seperti untuk feed langsung. */
  normalize: (event: FusedTrackEvent) => FusedTrackEvent;
  /** Fusi dengan sensor lain (null = tidak menambah apa pun). */
  fuse: (event: FusedTrackEvent) => FusedTrackEvent | null;
  /** Ke gambaran udara klien. */
  onTrack: (event: FusedTrackEvent) => void;
  /** Dipanggil untuk tiap track yang diteruskan, mis. untuk penelusuran. */
  onForwarded?: (event: FusedTrackEvent, fused: FusedTrackEvent | null) => void;
}

/** `RELAY_TO_LIVE`: bawaan menyala; hanya `false`, `0`, `off`, atau `no` yang mematikan. */
export function relayToLiveEnabled(
  env: Record<string, string | undefined>,
): boolean {
  return !["false", "0", "off", "no"].includes(
    (env.RELAY_TO_LIVE ?? "").trim().toLowerCase(),
  );
}

export function createRelayToLive(
  deps: RelayToLiveDeps,
): (event: FusedTrackEvent) => void {
  return (event: FusedTrackEvent): void => {
    if (!deps.enabled) return;
    try {
      const normalized = deps.normalize(event);
      const fused = deps.fuse(normalized);
      deps.onForwarded?.(normalized, fused);
      if (fused) deps.onTrack(fused);
    } catch {
      // Satu event relay yang rusak tidak boleh menghentikan penyimpanannya atau consumer-nya.
    }
  };
}
