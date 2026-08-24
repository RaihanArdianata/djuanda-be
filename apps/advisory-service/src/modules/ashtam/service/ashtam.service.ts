import { logger } from "@repo/logger";
import { fetchAshtamHistories } from "../../client/navsim.client";
import { parseAshtamMessage } from "../parser/ashtam.parser";
import type {
  AshtamSourceItem,
  NormalizedAshtamMessage,
} from "../parser/common";
import {
  type AshtamUpsertOutcome,
  upsertAshtamMessage,
} from "../repository/ashtam.repository";
import {
  type AshtamSource,
  loadAshtamFromMockSource,
} from "../source/ashtam.source";

const DEFAULT_ASHTAM_HISTORY_SIZE = 2000;

/** Source name used while the real provider (`/api/token` + `/api/ashtam`)
 * is unavailable. Once the provider comes back, synchronization can switch
 * to a provider-backed `AshtamSource` (e.g. `ASHTAM_PROVIDER_SOURCE`)
 * without touching the parser or repository. */
export const ASHTAM_MOCK_SOURCE = "ashtam-mock";

export interface AshtamSyncResult {
  totalReceived: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

const emptyAshtamSyncResult = (): AshtamSyncResult => ({
  totalReceived: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
});

export interface SyncAshtamFromSourceDeps {
  /** Defaults to reading `src/source/ashtam.json`. */
  loadSource?: AshtamSource;
  /** Defaults to the real DB-backed upsert; overridable for tests. */
  upsert?: (
    message: NormalizedAshtamMessage,
    options: { source: string; providerRaw: Record<string, unknown> },
  ) => Promise<AshtamUpsertOutcome>;
  source?: string;
}

const persistAshtamItem = async (
  item: AshtamSourceItem,
  upsert: NonNullable<SyncAshtamFromSourceDeps["upsert"]>,
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
    const outcome = await upsert(parsed.message, {
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

/**
 * source loader → parser → validation → normalization → repository upsert.
 *
 * One failing item never aborts the whole run — failures are counted and
 * logged, and every other valid item still gets synchronized.
 */
export const syncAshtamFromSource = async (
  deps: SyncAshtamFromSourceDeps = {},
): Promise<AshtamSyncResult> => {
  const loadSource = deps.loadSource ?? loadAshtamFromMockSource;
  const upsert = deps.upsert ?? upsertAshtamMessage;
  const source = deps.source ?? ASHTAM_MOCK_SOURCE;

  const startedAt = Date.now();
  const items = await loadSource();
  const result = emptyAshtamSyncResult();
  result.totalReceived = items.length;

  for (const item of items) {
    await persistAshtamItem(item, upsert, source, result);
  }

  logger.info(
    {
      source,
      durationMs: Date.now() - startedAt,
      ...result,
    },
    "ashtam synchronization finished",
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
