import { logger } from "@repo/logger";
import { resolveIncrementalWindow } from "../../aftn/service/aftn.service";
import { fetchNotamHistories } from "../../client/navsim.client";
import {
  type NotamEventType,
  publishNotamEvent,
} from "../../messaging/advisory.producer";
import { fetchNotamMessages } from "../../provider/notam.provider";
import type { NormalizedNotamMessage, NotamSourceItem } from "../parser/common";
import { parseNotamMessage } from "../parser/notam.parser";
import {
  findLatestNotamDatetime,
  type NotamUpsertOutcome,
  upsertNotamMessage,
} from "../repository/notam.repository";
import {
  loadNotamFromMockSource,
  type NotamSource,
} from "../source/notam.source";

const NOTAM_HISTORY_SIZE = 2000;

export const NOTAM_MOCK_SOURCE = "notam-mock";

export const NOTAM_PROVIDER_SOURCE = "advisory-provider-notam";

const outcomeToEventType: Record<"created" | "updated", NotamEventType> = {
  created: "NOTAM_RECEIVED",
  updated: "NOTAM_UPDATED",
};

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

export interface SyncNotamInput {
  startDate: Date;
  endDate: Date;
}

const persistNotamProviderItem = async (
  item: NotamSourceItem,
  result: NotamSyncResult,
): Promise<void> => {
  const parsed = parseNotamMessage(item);

  if (!parsed.ok) {
    result.failed += 1;
    logger.warn(
      { reason: parsed.reason, item },
      "notam message rejected during validation",
    );
    return;
  }

  try {
    const outcome = await upsertNotamMessage(parsed.message, {
      source: NOTAM_PROVIDER_SOURCE,
    });
    result[outcome] += 1;

    if (outcome === "created" || outcome === "updated") {
      const eventType = outcomeToEventType[outcome];
      const airportId = parsed.message.icaoLocation;

      if (airportId) {
        await publishNotamEvent(eventType, airportId);
      }
    }
  } catch (err) {
    result.failed += 1;
    logger.error(
      { err, providerId: parsed.message.providerId },
      "failed to persist notam message",
    );
  }
};

export const syncNotamWindow = async (
  startDate: Date,
  endDate: Date,
): Promise<NotamSyncResult> => {
  const startedAt = Date.now();
  const items = await fetchNotamMessages({ startDate, endDate });
  const result = emptyNotamSyncResult();
  result.totalReceived = items.length;

  for (const item of items) {
    await persistNotamProviderItem(item, result);
  }

  logger.info(
    {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      durationMs: Date.now() - startedAt,
      ...result,
    },
    "notam synchronization finished",
  );

  return result;
};

export const syncNotam = async (
  input: SyncNotamInput,
): Promise<NotamSyncResult> =>
  await syncNotamWindow(input.startDate, input.endDate);

export const syncNotamIncremental = async (): Promise<NotamSyncResult> => {
  const latestStoredAt = await findLatestNotamDatetime();
  const window = resolveIncrementalWindow(latestStoredAt);

  return await syncNotamWindow(window.startDate, window.endDate);
};

export async function getNotamHistories(): Promise<unknown> {
  return fetchNotamHistories(NOTAM_HISTORY_SIZE);
}
