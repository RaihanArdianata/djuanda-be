import { type Alert, alertRules, db } from "@repo/database";
import { and, eq } from "drizzle-orm";
import {
  getActiveAlert,
  getActiveAlertRefs,
  setActiveAlert,
} from "../../cache/alert-state.cache";
import { getAirportTracks } from "../../context/surveillance.context";
import { registerAlert } from "../alert/service/alert.service";
import { clearAlertByAlertId, publishAlertCreated } from "./alert.lifecycle";
import { buildAlertContext } from "./detection.context";
import { detectionRules } from "./rules";
import type { AlertCandidate, MovementTrack } from "./types";

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

  const ctx = await buildAlertContext(input);
  const candidates: AlertCandidate[] = [];

  for (const rule of rules) {
    const detector = detectionRules.find((d) => d.type === rule.type);
    if (!detector) continue;

    const config = (rule.configuration as Record<string, unknown>) ?? {};
    const ruleCandidates = detector.evaluate(ctx, config);
    candidates.push(...ruleCandidates);
  }

  const created: Alert[] = [];
  const updated: Alert[] = [];

  for (const candidate of candidates) {
    const entityKey = candidate.alertId.replace(/^[^|]+\|/, "");
    const activeId = await getActiveAlert(
      input.airportId,
      candidate.type,
      entityKey,
    );

    if (activeId) {
      await setActiveAlert(
        input.airportId,
        candidate.type,
        entityKey,
        candidate.alertId,
      );
      continue;
    }

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
      data: candidate.data,
    });

    await setActiveAlert(
      input.airportId,
      candidate.type,
      entityKey,
      stored.alertId,
    );

    await publishAlertCreated(stored);

    created.push(stored);
  }

  const cleared: Alert[] = [];
  const activeAlertIds = new Set(candidates.map((c) => c.alertId));
  const activeRefs = await getActiveAlertRefs(input.airportId);
  for (const ref of activeRefs) {
    if (!ref.alertId || activeAlertIds.has(ref.alertId)) continue;
    const clearedAlert = await clearAlertByAlertId(ref.alertId);
    if (clearedAlert) cleared.push(clearedAlert);
  }

  return { created, updated, cleared };
};
