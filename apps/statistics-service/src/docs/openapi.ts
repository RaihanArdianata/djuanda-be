import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type ResponseConfig,
} from "@asteasolutions/zod-to-openapi";
import type { ReferenceObject } from "@asteasolutions/zod-to-openapi/dist/types";
import { z } from "zod";
import { getOperationalStatisticsSchema } from "../modules/statistics/validator/statistics.validator";

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
        meta: z.object({
          code: z.number(),
          status: z.literal("ERROR"),
        }),
      }),
    },
  },
});

const operationalStatisticsResponse = z.object({
  data: z.object({
    period: z.enum(["daily", "weekly", "monthly"]),
    startDate: z.string(),
    endDate: z.string(),
    traffic: z.object({
      totalAircraft: z.number().nullable(),
      totalGroundVehicle: z.number().nullable(),
      totalTraffic: z.number().nullable(),
    }),
    movement: z.object({
      totalTakeoff: z.number().nullable(),
      totalLanding: z.number().nullable(),
      averageMovementPerHour: z.number().nullable(),
      peakHourMovement: z.number().nullable(),
      peakHour: z.string().nullable(),
    }),
    alerts: z.object({
      stca: z.number(),
      apa: z.number(),
      da: z.number(),
      ria: z.number(),
      taia: z.number(),
      total: z.number(),
    }),
    trend: z.array(
      z.object({
        period: z.string(),
        periodRange: z
          .string()
          .optional()
          .describe(
            "'periodStart - periodEnd', only present for weekly/monthly buckets",
          ),
        aircraft: z.number().nullable(),
        groundVehicle: z.number().nullable(),
        takeoff: z.number().nullable(),
        landing: z.number().nullable(),
        totalMovement: z.number().nullable(),
        alerts: z.number(),
      }),
    ),
    warnings: z.array(z.string()),
  }),
  error: z.null(),
  meta: z.object({
    code: z.number(),
    status: z.literal("SUCCESS"),
    message: z.string().optional(),
  }),
});

registry.registerPath({
  method: "get",
  path: "/statistics/operational",
  tags: ["Statistics"],
  summary: "Get operational statistics",
  description:
    "Mengambil statistik operasional traffic, movement, alert, dan trend berdasarkan periode dan rentang tanggal.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: getOperationalStatisticsSchema,
  },
  responses: {
    200: {
      description: "Operational statistics retrieved successfully",
      content: {
        "application/json": {
          schema: operationalStatisticsResponse,
        },
      },
    },
    400: errorResponse("Validasi gagal atau rentang tanggal tidak valid"),
    401: errorResponse("Belum login"),
    403: errorResponse("Tidak memiliki permission"),
  },
});

export const openApiDocument = new OpenApiGeneratorV3(
  registry.definitions,
).generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Statistics Service API",
    version: "1.0.0",
    description:
      "API untuk mengambil traffic, movement, alert, dan operational trend statistics.",
  },
});