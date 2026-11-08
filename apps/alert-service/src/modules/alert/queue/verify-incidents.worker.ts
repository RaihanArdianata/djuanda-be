import { redisConfig } from "@repo/config";
import { logger } from "@repo/logger";
import { Worker } from "bullmq";
import { runVerifyJob } from "../service/verify-incidents.service";
import { VERIFY_QUEUE_NAME } from "./verify-incidents.queue";
import type { VerifyJobData, VerifyJobResult } from "./verify-incidents.types";

let worker: Worker<VerifyJobData, VerifyJobResult> | undefined;

/**
 * Pekerja antrean verifikasi massal. Satu pekerjaan pada satu waktu: verifikasi tidak boleh berebut baris yang sama, dan beban
 * ke database tetap kecil (satu UPDATE dan satu INSERT per 100 alert).
 */
export async function startVerifyIncidentsWorker(): Promise<void> {
  if (worker) return;
  worker = new Worker<VerifyJobData, VerifyJobResult>(
    VERIFY_QUEUE_NAME,
    async (job) =>
      await runVerifyJob(job.data, async (percent) => {
        await job.updateProgress(percent);
      }),
    { connection: redisConfig, concurrency: 1 },
  );
  worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, updated: result.updated, skipped: result.skipped },
      "bulk verification finished",
    );
  });
  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "bulk verification failed");
  });
  worker.on("error", (err) => {
    logger.error({ err }, "verify incidents worker error");
  });
}

export async function stopVerifyIncidentsWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = undefined;
}
