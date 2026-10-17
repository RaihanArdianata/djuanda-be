import { logger } from "@repo/logger";
import cron, { type ScheduledTask } from "node-cron";
import { env } from "@/config/env";
import { syncAshtamIncremental } from "../ashtam/service/ashtam.service";
import { intervalMsToCronExpression } from "./sync.utils";

let ashtamTask: ScheduledTask | null = null;

export const runAshtamSyncCycle = async (): Promise<void> => {
  try {
    await syncAshtamIncremental();
  } catch (err) {
    logger.error({ err }, "ashtam synchronization cycle failed");
  }
};
export const startAshtamSync = (): void => {
  if (!env.ADVISORY_ASHTAM_SYNC_ENABLED) {
    logger.warn(
      "ashtam synchronization disabled via ADVISORY_ASHTAM_SYNC_ENABLED",
    );
    return;
  }

  const expression = intervalMsToCronExpression(
    env.ADVISORY_ASHTAM_SYNC_INTERVAL_MS,
  );

  ashtamTask = cron.schedule(expression, runAshtamSyncCycle, {
    name: "ashtam-sync",
    noOverlap: true,
  });

  void ashtamTask.execute();

  logger.info(
    { expression, intervalMs: env.ADVISORY_ASHTAM_SYNC_INTERVAL_MS },
    "ashtam synchronization scheduled",
  );
};

export const stopAshtamSync = (): void => {
  if (ashtamTask) {
    void ashtamTask.destroy();
    ashtamTask = null;
  }
};
