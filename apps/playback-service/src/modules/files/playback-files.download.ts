import type { Readable } from "node:stream";
import { logger } from "@repo/logger";
import ApiError from "@repo/shared/api-error";
import { isMissingObjectError, minio, playbackBucket } from "./storage";

export interface DownloadableFile {
  id: string;
  displayName: string;
  originalFileName: string | null;
  storageKey: string;
  status: string;
}

const MAX_FILE_NAME_BASE_LENGTH = 120;

const sanitizeNamePart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[._-]+/, "");

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string"
    ? error.code
    : undefined;
export function safeDownloadFileName(
  file: Pick<DownloadableFile, "id" | "displayName" | "originalFileName">,
): string {
  const raw = (file.originalFileName ?? file.displayName).trim();
  const base = sanitizeNamePart(raw.replace(/\.pbk$/i, "")).slice(
    0,
    MAX_FILE_NAME_BASE_LENGTH,
  );
  return `${/[a-zA-Z0-9]/.test(base) ? base : `playback-${sanitizeNamePart(file.id)}`}.pbk`;
}

export function buildDownloadHeaders(
  fileName: string,
  size: number | null,
): Record<string, string> {
  return {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    ...(size !== null ? { "Content-Length": String(size) } : {}),
  };
}

const toBytes = (chunk: unknown): Uint8Array => {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === "string") return Buffer.from(chunk);
  throw new TypeError("Unexpected chunk type from storage stream");
};
export function toWebStream(
  source: Readable,
  onError?: (error: unknown) => void,
): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(
      controller: ReadableStreamDefaultController<Uint8Array>,
    ): Promise<void> {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(toBytes(result.value));
      } catch (error) {
        source.destroy();
        onError?.(error);
        controller.error(error);
      }
    },
    cancel(): void {
      source.destroy();
    },
  });
}

export async function createPlaybackDownloadResponse(
  file: DownloadableFile,
): Promise<Response> {
  if (file.status !== "ready")
    throw new ApiError("CONFLICT", {
      message: "Playback file is not ready for download",
    });

  let source: Readable;
  let size: number | null;
  try {
    const stat = await minio.statObject(playbackBucket, file.storageKey);
    source = await minio.getObject(playbackBucket, file.storageKey);
    size = Number.isSafeInteger(stat.size) && stat.size >= 0 ? stat.size : null;
  } catch (error) {
    if (isMissingObjectError(error))
      throw new ApiError("NOT_FOUND", {
        message: "Stored playback object was not found",
      });
    logger.error(
      { fileId: file.id, code: errorCode(error) },
      "Could not read stored playback object",
    );
    throw new ApiError("INTERNAL_ERROR", {
      message: "Could not read stored playback file",
    });
  }

  const body = toWebStream(source, (error) => {
    logger.error(
      { fileId: file.id, code: errorCode(error) },
      "Playback download stream failed",
    );
  });
  return new Response(body, {
    status: 200,
    headers: buildDownloadHeaders(safeDownloadFileName(file), size),
  });
}
