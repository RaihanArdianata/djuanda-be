/**
 * Konfirmasi: sebuah kondisi baru melahirkan alert setelah bertahan sekian detik tanpa terputus.
 *
 * Satu laporan yang kebetulan masuk area, goyangan di garis batas, atau gema sensor yang hilang dalam sedetik tidak boleh jadi alert. Kondisi
 * dianggap terputus bila tidak terlihat lebih lama dari `gapMs` (lalu hitungan mulai dari awal). Waktu memakai jam proses, bukan waktu event.
 */
export interface ConfirmationGate {
  /** Dipanggil tiap kali kondisi terlihat. true bila sudah bertahan `minSeconds` (0 atau kurang = langsung). */
  confirm(key: string, minSeconds: number): boolean;
  /** Buang kondisi yang sudah lama tidak terlihat. */
  sweep(): void;
  size(): number;
}

interface Seen {
  firstAt: number;
  lastAt: number;
}

export function createConfirmationGate(
  options: { gapMs?: number; forgetAfterMs?: number; now?: () => number } = {},
): ConfirmationGate {
  const gapMs = options.gapMs ?? 20_000;
  const forgetAfterMs = options.forgetAfterMs ?? 600_000;
  const now = options.now ?? ((): number => Date.now());
  const seen = new Map<string, Seen>();

  return {
    confirm(key: string, minSeconds: number): boolean {
      const t = now();
      const known = seen.get(key);
      const entry: Seen =
        known && t - known.lastAt <= gapMs ? known : { firstAt: t, lastAt: t };
      entry.lastAt = t;
      seen.set(key, entry);
      return minSeconds <= 0 || t - entry.firstAt >= minSeconds * 1000;
    },

    sweep(): void {
      const t = now();
      for (const [key, entry] of seen) {
        if (t - entry.lastAt > forgetAfterMs) seen.delete(key);
      }
    },

    size(): number {
      return seen.size;
    },
  };
}
