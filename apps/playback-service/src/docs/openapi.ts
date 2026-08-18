import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type ResponseConfig,
} from "@asteasolutions/zod-to-openapi";
import type { ReferenceObject } from "@asteasolutions/zod-to-openapi/dist/types";
import z from "zod";
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
  ],
});
