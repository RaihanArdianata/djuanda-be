import { redisConfig } from "@repo/config";
import { db, playbackFiles } from "@repo/database";
import { logger } from "@repo/logger";
import ApiError from "@repo/shared/api-error";
import { UnrecoverableError, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { processPlaybackFile } from "./playback-files.service";

export const playbackFileWorker = new Worker(
  "playback-file-management",
  async (job) => {
    const fileId = String(job.data.fileId);
    await db
      .update(playbackFiles)
      .set({
        status: "processing",
        progress: 0,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(playbackFiles.id, fileId));

    try {
      await processPlaybackFile(fileId, async (progress) => {
        await job.updateProgress(progress);
        await db
          .update(playbackFiles)
          .set({ progress, updatedAt: new Date() })
          .where(eq(playbackFiles.id, fileId));
      });
    } catch (error) {
      if (error instanceof ApiError)
        throw new UnrecoverableError(error.message);
      throw error;
    }
  },
  { connection: redisConfig, concurrency: 2 },
);
playbackFileWorker.on("error", (error) => {
  logger.error({ err: error }, "Playback file worker error");
});

playbackFileWorker.on("failed", async (job, error) => {
  if (!job) return;
  const attempts = Number(job.opts.attempts ?? 1);
  const exhausted = job.attemptsMade >= attempts || (await job.isFailed());
  if (!exhausted) return;

  logger.error({ err: error }, "Playback file processing failed");
  const message =
    error instanceof UnrecoverableError
      ? error.message
      : "Playback file processing failed";

  try {
    await db
      .update(playbackFiles)
      .set({
        status: "failed",
        errorMessage: message.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(playbackFiles.id, String(job.data.fileId)));
  } catch (updateError) {
    logger.error(
      { err: updateError },
      "Could not persist playback file failure",
    );
  }
});
