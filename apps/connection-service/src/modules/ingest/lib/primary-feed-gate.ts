/**
 * Menahan data ganda dari dua jalur yang membawa radar/MLAT yang sama.
 *
 *  - Jalur utama: feed UDP langsung ke connection-service (didecode di sini).
 *  - Jalur kedua: topic Kafka dari AeroSwarm, yang menerima aliran yang sama dan menulisnya
 *    ke redpanda kita.
 *
 * Kedua jalur memberi `trackId` acak yang berbeda untuk pesawat yang sama, jadi tanpa penyaring
 * satu pesawat tersimpan dua kali dan alert-service melihat dua "pesawat" di posisi yang sama
 * (STCA antar-kembaran), dan takeoff/landing terhitung ganda di statistik. Pesawat dikenali dari
 * alamat Mode-S (`icao24`), bukan trackId.
 *
 * Aturannya: bila jalur utama baru saja melihat sebuah pesawat, event jalur kedua untuk pesawat
 * itu dibuang. Bila jalur utama diam (mirror mati, UDP putus), event jalur kedua diteruskan
 * sebagai cadangan supaya data tidak berhenti.
 */

export interface PrimaryFeedGateStats {
  /** Event jalur kedua yang dibuang karena jalur utama sudah mencakupnya. */
  dropped: number;
  /** Event jalur kedua yang diteruskan (jalur utama tidak melihat pesawatnya). */
  passed: number;
  /** Pesawat yang sedang dianggap tercakup jalur utama. */
  tracked: number;
}

export interface PrimaryFeedGate {
  /** Catat bahwa jalur utama baru melihat pesawat ini. */
  seen(icao24: string | null | undefined, now?: number): void;
  /**
   * Haruskah event jalur kedua untuk pesawat ini dibuang? Tanpa `icao24` pesawatnya tidak dapat
   * dicocokkan, jadi event diteruskan.
   */
  shouldDrop(icao24: string | null | undefined, now?: number): boolean;
  /** Buang catatan pesawat yang sudah lama tidak terlihat. */
  sweep(now?: number): void;
  readonly stats: () => PrimaryFeedGateStats;
}

const normalize = (icao24: string | null | undefined): string | undefined => {
  const v = icao24?.trim().toLowerCase();
  return v ? v : undefined;
};

export function createPrimaryFeedGate(
  windowMs: number,
  clock: () => number = Date.now,
): PrimaryFeedGate {
  const lastSeen = new Map<string, number>();
  const counters = { dropped: 0, passed: 0 };

  return {
    seen(icao24: string | null | undefined, now: number = clock()): void {
      const key = normalize(icao24);
      if (key) lastSeen.set(key, now);
    },
    shouldDrop(
      icao24: string | null | undefined,
      now: number = clock(),
    ): boolean {
      const key = normalize(icao24);
      if (!key) {
        counters.passed++;
        return false;
      }
      const at = lastSeen.get(key);
      const covered = at !== undefined && now - at <= windowMs;
      if (covered) counters.dropped++;
      else counters.passed++;
      return covered;
    },
    sweep(now: number = clock()): void {
      for (const [key, at] of lastSeen) {
        if (now - at > windowMs * 4) lastSeen.delete(key);
      }
    },
    stats: (): PrimaryFeedGateStats => ({
      dropped: counters.dropped,
      passed: counters.passed,
      tracked: lastSeen.size,
    }),
  };
}

/** Berapa lama setelah dilihat jalur utama, sebuah pesawat dianggap masih tercakup. Bawaan 20 detik. */
export function dedupeWindowFromEnv(
  env: Record<string, string | undefined>,
): number {
  const raw = Number(env.INGEST_DEDUPE_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 20_000;
}

/** icao24 dari event track atau movement hasil AeroSwarm; undefined bila tidak ada. */
export function icao24Of(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const e = event as {
    icao24?: unknown;
    identity?: { icao24?: unknown } | null;
  };
  const value = e.identity?.icao24 ?? e.icao24;
  return typeof value === "string" ? value : undefined;
}

/**
 * Apakah event dari topic Kafka AeroSwarm ini kembar dari jalur utama? Hanya track dan movement
 * yang disaring; alert dan jenis lain tidak punya kembaran di jalur utama.
 */
export function isCoveredDuplicate(
  gate: PrimaryFeedGate | undefined,
  kind: "track" | "alert" | "movement" | "unknown",
  event: unknown,
): boolean {
  if (!gate || (kind !== "track" && kind !== "movement")) return false;
  return gate.shouldDrop(icao24Of(event));
}

/** Event rencana penerbangan (AFTN) yang ikut ada di topic ingest AeroSwarm; AFTN diterima lewat UDP langsung. */
export function isFlightPlanShape(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const e = event as { message?: unknown; messageId?: unknown };
  return (
    typeof e.messageId === "string" &&
    typeof e.message === "object" &&
    e.message !== null
  );
}
