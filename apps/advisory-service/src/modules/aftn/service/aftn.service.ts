import type { AftnMessage } from "@repo/database";
import { logger } from "@repo/logger";
import { ApiError } from "@repo/shared";
import { env } from "@/config/env";
import {
  type AftnProviderItem,
  fetchAftnMessages,
} from "../../provider/aftn.provider";
import { parseAftnMessage } from "../parser/aftn.parser";
import {
  findAftnMessageById,
  findLatestAftnDatetime,
  listAftnMessages,
  upsertAftnMessage,
} from "../repository/aftn.repository";
import type {
  ListAftnQueryInput,
  SyncAftnInput,
} from "../validator/aftn.validator";

export const AFTN_SOURCE = "navsim-aftn";

export interface AftnSyncResult {
  totalReceived: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

export interface AftnSyncWindow {
  startDate: Date;
  endDate: Date;
}

export const resolveIncrementalWindow = (
  latestStoredAt: Date | null,
  now: Date = new Date(),
  intervalMs: number = env.ADVISORY_SYNC_INTERVAL_MS,
  overlapMs: number = env.ADVISORY_SYNC_OVERLAP_MS,
): AftnSyncWindow => {
  const fallbackStart = new Date(now.getTime() - intervalMs);
  const base = latestStoredAt ?? fallbackStart;
  const startCandidate = new Date(base.getTime() - overlapMs);

  const startDate =
    startCandidate.getTime() < fallbackStart.getTime()
      ? startCandidate
      : fallbackStart;

  return { startDate, endDate: now };
};

const emptyResult = (): AftnSyncResult => ({
  totalReceived: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
});

const persistItem = async (
  item: AftnProviderItem,
  result: AftnSyncResult,
): Promise<void> => {
  const parsed = parseAftnMessage(item);

  if (!parsed.ok) {
    result.failed += 1;
    logger.warn(
      { reason: parsed.reason, item },
      "aftn message rejected during validation",
    );
    return;
  }

  if (!parsed.parserSupported) {
    logger.warn(
      { messageType: parsed.message.messageType },
      "aftn message type has no dedicated parser, stored with common fields only",
    );
  }

  try {
    const outcome = await upsertAftnMessage(parsed.message, {
      source: AFTN_SOURCE,
      providerRaw: item as Record<string, unknown>,
    });
    result[outcome] += 1;
  } catch (err) {
    result.failed += 1;
    logger.error(
      { err, messageType: parsed.message.messageType },
      "failed to persist aftn message",
    );
  }
};

export const syncAftnWindow = async (
  window: AftnSyncWindow,
): Promise<AftnSyncResult> => {
  const startedAt = Date.now();
  const items = await fetchAftnMessages(window);
  const result = emptyResult();
  result.totalReceived = items.length;

  for (const item of items) {
    await persistItem(item, result);
  }

  logger.info(
    {
      startDate: window.startDate.toISOString(),
      endDate: window.endDate.toISOString(),
      durationMs: Date.now() - startedAt,
      ...result,
    },
    "aftn synchronization finished",
  );

  return result;
};

export const syncAftn = async (input: SyncAftnInput): Promise<AftnSyncResult> =>
  await syncAftnWindow({
    startDate: input.startDate,
    endDate: input.endDate,
  });

export const syncAftnIncremental = async (): Promise<AftnSyncResult> => {
  const latestStoredAt = await findLatestAftnDatetime();
  const window = resolveIncrementalWindow(latestStoredAt);

  return await syncAftnWindow(window);
};

export interface ListAftnResponse {
  items: AftnMessage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const getAftnMessages = async (
  params: ListAftnQueryInput,
): Promise<ListAftnResponse> => {
  const { items, total } = await listAftnMessages(params);

  return {
    items,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / params.limit),
  };
};

export const getAftnMessageById = async (id: string): Promise<AftnMessage> => {
  const message = await findAftnMessageById(id);

  if (!message) {
    throw new ApiError("NOT_FOUND", { message: "AFTN message not found" });
  }

  return message;
};
