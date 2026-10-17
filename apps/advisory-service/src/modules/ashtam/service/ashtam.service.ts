import type { AshtamMessage } from "@repo/database";
import { logger } from "@repo/logger";
import ApiError from "@repo/shared/api-error";
import { env } from "@/config/env";
import { fetchAshtamHistories } from "../../client/navsim.client";
import {
  type FetchAshtamParams,
  fetchAshtamMessages,
} from "../../provider/ashtam.provider";
// `resolveIncrementalWindow` is a pure windowing helper (latest stored
// datetime + overlap → [startDate, endDate]) with no AFTN-specific logic.
// Reused as-is per "jangan membuat duplicate implementation" — ASHTAM does
// not get its own copy.
import { resolveIncrementalWindow } from "../../scheduler/sync.utils";
import { parseAshtamMessage } from "../parser/ashtam.parser";
import type { AshtamSourceItem } from "../parser/common";
import {
  findAshtamMessageById,
  findLatestAshtamDatetime,
  listActiveAshtamMessages,
  listAshtamMessages,
  upsertAshtamMessage,
} from "../repository/ashtam.repository";
import {
  type AshtamSource,
  loadAshtamFromMockSource,
} from "../source/ashtam.source";
import type { ListAshtamQueryInput } from "../validator/ashtam.query.schema";

const DEFAULT_ASHTAM_HISTORY_SIZE = 2000;

/** Source tag written to `ashtamMessages.source` for records that came from
 * the real provider (`/api/token` + `/api/ashtam`), mirroring
 * `AFTN_SOURCE` / `NOTAM_PROVIDER_SOURCE`. This is what production sync
 * uses now that the provider is back online. */
export const ASHTAM_PROVIDER_SOURCE = "advisory-provider-ashtam";
export const ASHTAM_MOCK_SOURCE = "ashtam-mock";

export interface AshtamSyncResult {
  totalReceived: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

export interface AshtamSyncWindow {
  startDate: Date;
  endDate: Date;
}

const emptyAshtamSyncResult = (): AshtamSyncResult => ({
  totalReceived: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
});

const persistAshtamItem = async (
  item: AshtamSourceItem,
  source: string,
  result: AshtamSyncResult,
): Promise<void> => {
  const parsed = parseAshtamMessage(item);

  if (!parsed.ok) {
    result.failed += 1;
    logger.warn(
      { reason: parsed.reason, item },
      "ashtam item rejected during validation",
    );
    return;
  }

  try {
    const outcome = await upsertAshtamMessage(parsed.message, {
      source,
      providerRaw: item as Record<string, unknown>,
    });
    result[outcome] += 1;
  } catch (err) {
    result.failed += 1;
    logger.error(
      { err, providerId: parsed.message.providerId },
      "failed to persist ashtam message",
    );
  }
};

export const syncAshtamWindow = async (
  window: AshtamSyncWindow,
): Promise<AshtamSyncResult> => {
  const startedAt = Date.now();
  const items = await fetchAshtamMessages(window);
  const result = emptyAshtamSyncResult();
  result.totalReceived = items.length;

  for (const item of items) {
    await persistAshtamItem(item, ASHTAM_PROVIDER_SOURCE, result);
  }

  logger.info(
    {
      source: ASHTAM_PROVIDER_SOURCE,
      startDate: window.startDate.toISOString(),
      endDate: window.endDate.toISOString(),
      durationMs: Date.now() - startedAt,
      ...result,
    },
    "ashtam synchronization finished",
  );

  return result;
};

export const syncAshtam = async (
  input: FetchAshtamParams,
): Promise<AshtamSyncResult> =>
  await syncAshtamWindow({
    startDate: input.startDate,
    endDate: input.endDate,
  });

export const syncAshtamIncremental = async (): Promise<AshtamSyncResult> => {
  const latestStoredAt = await findLatestAshtamDatetime();
  const window = resolveIncrementalWindow(
    latestStoredAt,
    new Date(),
    env.ADVISORY_ASHTAM_SYNC_INTERVAL_MS,
    env.ADVISORY_SYNC_OVERLAP_MS,
  );

  return await syncAshtamWindow(window);
};

export interface SyncAshtamFromMockDeps {
  /** Defaults to reading `src/source/ashtam.json`. Test/dev fixture only —
   * not used by production sync (see `syncAshtamIncremental`). */
  loadSource?: AshtamSource;
  source?: string;
}

export const syncAshtamFromMockSource = async (
  deps: SyncAshtamFromMockDeps = {},
): Promise<AshtamSyncResult> => {
  const loadSource = deps.loadSource ?? loadAshtamFromMockSource;
  const source = deps.source ?? ASHTAM_MOCK_SOURCE;

  const startedAt = Date.now();
  const items = await loadSource();
  const result = emptyAshtamSyncResult();
  result.totalReceived = items.length;

  for (const item of items) {
    await persistAshtamItem(item, source, result);
  }

  logger.info(
    {
      source,
      durationMs: Date.now() - startedAt,
      ...result,
    },
    "ashtam mock synchronization finished",
  );

  return result;
};

export interface GetAshtamHistoriesOptions {
  size?: number;
  startDateTimeLessThan?: string;
}

export async function getAshtamHistories(
  options: GetAshtamHistoriesOptions = {},
): Promise<unknown> {
  return fetchAshtamHistories({
    size: options.size ?? DEFAULT_ASHTAM_HISTORY_SIZE,
    startDateTimeLessThan: options.startDateTimeLessThan,
  });
}

export interface ListAshtamResponse {
  items: AshtamMessage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const getAshtamMessages = async (
  params: ListAshtamQueryInput,
): Promise<ListAshtamResponse> => {
  const { items, total } = await listAshtamMessages(params);

  return {
    items,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / params.limit),
  };
};

export const getAshtamMessageById = async (
  id: string,
): Promise<AshtamMessage> => {
  const message = await findAshtamMessageById(id);

  if (!message) {
    throw new ApiError("NOT_FOUND", {
      message: `ASHTAM dengan id ${id} tidak ditemukan`,
    });
  }

  return message;
};

export const getActiveAshtamMessages = async (): Promise<AshtamMessage[]> =>
  await listActiveAshtamMessages();
