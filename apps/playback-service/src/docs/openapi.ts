import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type ResponseConfig,
} from "@asteasolutions/zod-to-openapi";
import type { ReferenceObject } from "@asteasolutions/zod-to-openapi/dist/types";
import z from "zod";
import {
  createRecordingSchema,
  importFileSchema,
  listPlaybackFilesSchema,
  patchPlaybackFileSchema,
  playbackFileStatusSchema,
  playbackSourceSchema,
  playFileSchema,
} from "../modules/files/playback-files.schema";
import {
  controlSchema,
  createSessionSchema,
  playbackSessionRecordSchema,
} from "../modules/schema/playback.schema";

const registry = new OpenAPIRegistry();

const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

const errorResponse = (
  description: string,
): ResponseConfig | ReferenceObject => ({
  description,
  content: {
    "application/json": {
      schema: z.object({
        data: z.null(),
        error: z.object({
          code: z.string(),
          message: z.string(),
          fields: z.record(z.string(), z.array(z.string())).optional(),
        }),
        meta: z.object({ code: z.number(), status: z.literal("ERROR") }),
      }),
    },
  },
});

const successResponse = (
  description: string,
  schema: z.ZodType,
): ResponseConfig | ReferenceObject => ({
  description,
  content: {
    "application/json": {
      schema: z.object({
        data: schema,
        error: z.null(),
        meta: z.object({
          code: z.number(),
          status: z.literal("SUCCESS"),
          message: z.string(),
        }),
      }),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/playback/sessions",
  tags: ["Sessions"],
  summary: "Create a new playback session",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createSessionSchema.describe(
            "Request body for creating a new playback session",
          ),
        },
      },
    },
  },
  responses: {
    201: successResponse(
      "Playback session created successfully",
      playbackSessionRecordSchema
        .describe("The created playback session record")
        .extend({
          eventCount: z
            .number()
            .describe("The number of events loaded for the session"),
          wsPath: z.string().describe("The WebSocket path for the session"),
        }),
    ),
    400: errorResponse("Bad Request"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "get",
  path: "/playback/sessions/:sessionId",
  tags: ["Sessions"],
  summary: "Get playback session by ID",
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: successResponse("Success", playbackSessionRecordSchema),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "post",
  path: "/playback/sessions/:sessionId/control",
  tags: ["Sessions"],
  summary: "Control playback session",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: controlSchema.describe(
            "Request body for controlling a playback session",
          ),
        },
      },
    },
  },
  responses: {
    200: successResponse(
      "Control applied successfully",
      playbackSessionRecordSchema,
    ),
    400: errorResponse("Bad Request"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/playback/sessions/:sessionId",
  tags: ["Sessions"],
  summary: "Delete a playback session",
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: successResponse("Playback session deleted successfully", z.null()),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    500: errorResponse("Internal Server Error"),
  },
});

const nullableDate = z.iso.datetime().nullable();

const playbackFileResponse = z.object({
  id: z.string(),
  airportId: z.string(),
  kind: z.enum(["generated", "imported"]),
  displayName: z.string(),
  originalFileName: z.string().nullable(),
  notes: z.string().nullable(),
  source: playbackSourceSchema,
  status: playbackFileStatusSchema,
  progress: z.number().describe("Processing progress, 0-100"),
  sizeBytes: z.number().nullable(),
  recordCount: z.number().nullable(),
  uniqueTrackCount: z.number().nullable(),
  recordingFrom: nullableDate,
  recordingTo: nullableDate,
  requestedFrom: nullableDate,
  requestedTo: nullableDate,
  stats: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  importedAt: nullableDate,
});

const fileIdParams = z.object({ id: z.string().describe("Playback file ID") });

const commonErrors = {
  401: errorResponse("Unauthorized"),
  403: errorResponse("Forbidden"),
  500: errorResponse("Internal Server Error"),
};

registry.registerPath({
  method: "post",
  path: "/playback/files",
  tags: ["Playback Files"],
  summary: "Queue a recording file generation",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createRecordingSchema } },
    },
  },
  responses: {
    202: successResponse("Generation queued", playbackFileResponse),
    400: errorResponse("Bad Request"),
    ...commonErrors,
  },
});

registry.registerPath({
  method: "post",
  path: "/playback/files/import",
  tags: ["Playback Files"],
  summary: "Import a PBK file (uploaded through the backend)",
  description:
    "Accepts a .pbk (gzip or plain NDJSON) file as multipart/form-data and stores it in object " +
    "storage from the backend; clients never receive storage URLs or credentials. " +
    "The file is validated asynchronously: the 202 response carries a file in " +
    "`processing` status that becomes `ready` or `failed`. Maximum size is " +
    "500 MiB unless PLAYBACK_IMPORT_MAX_BYTES overrides it.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: importFileSchema.extend({
            file: z
              .string()
              .meta({ format: "binary" })
              .describe(".pbk file (gzip-compressed JSONL)"),
          }),
        },
      },
    },
  },
  responses: {
    202: successResponse(
      "Import accepted, validation queued",
      playbackFileResponse,
    ),
    400: errorResponse(
      "Missing file, not a .pbk / gzip file, empty file, or invalid metadata",
    ),
    413: errorResponse("File exceeds the maximum import size"),
    ...commonErrors,
    500: errorResponse("Could not store the file or queue its validation"),
  },
});

registry.registerPath({
  method: "get",
  path: "/playback/files",
  tags: ["Playback Files"],
  summary: "Search and paginate playback files",
  security: [{ [bearerAuth.name]: [] }],
  request: { query: listPlaybackFilesSchema },
  responses: {
    200: successResponse(
      "Playback files retrieved",
      z.object({
        items: z.array(playbackFileResponse),
        pagination: z.object({
          page: z.number(),
          limit: z.number(),
          total: z.number(),
          totalPages: z.number(),
        }),
      }),
    ),
    400: errorResponse("Bad Request"),
    ...commonErrors,
  },
});

registry.registerPath({
  method: "get",
  path: "/playback/files/stats",
  tags: ["Playback Files"],
  summary: "Get playback file storage statistics",
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: successResponse(
      "Statistics retrieved",
      z.object({
        totalFiles: z.number(),
        totalStorageBytes: z.number(),
        lastImportAt: nullableDate,
      }),
    ),
    ...commonErrors,
  },
});

registry.registerPath({
  method: "get",
  path: "/playback/files/{id}",
  tags: ["Playback Files"],
  summary: "Get playback file metadata and progress",
  security: [{ [bearerAuth.name]: [] }],
  request: { params: fileIdParams },
  responses: {
    200: successResponse("Playback file retrieved", playbackFileResponse),
    404: errorResponse("Not Found"),
    ...commonErrors,
  },
});

registry.registerPath({
  method: "patch",
  path: "/playback/files/{id}",
  tags: ["Playback Files"],
  summary: "Update playback file metadata",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: fileIdParams,
    body: {
      content: { "application/json": { schema: patchPlaybackFileSchema } },
    },
  },
  responses: {
    200: successResponse("Playback file updated", playbackFileResponse),
    400: errorResponse("Bad Request"),
    404: errorResponse("Not Found"),
    409: errorResponse("Source cannot be changed while upload is pending"),
    ...commonErrors,
  },
});

registry.registerPath({
  method: "delete",
  path: "/playback/files/{id}",
  tags: ["Playback Files"],
  summary: "Delete playback file and stored object",
  security: [{ [bearerAuth.name]: [] }],
  request: { params: fileIdParams },
  responses: {
    200: successResponse("Playback file deleted", z.null()),
    404: errorResponse("Not Found"),
    409: errorResponse("File is still processing"),
    ...commonErrors,
  },
});

registry.registerPath({
  method: "get",
  path: "/playback/files/{id}/download",
  tags: ["Playback Files"],
  summary: "Download a playback file",
  description:
    "Streams the PBK file through the backend as an attachment. Storage is never exposed to the client.",
  security: [{ [bearerAuth.name]: [] }],
  request: { params: fileIdParams },
  responses: {
    200: {
      description: "PBK file content",
      content: {
        "application/octet-stream": {
          schema: { type: "string", format: "binary" },
        },
      },
    },
    404: errorResponse("Not Found"),
    409: errorResponse("File is not ready for download"),
    ...commonErrors,
  },
});

registry.registerPath({
  method: "post",
  path: "/playback/files/{id}/play",
  tags: ["Playback Files"],
  summary: "Create a playback session from a ready file",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: fileIdParams,
    body: {
      content: { "application/json": { schema: playFileSchema } },
    },
  },
  responses: {
    201: successResponse(
      "Playback session created from file",
      z.object({ session: playbackSessionRecordSchema, wsPath: z.string() }),
    ),
    400: errorResponse("File is not ready or has no event time range"),
    404: errorResponse("Not Found"),
    ...commonErrors,
  },
});

export const openApiDocument = new OpenApiGeneratorV3(
  registry.definitions,
).generateDocument({
  openapi: "3.1.0",
  info: {
    title: "Playback Service API",
    version: "1.0.0",
    description:
      "API documentation for the Playback Service, which provides endpoints for managing playback sessions and controlling playback actions.",
  },
  tags: [
    { name: "Sessions", description: "Endpoints related to playback sessions" },
    {
      name: "Playback Files",
      description:
        "Generate, import, manage, download and play PBK recording files",
    },
  ],
});
