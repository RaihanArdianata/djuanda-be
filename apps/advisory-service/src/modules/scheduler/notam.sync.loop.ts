import { logger } from "@repo/logger";
import cron, { type ScheduledTask } from "node-cron";
import { env } from "@/config/env";
import { syncNotamFromSource } from "../notam/service/notam.service";
import { intervalMsToCronExpression } from "./sync.loop";

let notamTask: ScheduledTask | null = null;

export const runNotamSyncCycle = async (): Promise<void> => {
  try {
    await syncNotamFromSource();
  } catch (err) {
    logger.error({ err }, "notam synchronization cycle failed");

    throw err;
  }
};

export const startNotamSync = (): void => {
  if (!env.ADVISORY_NOTAM_SYNC_ENABLED) {
    logger.warn(
      "notam synchronization disabled via ADVISORY_NOTAM_SYNC_ENABLED",
    );
    return;
  }

  const expression = intervalMsToCronExpression(
    env.ADVISORY_NOTAM_SYNC_INTERVAL_MS,
  );

  notamTask = cron.schedule(expression, runNotamSyncCycle, {
    name: "notam-sync",
    noOverlap: true,
  });

  void notamTask.execute();

  logger.info(
    { expression, intervalMs: env.ADVISORY_NOTAM_SYNC_INTERVAL_MS },
    "notam synchronization scheduled",
  );
};

export const stopNotamSync = (): void => {
  if (notamTask) {
    void notamTask.destroy();
    notamTask = null;
  }
};
