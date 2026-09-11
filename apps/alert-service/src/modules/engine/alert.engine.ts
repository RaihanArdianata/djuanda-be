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
  getActiveAlert,
  getActiveAlertRefs,
  setActiveAlert,
} from "../../cache/alert-state.cache";
import { getAirportTracks } from "../../context/surveillance.context";
import {
  type AlertTrackHistoryPoint,
  recordAlertTrackHistory,
  registerAlert,
} from "../alert/service/alert.service";
import { clearAlertByAlertId, publishAlertCreated } from "./alert.lifecycle";
import { seedPostHistory, startPostHistory } from "./alert-post-history";
import { buildAlertContext } from "./detection.context";
import { detectionRules } from "./rules";
import {
  getTrackHistory,
  getTrackKey,
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
    candidates.push(...detector.evaluate(ctx, config));
  }

  return candidates;
}

async function registerCandidate(
  candidate: AlertCandidate,
  airportId: string,
): Promise<Alert | null> {
  const entityKey = candidate.alertId.replace(/^[^|]+\|/, "");
  const activeId = await getActiveAlert(airportId, candidate.type, entityKey);

  if (activeId) {
    await setActiveAlert(
      airportId,
      candidate.type,
      entityKey,
      candidate.alertId,
    );
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
    : (getTrackKey(candidate.trackId) ?? candidate.trackId);
  const relatedStableKey = candidate.relatedTrackId
    ? relatedInfo
      ? resolveTrackHistoryKey(relatedInfo)
      : (getTrackKey(candidate.relatedTrackId) ?? candidate.relatedTrackId)
    : null;

  const enrichedData = {
    ...candidate.data,
    trackHistory,
    relatedTrackHistory,
  };

  const stored = await registerAlert({
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

async function clearStaleAlerts(
  airportId: string,
  candidates: AlertCandidate[],
): Promise<Alert[]> {
  const cleared: Alert[] = [];
  const activeAlertIds = new Set(candidates.map((c) => c.alertId));
  const activeRefs = await getActiveAlertRefs(airportId);

  for (const ref of activeRefs) {
    if (!ref.alertId || activeAlertIds.has(ref.alertId)) continue;
    const clearedAlert = await clearAlertByAlertId(ref.alertId);
    if (clearedAlert) cleared.push(clearedAlert);
  }

  return cleared;
}

async function clearExpiredAlerts(airportId: string): Promise<Alert[]> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
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

  const cleared: Alert[] = [];
  for (const { alertId } of expired) {
    try {
      const alert = await clearAlertByAlertId(alertId);
      if (alert) cleared.push(alert);
    } catch (err) {
      logger.warn({ err, alertId }, "failed to clear expired alert");
    }
  }
  return cleared;
}

export const evaluateMovement = async (
  input: DetectionInput,
): Promise<DetectionResult> => {
  const rules = await db
    .select()
    .from(alertRules)
    .where(
      and(
        eq(alertRules.airportId, input.airportId),
        eq(alertRules.enabled, true),
      ),
    );

  if (rules.length === 0) {
    logger.warn(
      { airportId: input.airportId, trackCount: input.tracks.length },
      "no enabled alert rules for airport — run `bun run --cwd packages/database seed:alerts`",
    );
    return { created: [], updated: [], cleared: [] };
  }

  const ctx = await buildAlertContext(input);
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
    const stored = await registerCandidate(candidate, input.airportId);
    if (stored) created.push(stored);
  }

  const staleCleared = await clearStaleAlerts(input.airportId, candidates);
  const expiredCleared = await clearExpiredAlerts(input.airportId);
  const cleared = [...staleCleared, ...expiredCleared];

  return { created, updated, cleared };
};
