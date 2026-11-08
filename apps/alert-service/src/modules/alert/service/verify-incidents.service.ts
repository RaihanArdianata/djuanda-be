import type { Alert } from "@repo/database";
import { logger } from "@repo/logger";
import ApiError from "@repo/shared/api-error";
import { publishAlertsVerifiedBatch } from "../../engine/alert.lifecycle";
import { composeVerificationNote } from "../incident/incident-query";
import { chunk, planVerification } from "../incident/incident-verify";
import {
  enqueueVerifyIncidents,
  getVerifyJobStatus,
  type VerifyJobStatus,
} from "../queue/verify-incidents.queue";
import {
  VERIFY_BATCH_SIZE,
  type VerifyJobData,
  type VerifyJobResult,
} from "../queue/verify-incidents.types";
import {
  findAlertsByAlertIds,
  recordAlertActionsBatch,
  verifyAlertsBatch,
} from "../repository/alert.repository";
import type { VerifyIncidentsInput } from "../validator/alert.validator";
import { forgetIncidentCache } from "./incident.service";

type UserActor = { id?: string; name?: string; username?: string };

export interface VerifyIncidentsAccepted {
  /** true = masuk antrean dan diproses di latar belakang; false = sudah selesai di tempat (antrean tidak tersedia, atau tidak ada yang berubah). */
  queued: boolean;
  jobId: string | null;
  total: number;
  /** Alert yang akan diubah. */
  accepted: number;
  /** Alert yang dilewati (sudah dinilai atau sudah berisi penilaian yang sama). */
  skipped: number;
  /** Hanya bila selesai di tempat. */
  updated?: number;
}

/**
 * Satu kelompok: satu SELECT, satu UPDATE, satu INSERT riwayat, satu siaran. Dihitung ulang dari isi tabel saat ini, jadi pekerjaan yang
 * diulang tidak mencatat riwayat dua kali.
 */
export async function applyVerifyChunk(
  alertIds: string[],
  data: VerifyJobData,
): Promise<{ updated: number; skipped: number }> {
  const found = await findAlertsByAlertIds(alertIds);
  const plan = planVerification(found, {
    status: data.status,
    note: data.note,
    onlyUnverified: data.onlyUnverified,
  });
  if (plan.targets.length === 0) return { updated: 0, skipped: found.length };

  const updated: Alert[] = await verifyAlertsBatch(
    plan.targets.map((a) => a.id),
    { status: data.status, note: data.note, verifiedBy: data.actorName },
  );
  const previous = new Map(
    plan.targets.map((a) => [a.id, a.verificationStatus]),
  );

  await recordAlertActionsBatch(
    updated.map((row) => ({
      alertId: row.alertId,
      action: "VERIFY" as const,
      actorId: data.actorId,
      actorName: data.actorName,
      previousVerificationStatus: previous.get(row.id) ?? null,
      newVerificationStatus: data.status,
      note: data.note,
      metadata: {
        incidentId: data.incidentId,
        reasonCode: data.reasonCode,
        bulk: true,
        onlyUnverified: data.onlyUnverified,
      },
    })),
  );
  await publishAlertsVerifiedBatch(updated);
  return { updated: updated.length, skipped: found.length - updated.length };
}

/** Seluruh pekerjaan, kelompok demi kelompok. Dipakai worker; `onProgress` mendapat 0–100. */
export async function runVerifyJob(
  data: VerifyJobData,
  onProgress?: (percent: number) => Promise<void> | void,
): Promise<VerifyJobResult> {
  const groups = chunk(data.alertIds, VERIFY_BATCH_SIZE);
  let updated = 0;
  let skipped = 0;
  let done = 0;
  for (const group of groups) {
    const r = await applyVerifyChunk(group, data);
    updated += r.updated;
    skipped += r.skipped;
    done += group.length;
    await onProgress?.(Math.round((done / data.alertIds.length) * 100));
  }
  forgetIncidentCache();
  return { total: data.alertIds.length, updated, skipped };
}

/**
 * Terima permintaan verifikasi satu kejadian: periksa dan rencanakan sekarang (cepat, satu SELECT), lalu serahkan pekerjaannya ke antrean
 * supaya permintaan HTTP tidak menunggu puluhan atau ratusan UPDATE. Bila antrean (Redis) tidak bisa dipakai, dikerjakan di tempat
 * dengan cara berkelompok yang sama.
 */
export async function requestVerifyIncidents(
  input: VerifyIncidentsInput,
  actor?: UserActor,
): Promise<VerifyIncidentsAccepted> {
  const found = await findAlertsByAlertIds(input.alertIds);
  if (found.length === 0) {
    throw new ApiError("NOT_FOUND", { message: "Alert not found" });
  }

  const note = composeVerificationNote(input.reasonCode, input.note);
  const plan = planVerification(found, {
    status: input.status,
    note,
    onlyUnverified: input.onlyUnverified,
  });
  if (plan.needsCriticalConfirmation && !input.confirmCritical) {
    throw new ApiError("BAD_REQUEST", {
      message:
        "Kejadian ini memuat alert Critical: konfirmasi eksplisit diperlukan (confirmCritical)",
    });
  }

  const accepted = plan.targets.length;
  const skipped = input.alertIds.length - accepted;
  if (accepted === 0) {
    return {
      queued: false,
      jobId: null,
      total: input.alertIds.length,
      accepted,
      skipped,
      updated: 0,
    };
  }

  const data: VerifyJobData = {
    alertIds: plan.targets.map((a) => a.alertId),
    incidentId: input.incidentId ?? null,
    status: input.status,
    reasonCode: input.reasonCode ?? null,
    note,
    onlyUnverified: input.onlyUnverified,
    actorId: actor?.id ?? null,
    actorName: input.verifiedBy ?? actor?.name ?? actor?.username ?? "system",
  };

  try {
    const jobId = await enqueueVerifyIncidents(data);
    return {
      queued: true,
      jobId,
      total: input.alertIds.length,
      accepted,
      skipped,
    };
  } catch (err) {
    logger.warn({ err }, "verify queue unavailable, verifying in place");
    const result = await runVerifyJob(data);
    return {
      queued: false,
      jobId: null,
      total: input.alertIds.length,
      accepted,
      skipped,
      updated: result.updated,
    };
  }
}

export async function verifyJobStatusService(
  jobId: string,
): Promise<VerifyJobStatus> {
  const status = await getVerifyJobStatus(jobId);
  if (!status) {
    throw new ApiError("NOT_FOUND", { message: "Verification job not found" });
  }
  return status;
}
