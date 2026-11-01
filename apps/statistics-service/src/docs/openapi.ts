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

const alertDetail = z.object({
  alertId: z.string(),
  type: z.string(),
  callsign: z.string().nullable(),
  airportId: z.string(),
  time: z
    .string()
    .describe("Waktu alert dipicu (Asia/Jakarta, YYYY-MM-DDTHH:mm:ss+07:00)"),
  severity: z.string(),
  status: z.string(),
  trackId: z.string().nullable(),
  relatedTrackId: z.string().nullable(),
  description: z.string().describe("Narasi siap tampil untuk FE"),
  areaName: z.string().nullable(),
  areaType: z.string().nullable(),
  areaStatus: z.string().nullable(),
  surfaceName: z.string().nullable(),
  surfaceType: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  groundSpeed: z.number().nullable(),
  heading: z.number().nullable(),
});

const alertCategorySummary = z.object({
  count: z.number(),
  details: z
    .array(alertDetail)
    .describe("Alert terbaru pada kategori ini (maks. 50), terbaru lebih dulu"),
});

const operationalStatisticsResponse = z.object({
  data: z.object({
    period: z.enum(["hourly", "daily", "weekly", "monthly"]),
    startDate: z.string(),
    endDate: z.string(),
    startTime: z
      .string()
      .optional()
      .describe(
        "Echoed back only when a startTime/endTime window was requested",
      ),
    endTime: z
      .string()
      .optional()
      .describe(
        "Echoed back only when a startTime/endTime window was requested",
      ),
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
      stca: alertCategorySummary,
      apa: alertCategorySummary,
      da: alertCategorySummary,
      ria: alertCategorySummary,
      taia: alertCategorySummary,
      total: z.number(),
    }),
    trend: z.array(
      z.object({
        period: z.string(),
        periodRange: z
          .string()
          .optional()
          .describe(
            "'periodStart - periodEnd', present for every bucket granularity except daily",
          ),
        aircraft: z.number().nullable(),
        groundVehicle: z.number().nullable(),
        takeoff: z.number().nullable(),
        landing: z.number().nullable(),
        totalMovement: z.number().nullable(),
        alerts: z.number(),
        takeoffAircraftCount: z
          .number()
          .describe("Number of distinct aircraft identifiers that took off"),
        landingAircraftCount: z
          .number()
          .describe("Number of distinct aircraft identifiers that landed"),
        takeoffAircraft: z.array(
          z.object({
            aircraft: z.string(),
            count: z
              .number()
              .describe("Takeoff events by this aircraft in the bucket"),
            at: z
              .string()
              .nullable()
              .describe(
                "Timestamp (Asia/Jakarta, YYYY-MM-DDTHH:mm:ss) of this aircraft's most recent takeoff in the bucket",
              ),
          }),
        ),
        landingAircraft: z.array(
          z.object({
            aircraft: z.string(),
            count: z
              .number()
              .describe("Landing events by this aircraft in the bucket"),
            at: z
              .string()
              .nullable()
              .describe(
                "Timestamp (Asia/Jakarta, YYYY-MM-DDTHH:mm:ss) of this aircraft's most recent landing in the bucket",
              ),
          }),
        ),
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
    "Mengambil statistik operasional traffic, movement, alert, dan trend berdasarkan periode dan rentang tanggal. startTime/endTime opsional untuk membatasi ke jendela jam tertentu (HH:mm, exclusive-end) di setiap hari pada rentang tersebut.",
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

registry.registerPath({
  method: "get",
  path: "/statistics/operational/export",
  tags: ["Statistics"],
  summary: "Download operational statistics report (Excel)",
  description:
    "Laporan Excel (.xlsx) dengan filter yang sama seperti /statistics/operational: ringkasan eksekutif, tren per periode, lalu lintas, ringkasan alert, log alert, log pergerakan, dan legenda. Respons berupa berkas unduhan (Content-Disposition: attachment).",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: getOperationalStatisticsSchema,
  },
  responses: {
    200: {
      description: "Berkas laporan Excel",
      content: {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
          schema: z.string().openapi({ format: "binary" }),
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
