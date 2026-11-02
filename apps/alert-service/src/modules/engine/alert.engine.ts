import {
  type Alert,
  type AlertRule,
  alertRules,
  alerts,
  db,
} from "@repo/database";
import { logger } from "@repo/logger";
import { and, eq, lt } from "drizzle-orm";
import {
  ACTIVE_ALERT_TTL_SECONDS,
  claimActiveAlert,
  clearActiveAlert,
  getActiveAlert,
  getActiveAlertRefs,
  getActiveAlertTtl,
  setActiveAlert,
} from "../../cache/alert-state.cache";
import { alertServiceEnv } from "../../config/env";
import { getAerodromeContext } from "../../context/aerodrome.context";
import { getAirportTracks } from "../../context/surveillance.context";
import {
  type AlertTrackHistoryPoint,
  recordAlertTrackHistory,
  registerAlert,
} from "../alert/service/alert.service";
import { broadcastAerodromeStatus } from "./aerodrome-status.service";
import { clearAlertByAlertId, publishAlertCreated } from "./alert.lifecycle";
import { seedPostHistory, startPostHistory } from "./alert-post-history";
import { buildAlertContext } from "./detection.context";
import { detectionRules } from "./rules";
import {
  buildEntityKey,
  getTrackHistory,
  resolveTrackHistoryKey,
  type TrackHistoryRecord,
} from "./track-history";
import type { AlertCandidate, AlertContext, MovementTrack } from "./types";

function trackSnapshotToHistoryPoint(
  alertId: string,
  kind: "main" | "related",
  snap: TrackHistoryRecord,
): AlertTrackHistoryPoint {
  return {
    alertId,
    kind,
    trackId: snap.trackId,
    targetType: snap.targetType ?? null,
    callsign: snap.callsign ?? null,
    registration: snap.registration ?? null,
    latitude: snap.latitude,
    longitude: snap.longitude,
    altitude: snap.altitude,
    groundSpeed: snap.groundSpeed,
    heading: snap.heading,
    onGround: snap.onGround,
    timestamp: new Date(snap.timestamp),
  };
}

export interface DetectionInput {
  airportId: string;
  timestamp: Date;
  tracks: MovementTrack[];
}

export interface DetectionResult {
  created: Alert[];
  updated: Alert[];
  cleared: Alert[];
}

const RULES_CACHE_TTL_MS = 30_000;
const rulesCache = new Map<string, { rules: AlertRule[]; expiresAt: number }>();

/** Rules jarang berubah — query DB tiap track message cuma menambah latency
 *  per pesan dan memperparah consumer lag. Cache pendek per airport. */
async function getEnabledRules(airportId: string): Promise<AlertRule[]> {
  const cached = rulesCache.get(airportId);
  if (cached && cached.expiresAt > Date.now()) return cached.rules;
  const rules = await db
    .select()
    .from(alertRules)
    .where(
      and(eq(alertRules.airportId, airportId), eq(alertRules.enabled, true)),
    );
  rulesCache.set(airportId, {
    rules,
    expiresAt: Date.now() + RULES_CACHE_TTL_MS,
  });
  return rules;
}

/**
 * Evaluasi seluruh rule atas track segar bandara ini (dari memori, bukan Redis). Dipanggil oleh
 * penjadwal paling sering sekali per interval, bukan per pesan track.
 */
export async function evaluateAirport(
  airportId: string,
  timestamp: Date,
  tracks: MovementTrack[],
): Promise<void> {
  // Juga saat tidak ada track: hunian aerodrome harus kembali "kosong" dan alert lama dibersihkan.
  await evaluateMovement({ airportId, timestamp, tracks });
}

export async function processTrackUpdate(track: MovementTrack): Promise<void> {
  const input: DetectionInput = {
    airportId: track.airportId,
    timestamp: track.timestamp,
    tracks: await getAirportTracks(track.airportId),
  };

  if (!input.tracks.some((t) => t.trackId === track.trackId)) {
    input.tracks.push(track);
  }

  await evaluateMovement(input);
}

function collectCandidates(
  rules: AlertRule[],
  ctx: AlertContext,
): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];

  for (const rule of rules) {
    const detector = detectionRules.find((d) => d.type === rule.type);
    if (!detector) {
      logger.warn({ type: rule.type }, "no detector registered for rule type");
      continue;
    }

    const config = (rule.configuration as Record<string, unknown>) ?? {};
    try {
      candidates.push(...detector.evaluate(ctx, config));
    } catch (err) {
      // Bug/config buruk di satu rule (mis. polygon malformed) tidak boleh
      // menggagalkan seluruh evaluasi — kalau tidak, ini jadi "poison pill"
      // yang membuat Kafka retry pesan yang sama tanpa henti.
      logger.error(
        { err, type: rule.type, airportId: ctx.airportId },
        "alert rule evaluation threw — rule skipped for this track update",
      );
    }
  }

  return candidates;
}

const PENDING_CLAIM_VALUE = "__pending__";

async function registerCandidate(
  candidate: AlertCandidate,
  airportId: string,
): Promise<Alert | null> {
  const entityKey = buildEntityKey(candidate);

  // Klaim entity secara atomic (SET NX) SEBELUM proses DB insert yang lama —
  // mencegah 2 track update berdekatan untuk entity yang sama lolos
  // pengecekan berdua dan bikin alert duplikat (lihat claimActiveAlert).
  const claimed = await claimActiveAlert(
    airportId,
    candidate.type,
    entityKey,
    PENDING_CLAIM_VALUE,
  );

  if (!claimed) {
    const activeId = await getActiveAlert(airportId, candidate.type, entityKey);
    if (activeId && activeId !== PENDING_CLAIM_VALUE) {
      // Refresh TTL, jangan overwrite dengan candidate.alertId (bukan DB alertId).
      await setActiveAlert(airportId, candidate.type, entityKey, activeId);
    }
    return null;
  }

  const trackHistory = getTrackHistory(candidate.trackId, 20);
  const relatedTrackHistory = getTrackHistory(candidate.relatedTrackId, 20);

  // Pakai stable key (callsign/registration) buat post-history supaya
  // trackId yang berubah tiap update tetap masuk ke bucket yang sama.
  const mainInfo = trackHistory[trackHistory.length - 1];
  const relatedInfo = relatedTrackHistory[relatedTrackHistory.length - 1];
  const mainStableKey = mainInfo
    ? resolveTrackHistoryKey(mainInfo)
    : buildEntityKey({ trackId: candidate.trackId });
  const relatedStableKey = candidate.relatedTrackId
    ? relatedInfo
      ? resolveTrackHistoryKey(relatedInfo)
      : buildEntityKey({ trackId: candidate.relatedTrackId })
    : null;

  const enrichedData = {
    ...candidate.data,
    entityKey,
    trackHistory,
    relatedTrackHistory,
  };

  let stored: Alert;
  try {
    stored = await registerAlert({
      ...candidate,
      relatedTrackId: candidate.relatedTrackId ?? null,
      notamId: null,
      ashtamId: null,
      aftnMessageId: null,
      aerodromeFeatureId: candidate.aerodromeFeatureId ?? null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      clearedAt: null,
      clearedBy: null,
      data: enrichedData,
    });
  } catch (err) {
    // Lepas klaim __pending__, kalau tidak entity ini tidak bisa membuat
    // alert lagi sampai TTL klaim (5 menit) habis — alert valid hilang.
    await clearActiveAlert(airportId, candidate.type, entityKey);
    throw err;
  }

  const trackHistoryPoints = [
    ...trackHistory.map((snap) =>
      trackSnapshotToHistoryPoint(stored.alertId, "main", snap),
    ),
    ...relatedTrackHistory.map((snap) =>
      trackSnapshotToHistoryPoint(stored.alertId, "related", snap),
    ),
  ];

  await setActiveAlert(airportId, candidate.type, entityKey, stored.alertId);
  await publishAlertCreated(stored);

  logger.info(
    {
      alertId: stored.alertId,
      type: stored.type,
      severity: stored.severity,
      trackId: stored.trackId,
      airportId,
    },
    "alert created",
  );

  // Mulai rekam posisi setelah alert muncul (post-event history).
  // Seed dengan titik kejadian supaya tidak duplikat saat track update sama masuk.
  startPostHistory(stored.alertId, mainStableKey, relatedStableKey);
  seedPostHistory(
    stored.alertId,
    trackHistory[trackHistory.length - 1],
    relatedTrackHistory[relatedTrackHistory.length - 1],
  );

  // Simpan history track ke tabel terpisah. Jangan biarkan error di sini
  // menggagalkan alert creation, karena alert masih harus aktif & terpublish.
  try {
    await recordAlertTrackHistory(trackHistoryPoints);
  } catch (err) {
    logger.error(
      { err, alertId: stored.alertId },
      "failed to record alert track history",
    );
  }

  return stored;
}

/**
 * Alert boleh kehilangan candidate-nya beberapa evaluasi sebelum di-clear.
 * Satu tick "kosong" (jitter posisi di batas polygon, snapshot track yang
 * beda antar-evaluasi paralel, context gagal sesaat) dulunya langsung
 * membunuh alert → ALERT_CLEARED → recreated → kedip-kedip di frontend.
 *
 * Key active-alert di-refresh ke ACTIVE_ALERT_TTL_SECONDS tiap candidate
 * terlihat, jadi sisa TTL adalah clock "berapa lama tidak ke-refresh":
 * clear hanya kalau ttl <= ACTIVE_ALERT_TTL_SECONDS - grace.
 */
async function clearStaleAlerts(
  airportId: string,
  candidates: AlertCandidate[],
): Promise<Alert[]> {
  const cleared: Alert[] = [];
  const activeEntityKeys = new Set(candidates.map(buildEntityKey));
  const activeRefs = await getActiveAlertRefs(airportId);
  const refreshThreshold =
    ACTIVE_ALERT_TTL_SECONDS - alertServiceEnv.staleGraceSeconds;

  for (const ref of activeRefs) {
    if (!ref.entityKey || activeEntityKeys.has(ref.entityKey)) continue;
    if (!ref.alertId || ref.alertId === PENDING_CLAIM_VALUE) continue;

    // Masih dalam grace period — candidate bisa saja absen sesaat.
    const ttl = await getActiveAlertTtl(ref.key);
    if (ttl > refreshThreshold) continue;

    try {
      const clearedAlert = await clearAlertByAlertId(ref.alertId);
      if (clearedAlert) cleared.push(clearedAlert);
    } catch (err) {
      // Jangan biarkan kegagalan clear satu alert menghentikan evaluateMovement
      // — itu akan bikin Kafka retry pesan yang sama terus-menerus.
      logger.warn({ err, alertId: ref.alertId }, "failed to clear stale alert");
    }
  }

  return cleared;
}

export const ALERT_LIVE_WINDOW_MS = 5 * 60 * 1000;

async function clearExpiredForAirport(airportId: string): Promise<Alert[]> {
  const fiveMinutesAgo = new Date(Date.now() - ALERT_LIVE_WINDOW_MS);
  const expired = await db
    .select({ alertId: alerts.alertId })
    .from(alerts)
    .where(
      and(
        eq(alerts.airportId, airportId),
        eq(alerts.status, "ACTIVE"),
        lt(alerts.triggeredAt, fiveMinutesAgo),
      ),
    );

  // Jangan expire alert yang entity-nya masih terlihat: Redis ref dengan ttl
  // di atas threshold berarti candidate-nya direfresh dalam grace window
  // (sama seperti clearStaleAlerts). Expire murni umur dulu membuat alert
  // persisten (pesawat masih di dalam surface >5 menit) siklus
  // Aktif→Selesai→BARU tanpa henti.
  const refs = await getActiveAlertRefs(airportId);
  const refKeyByAlertId = new Map(
    refs
      .filter((r) => r.alertId && r.alertId !== PENDING_CLAIM_VALUE)
      .map((r) => [r.alertId as string, r.key]),
  );

  const cleared: Alert[] = [];
  for (const { alertId } of expired) {
    const refKey = refKeyByAlertId.get(alertId);
    // The event timestamp may come from a delayed/replayed surveillance feed.
    // An existing Redis claim is the runtime liveness signal; expiring from
    // `triggeredAt` alone creates ALERT_CLEARED/ALERT_CREATED flicker.
    if (refKey) continue;
    try {
      const alert = await clearAlertByAlertId(alertId);
      if (alert) cleared.push(alert);
    } catch (err) {
      logger.warn({ err, alertId }, "failed to clear expired alert");
    }
  }
  return cleared;
}

const EXPIRE_CHECK_INTERVAL_MS = 30_000;
const lastExpireCheck = new Map<string, number>();

/**
 * Dipanggil dari evaluateMovement (per track update). Throttle per airport
 * supaya query ini nggak jalan di tiap message — cukup sekali per interval.
 * Best-effort: kegagalan DB di sini TIDAK BOLEH menggagalkan evaluateMovement,
 * karena itu akan bikin Kafka retry pesan yang sama terus-menerus dan
 * menyumbat seluruh ingest track (alert baru jadi tidak pernah diproses lagi).
 */
async function clearExpiredAlerts(airportId: string): Promise<Alert[]> {
  const last = lastExpireCheck.get(airportId) ?? 0;
  const now = Date.now();
  if (now - last < EXPIRE_CHECK_INTERVAL_MS) return [];
  lastExpireCheck.set(airportId, now);

  try {
    return await clearExpiredForAirport(airportId);
  } catch (err) {
    logger.warn({ err, airportId }, "failed to query expired alerts");
    return [];
  }
}

/**
 * Sweep global independen dari trafik Kafka — dipanggil dari timer
 * (lihat index.ts). Ini jaring pengaman: kalau suatu airport berhenti
 * menerima track update sama sekali, alert-nya tetap akan di-expire alih-alih
 * nyangkut ACTIVE selamanya (yang bikin badge/live count di frontend salah).
 */
export async function sweepExpiredAlerts(): Promise<void> {
  try {
    const rows = await db
      .selectDistinct({ airportId: alerts.airportId })
      .from(alerts)
      .where(eq(alerts.status, "ACTIVE"));

    for (const { airportId } of rows) {
      try {
        await clearExpiredForAirport(airportId);
      } catch (err) {
        logger.warn(
          { err, airportId },
          "sweep: failed to clear expired alerts",
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "sweep: failed to list airports with active alerts");
  }
}

export const evaluateMovement = async (
  input: DetectionInput,
): Promise<DetectionResult> => {
  // Occupancy dibroadcast secepat mungkin — terpisah dari query rules dan
  // context HTTP lain (weather/advisory bisa timeout detik-an dan menahan
  // broadcast kalau ditunggu). Promise yang sama dipakai ulang oleh
  // buildAlertContext supaya geometry tidak di-fetch dua kali.
  const aerodromePromise = getAerodromeContext(
    input.airportId,
    input.tracks,
  ).catch((err) => {
    logger.warn(
      { err, airportId: input.airportId, source: "aerodrome" },
      "alert context source failed — rules needing it are skipped",
    );
    return null;
  });
  void aerodromePromise.then((aerodrome) =>
    broadcastAerodromeStatus(input.airportId, aerodrome),
  );

  const rules = await getEnabledRules(input.airportId);

  if (rules.length === 0) {
    logger.warn(
      { airportId: input.airportId, trackCount: input.tracks.length },
      "no enabled alert rules for airport — run `bun run --cwd packages/database seed:alerts`",
    );
    return { created: [], updated: [], cleared: [] };
  }

  const ctx = await buildAlertContext(input, aerodromePromise);
  const candidates = collectCandidates(rules, ctx);

  if (candidates.length === 0) {
    logger.debug(
      {
        airportId: input.airportId,
        rules: rules.length,
        tracks: input.tracks.length,
        context: {
          weather: ctx.weather !== null,
          aerodrome: ctx.aerodrome !== null,
          aftn: ctx.aftn !== null,
          notam: ctx.notam !== null,
        },
      },
      "track evaluated — no alert candidates",
    );
  }

  const created: Alert[] = [];
  const updated: Alert[] = [];

  for (const candidate of candidates) {
    try {
      const stored = await registerCandidate(candidate, input.airportId);
      if (stored) created.push(stored);
    } catch (err) {
      // Kegagalan registrasi satu candidate (mis. DB insert error) tidak
      // boleh menggagalkan candidate lain atau seluruh message — kalau
      // tidak, Kafka akan retry pesan yang sama tanpa henti.
      logger.error(
        { err, alertId: candidate.alertId, type: candidate.type },
        "failed to register alert candidate",
      );
    }
  }

  // Kalau context aerodrome gagal di-fetch, "tidak ada candidate" tidak bisa
  // dipercaya — surface-based rules selalu menghasilkan nol saat geometrinya
  // kosong, dan itu dulu menghapus SEMUA alert aktif airport ini sekaligus.
  // Alert yang benar-benar stale tetap dibersihkan TTL sweep / expiry.
  const staleCleared = ctx.aerodrome
    ? await clearStaleAlerts(input.airportId, candidates)
    : [];
  const expiredCleared = await clearExpiredAlerts(input.airportId);
  const cleared = [...staleCleared, ...expiredCleared];

  return { created, updated, cleared };
};
