import { z } from "zod";

export const playbackSourceSchema = z.enum(["asmgcs", "adsb", "radar"]);
export const playbackFileStatusSchema = z.enum([
  "uploading",
  "processing",
  "ready",
  "failed",
]);
export const createRecordingSchema = z.object({
  airportId: z.string().trim().min(1).max(32),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  displayName: z.string().trim().min(1).max(160).optional(),
  notes: z.string().max(2000).optional(),
});
// Text fields of the multipart import request; the file itself is the `file`
// part and is checked separately (size/signature) in playback-files.import.ts.
export const importFileSchema = z.object({
  airportId: z.string().trim().min(1).max(32),
  // Optional override; defaults to the uploaded part's own file name.
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/\.pbk$/i, "fileName must end with .pbk")
    .optional(),
  displayName: z.string().trim().min(1).max(160).optional(),
  notes: z.string().max(2000).optional(),
  source: playbackSourceSchema.optional(),
});
export const patchPlaybackFileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160).optional(),
    notes: z.string().max(2000).nullable().optional(),
    source: playbackSourceSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");
export const listPlaybackFilesSchema = z
  .object({
    search: z.string().trim().max(160).optional(),
    source: playbackSourceSchema.optional(),
    status: playbackFileStatusSchema.optional(),
    airportId: z.string().trim().max(32).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    sortBy: z
      .enum([
        "createdAt",
        "updatedAt",
        "displayName",
        "sizeBytes",
        "recordingFrom",
      ])
      .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((v) => !v.from || !v.to || new Date(v.from) <= new Date(v.to), {
    message: "`from` must not be after `to`",
    path: ["to"],
  });
export const MAX_PLAYBACK_SPEED = 16;
export const playFileSchema = z.object({
  speed: z.number().positive().max(MAX_PLAYBACK_SPEED).default(1),
});
