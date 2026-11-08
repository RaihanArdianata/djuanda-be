import { redisConfig } from "@repo/config";
import { logger } from "@repo/logger";
import { Queue } from "bullmq";
import type { VerifyJobData } from "./verify-incidents.types";

export const VERIFY_QUEUE_NAME = "alert-verify-incidents";

let queue: Queue<VerifyJobData> | undefined;

function getQueue(): Queue<VerifyJobData> {
  if (!queue) {
    queue = new Queue<VerifyJobData>(VERIFY_QUEUE_NAME, {
      connection: redisConfig,
      defaultJobOptions: {
        // Gangguan DB atau Redis sesaat: coba lagi. Aman diulang karena bagian yang sudah tersimpan dilewati.
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: 3_600, count: 200 },
        removeOnFail: { age: 86_400 },
      },
    });
    queue.on("error", (err) => {
      logger.error({ err }, "verify incidents queue error");
    });
  }
  return queue;
}

/** Masukkan verifikasi massal ke antrean; mengembalikan id pekerjaan. Melempar bila antrean (Redis) tidak bisa dipakai. */
export async function enqueueVerifyIncidents(
  data: VerifyJobData,
): Promise<string> {
  const job = await getQueue().add("verify", data);
  return String(job.id);
}

export interface VerifyJobStatus {
  /** waiting, active, completed, failed, delayed, atau unknown (tidak ditemukan atau sudah dibersihkan). */
  state: string;
  /** 0–100. */
  progress: number;
  total: number;
  updated: number;
  failedReason?: string;
}

export async function getVerifyJobStatus(
  jobId: string,
): Promise<VerifyJobStatus | undefined> {
  const job = await getQueue().getJob(jobId);
  if (!job) return undefined;
  const state = await job.getState();
  const result = job.returnvalue as { updated?: number } | undefined;
  return {
    state,
    progress: typeof job.progress === "number" ? job.progress : 0,
    total: job.data.alertIds.length,
    updated: result?.updated ?? 0,
    failedReason: job.failedReason || undefined,
  };
}

export async function closeVerifyIncidentsQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
