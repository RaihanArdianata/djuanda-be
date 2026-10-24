import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { logger } from "@repo/logger";
import ApiError from "@repo/shared/api-error";
import { success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import type { Context } from "hono";
import type { z } from "zod";
import {
  createSessionRecord,
  deleteSessionRecord,
  getSessionRecord,
} from "../services/playback-session.service";
import { createPlaybackDownloadResponse } from "./playback-files.download";
import {
  assertValidPbkUpload,
  ImportTooLargeError,
  type PbkEncoding,
} from "./playback-files.import";
import { normalizePbkUpload } from "./playback-files.pbk";
import { resolvePlayableRange } from "./playback-files.range";
import type {
  createRecordingSchema,
  listPlaybackFilesSchema,
  patchPlaybackFileSchema,
  playFileSchema,
} from "./playback-files.schema";
import { importFileSchema } from "./playback-files.schema";
import {
  createGeneratedFile,
  deletePlaybackFile,
  getPlaybackFile,
  getPlaybackFileStats,
  importPlaybackFile,
  listPlaybackFiles,
  patchPlaybackFile,
  stageFileForPlayback,
  toPublicPlaybackFile,
} from "./playback-files.service";

type Parsed<T extends z.ZodType> = z.infer<T>;

const parsed = <T>(c: Context): T => c.get("parsedData") as T;
const getRequiredParam = (c: Context, key: string): string => {
  const value = c.req.param(key);

  if (!value) {
    throw new ApiError("BAD_REQUEST", {
      message: `Parameter ${key} wajib diisi`,
    });
  }

  return value;
};

export const createGeneratedPlaybackFile = catchAsync(async (c) => {
  const input = parsed<Parsed<typeof createRecordingSchema>>(c);

  const file = await createGeneratedFile({
    airportId: input.airportId,
    from: new Date(input.from),
    to: new Date(input.to),
    displayName: input.displayName,
    notes: input.notes,
  });

  return success(c, toPublicPlaybackFile(file), {
    message: "Playback file generation queued",
    code: 202,
  });
});

// 413 is not one of ApiError's codes, so it is answered with the standard
// error envelope directly (same shape the OpenAPI document describes).
export const payloadTooLarge = (c: Context, maxBytes: number): Response =>
  c.json(
    {
      data: null,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: `Playback file exceeds the ${maxBytes} byte limit`,
      },
      meta: { code: 413, status: "ERROR" },
    },
    413,
  );

const IMPORT_FIELDS = [
  "airportId",
  "fileName",
  "displayName",
  "notes",
  "source",
] as const;

// Imports a .pbk sent as multipart/form-data. The file is validated here, then
// written to MinIO by the backend (never by the browser); the worker validates
// the content afterwards, so the response is 202 with a `processing` file.
export const importPlaybackFileRecord = catchAsync(async (c) => {
  if (!/^multipart\/form-data/i.test(c.req.header("content-type") ?? ""))
    throw new ApiError("BAD_REQUEST", {
      message: "Request must be multipart/form-data",
    });

  let form: Record<string, string | File>;
  try {
    form = await c.req.parseBody();
  } catch {
    throw new ApiError("BAD_REQUEST", { message: "Malformed multipart body" });
  }

  const part = form.file;
  if (!(part instanceof File))
    throw new ApiError("BAD_REQUEST", {
      message: "A .pbk file is required in the `file` field",
    });

  const raw: Record<string, string> = {};
  for (const key of IMPORT_FIELDS) {
    const value = form[key];
    if (typeof value === "string" && value.trim() !== "") raw[key] = value;
  }
  const fields = importFileSchema.safeParse(raw);
  if (!fields.success)
    throw new ApiError("BAD_REQUEST", {
      message: fields.error.issues
        .map(
          (issue) => `${issue.path.join(".") || "request"}: ${issue.message}`,
        )
        .join("; "),
    });

  // Some browsers send a full path as the part's file name.
  const fileName = fields.data.fileName ?? part.name.split(/[\\/]/).pop() ?? "";
  let encoding: PbkEncoding;
  try {
    encoding = assertValidPbkUpload({
      fileName,
      size: part.size,
      head: new Uint8Array(await part.slice(0, 16).arrayBuffer()),
    });
  } catch (error) {
    if (error instanceof ImportTooLargeError)
      return payloadTooLarge(c, error.maxBytes);
    throw error;
  }

  // Plain JSONL is fully validated and gzipped in memory (bounded by the size
  // limit above) so the stored object is always the canonical gzip form.
  let body: Readable;
  let size = part.size;
  const originalSize: number = part.size; // what the user imported, for the response
  if (encoding === "jsonl") {
    const gz = normalizePbkUpload(
      Buffer.from(await part.arrayBuffer()),
      "jsonl",
    );
    body = Readable.from(gz);
    size = gz.length;
  } else {
    body = Readable.fromWeb(part.stream() as unknown as NodeReadableStream);
  }

  const file = await importPlaybackFile({
    ...fields.data,
    fileName,
    body,
    size,
    originalSize,
  });

  return success(c, toPublicPlaybackFile(file), {
    message: "Playback file import accepted; validation queued",
    code: 202,
  });
});

export const listPlaybackFileRecords = catchAsync(async (c) => {
  const query = parsed<Parsed<typeof listPlaybackFilesSchema>>(c);
  const result = await listPlaybackFiles(query);

  return success(
    c,
    {
      ...result,
      items: result.items.map(toPublicPlaybackFile),
    },
    {
      message: "Playback files retrieved",
    },
  );
});

export const getPlaybackFileRecord = catchAsync(async (c) => {
  const id = getRequiredParam(c, "id");
  const file = await getPlaybackFile(id);

  if (!file) {
    throw new ApiError("NOT_FOUND", {
      message: "Playback file not found",
    });
  }

  return success(c, toPublicPlaybackFile(file), {
    message: "Playback file retrieved",
  });
});

export const getPlaybackFileStatistics = catchAsync(async (c) =>
  success(c, await getPlaybackFileStats(), {
    message: "Playback file statistics retrieved",
  }),
);

export const patchPlaybackFileRecord = catchAsync(async (c) => {
  const id = getRequiredParam(c, "id");
  const patch = parsed<Parsed<typeof patchPlaybackFileSchema>>(c);

  const file = await patchPlaybackFile(id, patch);

  return success(c, toPublicPlaybackFile(file), {
    message: "Playback file updated",
  });
});

export const deletePlaybackFileRecord = catchAsync(async (c) => {
  const id = getRequiredParam(c, "id");

  await deletePlaybackFile(id);

  return success(c, null, {
    message: "Playback file deleted",
  });
});

// Streams the stored .pbk through the backend; MinIO is never exposed to the
// client. The object is resolved from the database record, not from input.
export const downloadPlaybackFile = catchAsync(async (c) => {
  const id = getRequiredParam(c, "id");
  const file = await getPlaybackFile(id);

  if (!file) {
    throw new ApiError("NOT_FOUND", {
      message: "Playback file not found",
    });
  }

  return createPlaybackDownloadResponse(file);
});

export const playPlaybackFile = catchAsync(async (c) => {
  const id = getRequiredParam(c, "id");
  const file = await getPlaybackFile(id);

  if (!file) {
    throw new ApiError("NOT_FOUND", {
      message: "Playback file not found",
    });
  }

  if (file.status !== "ready") {
    throw new ApiError("BAD_REQUEST", {
      message: "Playback file is not ready",
    });
  }

  // Same window the original /sessions playback would use, not just the
  // min/max event timestamps (which can collapse to a single instant).
  const range = resolvePlayableRange(file);
  if (!range) {
    throw new ApiError("BAD_REQUEST", {
      message: "Playback file has no playable time range",
    });
  }

  const body = parsed<Parsed<typeof playFileSchema>>(c);

  const session = await createSessionRecord({
    airportId: file.airportId,
    from: range.from,
    to: range.to,
    speed: body.speed,
    fileId: file.id,
  });

  // The websocket (possibly another process) resolves this session purely
  // from Redis. Read it back so a session that cannot be found fails here,
  // with a clear error, instead of surfacing later as "session ... not found"
  // on the websocket.
  const persisted = await getSessionRecord(session.id);
  if (!persisted || persisted.fileId !== file.id) {
    logger.error(
      { sessionId: session.id, fileId: file.id, found: Boolean(persisted) },
      "Playback session from file is not readable right after creation",
    );
    throw new ApiError("INTERNAL_ERROR", {
      message: "Failed to persist playback session",
    });
  }

  try {
    await stageFileForPlayback(file.id);
  } catch (error) {
    await deleteSessionRecord(session.id).catch(() => {});
    logger.error(
      { err: error, sessionId: session.id, fileId: file.id },
      "Could not stage playback file for session",
    );
    throw error;
  }

  return success(
    c,
    {
      session,
      wsPath: `/api/worker/ws/playback/${session.id}`,
    },
    {
      message: "Playback session created from file",
      code: 201,
    },
  );
});
