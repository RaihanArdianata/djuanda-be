import { logger } from "@repo/logger";
import { env } from "@/config/env";
import { resolveIncrementalWindow } from "../../aftn/service/aftn.service";
import { fetchNotamHistories } from "../../client/navsim.client";
import type { NotamSourceItem } from "../../notam-trigger/parser/common";
import { parseNotamMessage } from "../../notam-trigger/parser/notam.parser";
import {
  findLatestNotamDatetime,
  upsertNotamMessage,
} from "../../notam-trigger/repository/notam.repository";

import { fetchNotamMessages } from "../../provider/notam.provider";

const NOTAM_HISTORY_SIZE = 2000;
const NOTAM_PROVIDER_SOURCE = "advisory-provider-notam";

export async function getNotamHistories(): Promise<unknown> {
  return fetchNotamHistories(NOTAM_HISTORY_SIZE);
}
export interface NotamSyncResult {
  totalReceived: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

export interface NotamSyncWindow {
  startDate: Date;
  endDate: Date;
}

const emptyNotamSyncResult = (): NotamSyncResult => ({
  totalReceived: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
});

const persistNotamItem = async (
  item: NotamSourceItem,
  result: NotamSyncResult,
): Promise<void> => {
  const parsed = parseNotamMessage(item);

  if (!parsed.ok) {
    result.failed += 1;
    logger.warn(
      { reason: parsed.reason, item },
      "notam item rejected during validation",
    );
    return;
  }

  try {
    const outcome = await upsertNotamMessage(parsed.message, {
      source: NOTAM_PROVIDER_SOURCE,
    });
    result[outcome] += 1;
  } catch (err) {
    result.failed += 1;
    logger.error(
      { err, providerId: parsed.message.providerId },
      "failed to persist notam message",
    );
  }
};
export const syncNotamWindow = async (
  window: NotamSyncWindow,
): Promise<NotamSyncResult> => {
  const startedAt = Date.now();
  const items = await fetchNotamMessages(window);
  const result = emptyNotamSyncResult();
  result.totalReceived = items.length;

  for (const item of items) {
    await persistNotamItem(item, result);
  }

  logger.info(
    {
      source: NOTAM_PROVIDER_SOURCE,
      startDate: window.startDate.toISOString(),
      endDate: window.endDate.toISOString(),
      durationMs: Date.now() - startedAt,
      ...result,
    },
    "notam synchronization finished",
  );

  return result;
};
export const syncNotamIncremental = async (): Promise<NotamSyncResult> => {
  const latestStoredAt = await findLatestNotamDatetime();
  const window = resolveIncrementalWindow(
    latestStoredAt,
    new Date(),
    env.ADVISORY_NOTAM_SYNC_INTERVAL_MS,
    env.ADVISORY_SYNC_OVERLAP_MS,
  );

  return await syncNotamWindow(window);
};
