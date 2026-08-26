import { logger } from "@repo/logger";
import cron, { type ScheduledTask } from "node-cron";
import { env } from "@/config/env";
import { syncAftnIncremental } from "../aftn/service/aftn.service";

export const intervalMsToCronExpression = (intervalMs: number): string => {
  if (intervalMs <= 0 || intervalMs % 60_000 !== 0) {
    throw new Error(
      `Sync interval must be a whole number of minutes, got ${intervalMs}ms`,
    );
  }

  const minutes = intervalMs / 60_000;

  if (minutes >= 60) {
    if (minutes % 60 !== 0) {
      throw new Error(
        `Sync interval over an hour must be a multiple of 60 minutes, got ${minutes}m`,
      );
    }
    return `0 */${minutes / 60} * * *`;
  }

  if (60 % minutes !== 0) {
    throw new Error(
      `Sync interval must evenly divide 60 minutes for a cron schedule, got ${minutes}m`,
    );
  }

  return `*/${minutes} * * * *`;
};

let aftnTask: ScheduledTask | null = null;

export const runAftnSyncCycle = async (): Promise<void> => {
  try {
    await syncAftnIncremental();
  } catch (err) {
    logger.error({ err }, "aftn synchronization cycle failed");
  }
};

export const startAdvisorySync = (): void => {
  if (!env.ADVISORY_SYNC_ENABLED) {
    logger.warn("advisory synchronization disabled via ADVISORY_SYNC_ENABLED");
    return;
  }

  const expression = intervalMsToCronExpression(env.ADVISORY_SYNC_INTERVAL_MS);

  aftnTask = cron.schedule(expression, runAftnSyncCycle, {
    name: "aftn-sync",
    noOverlap: true,
  });

  void aftnTask.execute();

  logger.info(
    { expression, intervalMs: env.ADVISORY_SYNC_INTERVAL_MS },
    "advisory synchronization scheduled",
  );
};

export const stopAdvisorySync = (): void => {
  if (aftnTask) {
    void aftnTask.destroy();
    aftnTask = null;
  }
};
