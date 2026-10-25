import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { db, playbackFiles } from "@repo/database";
import { logger } from "@repo/logger";
import ApiError from "@repo/shared/api-error";
import { and, eq, gte, ilike, lte, max, or, sql } from "drizzle-orm";
import { redis } from "../../redis/client";
import type { TimelineEvent } from "../schema/playback.schema";
import { loadTimeline } from "../services/playback-data.service";
import {
  createPbkImporter,
  type ImportSource,
  objectKey,
  type PbkFileInsert,
} from "./playback-files.import";
import { parsePbkWithHeader } from "./playback-files.pbk";
import { getPlaybackFileQueue } from "./playback-files.queue";
import {
  ensurePlaybackBucket,
  isMissingObjectError,
  minio,
  playbackBucket,
} from "./storage";

export type PlaybackFileStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "failed";
export type PlaybackSource = ImportSource;
type PlaybackFileRow = typeof playbackFiles.$inferSelect;

const fail = (
  message: string,
  code: "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT" = "BAD_REQUEST",
): ApiError => new ApiError(code, { message });

async function readStoredObject(key: string): Promise<Buffer> {
  try {
    const stream = await minio.getObject(playbackBucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch (error) {
    if (isMissingObjectError(error))
      throw fail("Stored playback object was not found", "NOT_FOUND");
    throw error;
  }
}

export async function createGeneratedFile(input: {
  airportId: string;
  from: Date;
  to: Date;
  displayName?: string;
  notes?: string;
}): Promise<PlaybackFileRow> {
  if (input.from >= input.to) throw fail("`from` must be before `to`");
  const id = randomUUID();
  const storageKey = objectKey(
    id,
    `${input.airportId}-${input.from.toISOString()}-${input.to.toISOString()}.pbk`,
  );
  const [file] = await db
    .insert(playbackFiles)
    .values({
      id,
      airportId: input.airportId,
      kind: "generated",
      displayName:
        input.displayName ??
        `${input.airportId} ${input.from.toISOString()} – ${input.to.toISOString()}`,
      notes: input.notes,
      source: "asmgcs",
      status: "processing",
      progress: 0,
      storageKey,
      requestedFrom: input.from,
      requestedTo: input.to,
    })
    .returning();
  if (!file)
    throw new ApiError("INTERNAL_ERROR", {
      message: "Could not create playback file",
    });
  try {
    await getPlaybackFileQueue().add(
      "generate",
      { fileId: id },
      {
        jobId: `generate-${id}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  } catch (error) {
    await db
      .update(playbackFiles)
      .set({
        status: "failed",
        errorMessage: "Could not enqueue recording generation",
        updatedAt: new Date(),
      })
      .where(eq(playbackFiles.id, id));
    throw error;
  }
  return file;
}

// Upload -> row (`processing`) -> `scan` job. The file body comes from the
// backend request; storage is only ever reached through this process.
export const importPlaybackFile = createPbkImporter({
  newId: randomUUID,
  ensureBucket: ensurePlaybackBucket,
  putObject: async (
    key: string,
    body: Readable,
    size: number,
    contentType: string,
  ): Promise<void> => {
    await minio.putObject(playbackBucket, key, body, size, {
      "Content-Type": contentType,
    });
  },
  removeObject: (key: string): Promise<void> =>
    minio.removeObject(playbackBucket, key),
  insertFile: async (values: PbkFileInsert) => {
    const [file] = await db
      .insert(playbackFiles)
      .values({
        ...values,
        kind: "imported",
        status: "processing",
        progress: 0,
      })
      .returning();
    return file;
  },
  deleteFile: async (id: string): Promise<void> => {
    await db.delete(playbackFiles).where(eq(playbackFiles.id, id));
  },
  markFileFailed: async (id: string, message: string): Promise<void> => {
    await db
      .update(playbackFiles)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(playbackFiles.id, id));
  },
  enqueueScan: async (fileId: string): Promise<void> => {
    await getPlaybackFileQueue().add(
      "scan",
      { fileId },
      {
        jobId: `scan-${fileId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  },
});

export function toPublicPlaybackFile<T extends { storageKey: string }>(
  file: T,
): Omit<T, "storageKey"> {
  const { storageKey: _storageKey, ...publicFile } = file;
  return publicFile;
}

export async function getPlaybackFile(
  id: string,
): Promise<PlaybackFileRow | null> {
  const [file] = await db
    .select()
    .from(playbackFiles)
    .where(eq(playbackFiles.id, id))
    .limit(1);
  return file ?? null;
}

export async function processPlaybackFile(
  fileId: string,
  updateProgress: (progress: number) => Promise<void>,
): Promise<void> {
  const file = await getPlaybackFile(fileId);
  if (!file) throw fail(`Playback file ${fileId} not found`, "NOT_FOUND");
  await ensurePlaybackBucket();
  if (file.kind === "generated") {
    if (!file.requestedFrom || !file.requestedTo)
      throw fail("Generated file has no requested time range");
    const events = await loadTimeline(
      file.airportId,
      file.requestedFrom,
      file.requestedTo,
    );
    if (events.length === 0)
      throw fail("No playback events found in the requested time range");
    await updateProgress(20);
    const header = {
      type: "metadata",
      format: "pbk",
      version: 1,
      airportId: file.airportId,
      source: "asmgcs",
      from: file.requestedFrom.toISOString(),
      to: file.requestedTo.toISOString(),
      generatedAt: new Date().toISOString(),
    };
    const lines = `${[
      JSON.stringify(header),
      ...events.map((event) => JSON.stringify(event)),
    ].join("\n")}\n`;
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      const gzip = createGzip();
      const chunks: Buffer[] = [];
      gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
      gzip.on("error", reject);
      gzip.on("end", () => resolve(Buffer.concat(chunks)));
      gzip.end(lines);
    });
    await updateProgress(75);
    await minio.putObject(
      playbackBucket,
      file.storageKey,
      compressed,
      compressed.length,
      { "Content-Type": "application/gzip" },
    );
    await updateProgress(95);
    const stats = calculateStats(events);
    await db
      .update(playbackFiles)
      .set({
        status: "ready",
        progress: 100,
        // Reported size is the .pbk content (NDJSON) as the user receives it,
        // not the smaller gzip object kept in MinIO.
        sizeBytes: Buffer.byteLength(lines),
        recordCount: events.length,
        uniqueTrackCount: stats.uniqueTrackCount,
        recordingFrom: stats.from,
        recordingTo: stats.to,
        stats,
        updatedAt: new Date(),
      })
      .where(eq(playbackFiles.id, fileId));
    await updateProgress(100);
    return;
  }
  const compressed = await readStoredObject(file.storageKey);
  await updateProgress(30);
  const { header, events } = parsePbkWithHeader(compressed);
  await updateProgress(80);
  const stats = {
    ...calculateStats(events),
    // Window the recording was made for; used as the playback session range
    // so imported files play over the same span as the original session.
    headerFrom: validIso(header.from),
    headerTo: validIso(header.to),
  };
  await db
    .update(playbackFiles)
    .set({
      status: "ready",
      progress: 100,
      // Keep the size recorded at import (what the user uploaded); the stored
      // object may be the smaller gzip form of a plain-JSONL upload.
      sizeBytes: file.sizeBytes ?? compressed.length,
      recordCount: events.length,
      uniqueTrackCount: stats.uniqueTrackCount,
      recordingFrom: stats.from,
      recordingTo: stats.to,
      stats,
      importedAt: new Date(),
      updatedAt: new Date(),
      errorMessage: null,
    })
    .where(eq(playbackFiles.id, fileId));
  await updateProgress(100);
}

const validIso = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// A type alias, not an interface: it is stored in the jsonb `stats` column,
// which is typed Record<string, unknown>, and interfaces are not assignable to
// that (no implicit index signature).
type RecordingStats = {
  uniqueTrackCount: number;
  from: Date | null;
  to: Date | null;
  recordCount: number;
};

function calculateStats(events: TimelineEvent[]): RecordingStats {
  const tracks = new Set<string>();
  for (const event of events) {
    const data = event.data as Record<string, unknown> | null;
    const track =
      data &&
      (typeof data.trackId === "string"
        ? data.trackId
        : typeof data.icao24 === "string"
          ? data.icao24
          : undefined);
    if (track) tracks.add(track);
  }
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    minTs = Math.min(minTs, event.ts);
    maxTs = Math.max(maxTs, event.ts);
  }
  return {
    uniqueTrackCount: tracks.size,
    from: Number.isFinite(minTs) ? new Date(minTs) : null,
    to: Number.isFinite(maxTs) ? new Date(maxTs) : null,
    recordCount: events.length,
  };
}

type PlaybackFileFilter = {
  search?: string;
  source?: PlaybackSource;
  status?: PlaybackFileStatus;
  airportId?: string;
  from?: string;
  to?: string;
};

function buildPlaybackFileConditions(
  query: PlaybackFileFilter,
): ReturnType<typeof and> {
  const conditions = [];
  if (query.search) {
    const term = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
    const searchCondition = or(
      ilike(playbackFiles.displayName, term),
      ilike(playbackFiles.originalFileName, term),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  if (query.source) conditions.push(eq(playbackFiles.source, query.source));
  if (query.status) conditions.push(eq(playbackFiles.status, query.status));
  if (query.airportId)
    conditions.push(eq(playbackFiles.airportId, query.airportId));
  if (query.from)
    conditions.push(gte(playbackFiles.createdAt, new Date(query.from)));
  if (query.to)
    conditions.push(lte(playbackFiles.createdAt, new Date(query.to)));
  return conditions.length ? and(...conditions) : undefined;
}

export async function listPlaybackFiles(query: {
  search?: string;
  source?: PlaybackSource;
  status?: PlaybackFileStatus;
  airportId?: string;
  from?: string;
  to?: string;
  sortBy:
    | "createdAt"
    | "updatedAt"
    | "displayName"
    | "sizeBytes"
    | "recordingFrom";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}): Promise<{
  items: PlaybackFileRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}> {
  const where = buildPlaybackFileConditions(query);
  const sortColumn = {
    createdAt: playbackFiles.createdAt,
    updatedAt: playbackFiles.updatedAt,
    displayName: playbackFiles.displayName,
    sizeBytes: playbackFiles.sizeBytes,
    recordingFrom: playbackFiles.recordingFrom,
  }[query.sortBy];
  // Rows without a value yet (e.g. sizeBytes while processing) always sort last.
  const order = sql`${sortColumn} ${sql.raw(query.sortOrder === "asc" ? "asc" : "desc")} nulls last`;
  const [items, countRows] = await Promise.all([
    db
      .select()
      .from(playbackFiles)
      .where(where)
      .orderBy(order, playbackFiles.id)
      .limit(query.limit)
      .offset((query.page - 1) * query.limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(playbackFiles)
      .where(where),
  ]);
  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total: countRows[0]?.count ?? 0,
      totalPages: Math.ceil((countRows[0]?.count ?? 0) / query.limit),
    },
  };
}

interface PlaybackFileStats {
  totalFiles: number;
  totalStorageBytes: number;
  lastImportAt: PlaybackFileRow["importedAt"] | null;
}

export async function getPlaybackFileStats(
  query: PlaybackFileFilter = {},
): Promise<PlaybackFileStats | undefined> {
  const where = buildPlaybackFileConditions(query);
  const [row] = await db
    .select({
      totalFiles: sql<number>`count(*)::int`,
      totalStorageBytes: sql<number>`coalesce(sum(${playbackFiles.sizeBytes}), 0)::float8`,
      lastImportAt: max(playbackFiles.importedAt),
    })
    .from(playbackFiles)
    .where(where);
  return row;
}

export async function patchPlaybackFile(
  id: string,
  patch: {
    displayName?: string;
    notes?: string | null;
    source?: PlaybackSource;
  },
): Promise<PlaybackFileRow> {
  const file = await getPlaybackFile(id);
  if (!file) throw fail("Playback file not found", "NOT_FOUND");
  if (patch.source && file.kind === "generated" && patch.source !== "asmgcs")
    throw fail("Generated playback files must use source asmgcs");
  if (file.status === "uploading" && patch.source)
    throw fail("Source cannot be changed while upload is pending", "CONFLICT");
  const [updated] = await db
    .update(playbackFiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(playbackFiles.id, id))
    .returning();
  if (!updated) throw fail("Playback file not found", "NOT_FOUND");
  return updated;
}

export async function deletePlaybackFile(id: string): Promise<void> {
  const file = await getPlaybackFile(id);
  if (!file) throw fail("Playback file not found", "NOT_FOUND");
  // "uploading" is deletable on purpose: abandoned uploads would otherwise stay forever.
  if (file.status === "processing")
    throw fail("Cannot delete a file while it is processing", "CONFLICT");
  try {
    await minio.removeObject(playbackBucket, file.storageKey);
  } catch (error) {
    logger.error({ err: error }, "Could not delete stored playback object");
    throw new ApiError("INTERNAL_ERROR", {
      message: "Could not delete stored playback object",
    });
  }
  await db.delete(playbackFiles).where(eq(playbackFiles.id, id));
  await redis.del(fileCacheKey(id)).catch(() => {});
}

// worker-service (the process that runs the websocket/engine) may not have
// MinIO configured, so /files/:id/play (playback-service HTTP, which does)
// copies the stored .pbk into Redis and loadEventsFromFile reads it from
// there, falling back to storage. Only the session-from-file path uses this.
const FILE_CACHE_TTL_SECONDS = 60 * 60 * 6;
const fileCacheKey = (fileId: string): string => `playback:file-data:${fileId}`;

export async function stageFileForPlayback(id: string): Promise<void> {
  const file = await getPlaybackFile(id);
  if (!file) throw fail("Playback file not found", "NOT_FOUND");
  if (file.status !== "ready")
    throw fail("Playback file is not ready for playback", "CONFLICT");
  const data = await readStoredObject(file.storageKey);
  parsePbkWithHeader(data); // fail the /play request, not the websocket
  await redis.set(fileCacheKey(id), data, "EX", FILE_CACHE_TTL_SECONDS);
}

export async function loadEventsFromFile(id: string): Promise<TimelineEvent[]> {
  const cached = await redis.getBuffer(fileCacheKey(id));
  if (cached) return parsePbkWithHeader(cached).events;
  const file = await getPlaybackFile(id);
  if (!file) throw fail("Playback file not found", "NOT_FOUND");
  if (file.status !== "ready")
    throw fail("Playback file is not ready for playback", "CONFLICT");
  return parsePbkWithHeader(await readStoredObject(file.storageKey)).events;
}
