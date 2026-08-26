import { logger } from "@repo/logger";
import { fetchNotamHistories } from "../../client/navsim.client";
import type { NormalizedNotamMessage, NotamSourceItem } from "../parser/common";
import { parseNotamMessage } from "../parser/notam.parser";
import {
  type NotamUpsertOutcome,
  upsertNotamMessage,
} from "../repository/notam.repository";
import {
  loadNotamFromMockSource,
  type NotamSource,
} from "../source/notam.source";

const NOTAM_HISTORY_SIZE = 2000;

export const NOTAM_MOCK_SOURCE = "notam-mock";

export interface NotamSyncResult {
  totalReceived: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

const emptyNotamSyncResult = (): NotamSyncResult => ({
  totalReceived: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
});

export interface SyncNotamFromSourceDeps {
  loadSource?: NotamSource;
  upsert?: (
    message: NormalizedNotamMessage,
    options: { source: string },
  ) => Promise<NotamUpsertOutcome>;
  source?: string;
}

const persistNotamItem = async (
  item: NotamSourceItem,
  upsert: NonNullable<SyncNotamFromSourceDeps["upsert"]>,
  source: string,
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
    const outcome = await upsert(parsed.message, { source });
    result[outcome] += 1;
  } catch (err) {
    result.failed += 1;
    logger.error(
      { err, providerId: parsed.message.providerId },
      "failed to persist notam message",
    );
  }
};

export const syncNotamFromSource = async (
  deps: SyncNotamFromSourceDeps = {},
): Promise<NotamSyncResult> => {
  const loadSource = deps.loadSource ?? loadNotamFromMockSource;
  const upsert = deps.upsert ?? upsertNotamMessage;
  const source = deps.source ?? NOTAM_MOCK_SOURCE;

  const startedAt = Date.now();
  const items = await loadSource();
  const result = emptyNotamSyncResult();
  result.totalReceived = items.length;

  for (const item of items) {
    await persistNotamItem(item, upsert, source, result);
  }

  logger.info(
    {
      source,
      durationMs: Date.now() - startedAt,
      ...result,
    },
    "notam synchronization finished",
  );

  return result;
};

export async function getNotamHistories(): Promise<unknown> {
  return fetchNotamHistories(NOTAM_HISTORY_SIZE);
}
