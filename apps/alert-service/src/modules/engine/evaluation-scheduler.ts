import { logger } from "@repo/logger";

/**
 * Menjalankan evaluasi alert paling sering sekali per `minIntervalMs` per bandara, terlepas dari
 * berapa banyak pesan track yang masuk.
 *
 * Sebelumnya setiap pesan track memicu evaluasi penuh seluruh rule atas seluruh track (STCA
 * membandingkan semua pasangan). Pada ratusan pesan per detik itu lebih lambat dari laju masuk,
 * antrean Kafka menumpuk, dan alert baru muncul satu jam setelah kejadian. Sekarang pesan hanya
 * memperbarui posisi dan meminta evaluasi; permintaan yang berdekatan digabung, dan evaluasi
 * tidak pernah berjalan bertumpuk untuk bandara yang sama.
 */
export interface EvaluationScheduler {
  /** Minta evaluasi untuk bandara ini; digabung bila sudah ada yang menunggu. */
  request(airportId: string, timestamp: Date): void;
  /** Hentikan penjadwalan (tes dan shutdown). */
  stop(): void;
  readonly stats: () => EvaluationStats;
}

export interface EvaluationStats {
  requested: number;
  runs: number;
  failures: number;
}

interface AirportState {
  running: boolean;
  pending: boolean;
  lastStartAt: number;
  latest: Date;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createEvaluationScheduler(opts: {
  minIntervalMs: number;
  /**
   * Tanpa pesan baru, evaluasi tetap diminta ulang tiap interval ini untuk setiap bandara yang
   * pernah terlihat. Tanpa itu, saat semua pesawat pergi (atau lalu lintas berhenti) tidak ada
   * evaluasi lagi: sorotan aerodrome "terisi" tersangkut dan alert tidak ikut dibersihkan.
   */
  heartbeatMs?: number;
  evaluate: (airportId: string, timestamp: Date) => Promise<void>;
  clock?: () => number;
}): EvaluationScheduler {
  const clock = opts.clock ?? Date.now;
  const airports = new Map<string, AirportState>();
  const counters: EvaluationStats = { requested: 0, runs: 0, failures: 0 };
  let stopped = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stateOf = (airportId: string, timestamp: Date): AirportState => {
    let state = airports.get(airportId);
    if (!state) {
      state = {
        running: false,
        pending: false,
        lastStartAt: Number.NEGATIVE_INFINITY,
        latest: timestamp,
        timer: null,
      };
      airports.set(airportId, state);
    }
    return state;
  };

  const run = async (airportId: string, state: AirportState): Promise<void> => {
    state.timer = null;
    state.running = true;
    state.pending = false;
    state.lastStartAt = clock();
    counters.runs++;
    try {
      await opts.evaluate(airportId, state.latest);
    } catch (err) {
      // Galat evaluasi tidak boleh menghentikan penjadwal; evaluasi berikutnya mencoba lagi.
      counters.failures++;
      logger.error({ err, airportId }, "alert evaluation failed");
    } finally {
      state.running = false;
      if (state.pending) schedule(airportId, state);
    }
  };

  const schedule = (airportId: string, state: AirportState): void => {
    if (stopped || state.running || state.timer) return;
    const wait = Math.max(0, state.lastStartAt + opts.minIntervalMs - clock());
    state.timer = setTimeout(() => {
      void run(airportId, state);
    }, wait);
    state.timer.unref?.();
  };

  const self: EvaluationScheduler = {
    request(airportId: string, timestamp: Date): void {
      counters.requested++;
      const state = stateOf(airportId, timestamp);
      state.pending = true;
      if (timestamp.getTime() > state.latest.getTime())
        state.latest = timestamp;
      schedule(airportId, state);
    },
    stop(): void {
      stopped = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      for (const state of airports.values()) {
        if (state.timer) clearTimeout(state.timer);
        state.timer = null;
      }
    },
    stats: (): EvaluationStats => ({ ...counters }),
  };

  if (opts.heartbeatMs && opts.heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      for (const airportId of [...airports.keys()]) {
        self.request(airportId, new Date(clock()));
      }
    }, opts.heartbeatMs);
    heartbeat.unref?.();
  }
  return self;
}

/** Jarak minimum antar evaluasi per bandara. Bawaan 1 detik. */
export function evaluationIntervalFromEnv(
  env: Record<string, string | undefined>,
): number {
  const raw = Number(env.ALERT_EVAL_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1_000;
}

/**
 * Pesan track yang lebih tua dari ini (menurut waktu event) tidak dievaluasi: alert untuk kejadian
 * sejam lalu bukan alert live, dan melewatinya membuat konsumen cepat mengejar antrean.
 * Bawaan 60 detik.
 */
export function maxEventAgeFromEnv(
  env: Record<string, string | undefined>,
): number {
  const raw = Number(env.ALERT_MAX_EVENT_AGE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
}
