import type { Readable } from "node:stream";
import { logger } from "@repo/logger";
import ApiError from "@repo/shared/api-error";

export type ImportSource = "asmgcs" | "adsb" | "radar";

export const PBK_CONTENT_TYPE = "application/gzip";
const DEFAULT_MAX_IMPORT_BYTES = 500 * 1024 * 1024;
// multipart framing + the (small) metadata fields on top of the file itself.
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/** Largest accepted .pbk, in bytes. `PLAYBACK_IMPORT_MAX_BYTES` overrides it. */
export function getMaxImportBytes(): number {
  const configured = Number(process.env.PLAYBACK_IMPORT_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_IMPORT_BYTES;
}

export const sourceFromName = (name: string): ImportSource => {
  const base = name.toLowerCase();
  if (base.startsWith("adsb_")) return "adsb";
  if (base.includes("_radar_")) return "radar";
  return "asmgcs";
};

export const objectKey = (id: string, name: string): string =>
  `playback/${id}/${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

const bad = (message: string): ApiError =>
  new ApiError("BAD_REQUEST", { message });

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string"
    ? error.code
    : undefined;

/** Thrown when the upload is larger than the configured limit (HTTP 413). */
export class ImportTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super("Playback file is too large");
    this.name = "ImportTooLargeError";
    this.maxBytes = maxBytes;
  }
}

export type PbkEncoding = "gzip" | "jsonl";

export interface UploadedPbk {
  fileName: string;
  size: number;
  /** First bytes of the upload, used to detect gzip vs. plain JSONL. */
  head: Uint8Array;
}

/**
 * A .pbk is stored as gzip (see playback-files.pbk.ts), but a file that was
 * decompressed after export (e.g. by an archive tool) is plain JSONL whose
 * first line is the metadata object. Both are accepted at import; plain JSONL
 * is gzipped by the backend before storage so the stored format stays uniform.
 */
export function detectPbkEncoding(head: Uint8Array): PbkEncoding | null {
  if (head[0] === 0x1f && head[1] === 0x8b) return "gzip";
  let i = 0;
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) i = 3; // UTF-8 BOM
  while (i < head.length && [0x20, 0x09, 0x0a, 0x0d].includes(head[i])) i++;
  return head[i] === 0x7b /* { */ ? "jsonl" : null;
}

/**
 * Cheap, request-time checks on the uploaded part. Full format validation
 * (gzip + JSONL header + events) stays in the worker for gzip uploads; plain
 * JSONL is fully validated by `normalizePbkUpload` before anything hits storage.
 */
export function assertValidPbkUpload(upload: UploadedPbk): PbkEncoding {
  if (!/\.pbk$/i.test(upload.fileName))
    throw bad("Only .pbk files can be imported");
  if (upload.size <= 0) throw bad("PBK file is empty");
  const max = getMaxImportBytes();
  if (upload.size > max) throw new ImportTooLargeError(max);
  const encoding = detectPbkEncoding(upload.head);
  if (!encoding)
    throw bad("PBK file must be a gzip stream or plain JSONL text");
  return encoding;
}

export interface PbkImportInput {
  airportId: string;
  fileName: string;
  displayName?: string;
  notes?: string;
  source?: ImportSource;
  body: Readable;
  /** Bytes written to storage (the gzip form). */
  size: number;
  /** Bytes the client uploaded; reported as the file size. Defaults to `size`. */
  originalSize?: number;
}

export interface PbkFileInsert {
  id: string;
  airportId: string;
  displayName: string;
  originalFileName: string;
  notes?: string;
  source: ImportSource;
  sizeBytes: number;
  storageKey: string;
}

export interface PbkImportDeps<Row extends { id: string }> {
  newId: () => string;
  ensureBucket: () => Promise<void>;
  putObject: (
    key: string,
    body: Readable,
    size: number,
    contentType: string,
  ) => Promise<void>;
  removeObject: (key: string) => Promise<void>;
  insertFile: (values: PbkFileInsert) => Promise<Row>;
  deleteFile: (id: string) => Promise<void>;
  markFileFailed: (id: string, message: string) => Promise<void>;
  enqueueScan: (fileId: string) => Promise<void>;
}

/**
 * Receives an already-validated .pbk and drives the import lifecycle:
 *
 *   object stored  ->  row inserted as `processing`  ->  `scan` job queued
 *
 * The worker then validates the content and flips the row to `ready`/`failed`.
 * The object is written first and the row second, so a failed upload never
 * leaves a visible record, and every later failure is rolled back so the
 * caller can simply retry.
 */
export function createPbkImporter<Row extends { id: string }>(
  deps: PbkImportDeps<Row>,
): (input: PbkImportInput) => Promise<Row> {
  const removeQuietly = async (fileId: string, key: string): Promise<void> => {
    try {
      await deps.removeObject(key);
    } catch (error) {
      logger.error(
        { fileId, code: errorCode(error) },
        "Could not clean up imported playback object",
      );
    }
  };

  // Drop the row; if even that fails, make sure it cannot look healthy.
  // Returns true when the row is gone and the object is safe to remove.
  const discardRow = async (fileId: string): Promise<boolean> => {
    try {
      await deps.deleteFile(fileId);
      return true;
    } catch (error) {
      logger.error(
        { fileId, code: errorCode(error) },
        "Could not delete playback file record after failed import",
      );
      await deps
        .markFileFailed(fileId, "Import could not be completed")
        .catch(() => {});
      return false;
    }
  };

  return async function importPbk(input: PbkImportInput): Promise<Row> {
    const id = deps.newId();
    const key = objectKey(id, input.fileName);

    try {
      await deps.ensureBucket();
      await deps.putObject(key, input.body, input.size, PBK_CONTENT_TYPE);
    } catch (error) {
      // Storage errors can carry internal hostnames; log the code only and
      // give the client a generic message.
      logger.error(
        { fileId: id, code: errorCode(error) },
        "Could not store imported playback file",
      );
      await removeQuietly(id, key); // a failed multipart upload may leave parts
      throw new ApiError("INTERNAL_ERROR", {
        message: "Could not store playback file",
      });
    }

    let file: Row;
    try {
      file = await deps.insertFile({
        id,
        airportId: input.airportId,
        displayName: input.displayName ?? input.fileName.replace(/\.pbk$/i, ""),
        originalFileName: input.fileName,
        notes: input.notes,
        source: input.source ?? sourceFromName(input.fileName),
        // Reported size is what the user imported, not the stored gzip size.
        sizeBytes: input.originalSize ?? input.size,
        storageKey: key,
      });
    } catch (error) {
      logger.error(
        { fileId: id, code: errorCode(error) },
        "Could not create playback file record for import",
      );
      await removeQuietly(id, key);
      throw new ApiError("INTERNAL_ERROR", {
        message: "Could not save playback file",
      });
    }

    try {
      await deps.enqueueScan(id);
    } catch (error) {
      logger.error(
        { fileId: id, code: errorCode(error) },
        "Could not enqueue imported playback file validation",
      );
      if (await discardRow(id)) await removeQuietly(id, key);
      throw new ApiError("INTERNAL_ERROR", {
        message: "Could not queue playback file validation",
      });
    }

    return file;
  };
}
