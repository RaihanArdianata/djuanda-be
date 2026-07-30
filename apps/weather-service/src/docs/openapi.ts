import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type ResponseConfig,
} from "@asteasolutions/zod-to-openapi";
import type { ReferenceObject } from "@asteasolutions/zod-to-openapi/dist/types";
import { z } from "zod";
import {
  getCurrentObservationSchema,
  getForecastSchema,
  getObservationHistorySchema,
} from "@/modules/weather/validator/weather.validator";

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

const currentObservationSchema = z.object({
  station: z.string(),
  kind: z.string(),
  observedAt: z.string(),
  raw: z.string(),
  parsed: z.record(z.string(), z.unknown()),
  stale: z.boolean(),
  staleSince: z.string().nullable(),
});

const forecastSchema = z.object({
  station: z.string(),
  issuedAt: z.string(),
  validFrom: z.string(),
  validTo: z.string(),
  raw: z.string(),
  forecast: z.record(z.string(), z.unknown()),
  stale: z.boolean(),
});

const successResponse = (
  description: string,
  dataSchema: z.ZodTypeAny,
): ResponseConfig | ReferenceObject => ({
  description,
  content: {
    "application/json": {
      schema: z.object({
        data: dataSchema,
        meta: z.object({ code: z.number(), status: z.literal("SUCCESS") }),
      }),
    },
  },
});

const paginatedHistoryResponse = (
  description: string,
): ResponseConfig | ReferenceObject => ({
  description,
  content: {
    "application/json": {
      schema: z.object({
        data: z.array(currentObservationSchema),
        meta: z.object({
          code: z.number(),
          status: z.literal("SUCCESS"),
          page: z.number(),
          size: z.number(),
          total: z.number(),
          totalPages: z.number(),
        }),
      }),
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/weather/current",
  tags: ["Weather"],
  summary: "Ambil observasi METAR terkini untuk sebuah station",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: getCurrentObservationSchema,
  },
  responses: {
    200: successResponse(
      "Observasi METAR terkini berhasil diambil",
      currentObservationSchema,
    ),
    401: errorResponse("Belum login"),
    403: errorResponse("Tidak punya akses"),
    404: errorResponse("Belum ada observasi METAR untuk station ini"),
  },
});

registry.registerPath({
  method: "get",
  path: "/weather/history",
  tags: ["Weather"],
  summary: "Ambil riwayat observasi METAR/SPECI dengan paginasi",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: getObservationHistorySchema,
  },
  responses: {
    200: paginatedHistoryResponse("Riwayat observasi berhasil diambil"),
    400: errorResponse("Validasi gagal"),
    401: errorResponse("Belum login"),
    403: errorResponse("Tidak punya akses"),
  },
});

registry.registerPath({
  method: "get",
  path: "/weather/forecast",
  tags: ["Weather"],
  summary: "Ambil forecast TAF aktif untuk sebuah station",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: getForecastSchema,
  },
  responses: {
    200: successResponse("Forecast TAF berhasil diambil", forecastSchema),
    401: errorResponse("Belum login"),
    403: errorResponse("Tidak punya akses"),
    404: errorResponse("Belum ada forecast TAF untuk station ini"),
  },
});

export const openApiDocument = new OpenApiGeneratorV3(
  registry.definitions,
).generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Weather Service API",
    version: "1.0.0",
    description:
      "Endpoint cuaca ASMGCS: observasi METAR terkini, riwayat observasi, dan forecast TAF.",
  },
});
