import { validate } from "@repo/validation";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  createGeneratedPlaybackFile,
  deletePlaybackFileRecord,
  downloadPlaybackFile,
  getPlaybackFileRecord,
  getPlaybackFileStatistics,
  importPlaybackFileRecord,
  listPlaybackFileRecords,
  patchPlaybackFileRecord,
  payloadTooLarge,
  playPlaybackFile,
} from "./playback-files.controller";
import {
  getMaxImportBytes,
  MULTIPART_OVERHEAD_BYTES,
} from "./playback-files.import";
import {
  createRecordingSchema,
  listPlaybackFilesSchema,
  patchPlaybackFileSchema,
  playFileSchema,
} from "./playback-files.schema";

const app = new Hono()
  .post("/files", validate(createRecordingSchema), createGeneratedPlaybackFile)
  // bodyLimit aborts the stream once the cap is crossed, so an oversized
  // upload is rejected before it is buffered in full.
  .post(
    "/files/import",
    bodyLimit({
      maxSize: getMaxImportBytes() + MULTIPART_OVERHEAD_BYTES,
      onError: (c: Context) => payloadTooLarge(c, getMaxImportBytes()),
    }),
    importPlaybackFileRecord,
  )
  .get(
    "/files/stats",
    validate(listPlaybackFilesSchema),
    getPlaybackFileStatistics,
  )
  .get("/files", validate(listPlaybackFilesSchema), listPlaybackFileRecords)
  .get("/files/:id/download", downloadPlaybackFile)
  .post("/files/:id/play", validate(playFileSchema), playPlaybackFile)
  .get("/files/:id", getPlaybackFileRecord)
  .patch(
    "/files/:id",
    validate(patchPlaybackFileSchema),
    patchPlaybackFileRecord,
  )
  .delete("/files/:id", deletePlaybackFileRecord);

export default app;
