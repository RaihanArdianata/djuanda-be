import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type ResponseConfig,
} from "@asteasolutions/zod-to-openapi";
import type { ReferenceObject } from "@asteasolutions/zod-to-openapi/dist/types";
import { z } from "zod";

const registry = new OpenAPIRegistry();

const notamHistoriesSuccessResponse = z.unknown();

const ashtamItemSchema = z.object({
  serialNumber: z.string().nullable(),
  flightInformation: z.string().nullable(),
  startDateTime: z.string().nullable(),
  nameOfVolcano: z.string().nullable(),
  codeOfVolcano: z.string().nullable(),
  colourCode: z.string().nullable(),
  affectedArea: z.string().nullable(),
  direction: z.string().nullable(),
  airRouteAndPortions: z.string().nullable(),
  closuresOfAirspace: z.string().nullable(),
  informationSource: z.string().nullable(),
  remark: z.string().nullable(),
  receivedTime: z.string().nullable(),
  header: z.string().nullable(),
  body: z.string().nullable(),
  sequence: z.string().nullable(),
  messageType: z.string().nullable(),
  updateTimestamp: z.string().nullable(),
  updateDelete: z.string().nullable(),
  coordinatesAndRadius: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      radiusNm: z.number(),
      origin: z.string().nullable(),
    })
    .nullable(),
  affectedAreaWkt: z.string().nullable(),
});

const ashtamHistoriesSuccessResponse = z.array(ashtamItemSchema);

const upstreamErrorResponse = (
  description: string,
): ResponseConfig | ReferenceObject => ({
  description,
  content: {
    "application/json": {
      schema: z.object({
        error: z.string(),
        message: z.string(),
      }),
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/advisory/notam",
  tags: ["NOTAM"],
  summary: "Ambil data NOTAM (proxy ke NAVSIM notam-histories, size=2000)",
  description:
    "Backend meneruskan request ini ke NAVSIM (GET /serv_bdg/api/notam-histories?size=2000) " +
    "dan mengembalikan response-nya apa adanya. Ini satu-satunya jalur resmi untuk mengambil " +
    "data NOTAM — frontend tidak lagi mengakses NAVSIM secara langsung.",
  responses: {
    200: {
      description: "Berhasil mengambil data NOTAM dari NAVSIM",
      content: {
        "application/json": { schema: notamHistoriesSuccessResponse },
      },
    },
    502: upstreamErrorResponse(
      "Gagal menghubungi NAVSIM, atau NAVSIM membalas dengan error / body yang tidak valid",
    ),
    504: upstreamErrorResponse(
      "NAVSIM tidak merespons dalam batas waktu yang ditentukan",
    ),
    500: upstreamErrorResponse("Error tak terduga di notam-service"),
  },
});

registry.registerPath({
  method: "get",
  path: "/advisory/ashtam",
  tags: ["ASHTAM"],
  summary:
    "Ambil data ASHTAM (proxy ke NAVSIM ashtam-histories, size default 2000)",
  description:
    "Backend meneruskan request ini ke NAVSIM (GET /serv_bdg/api/ashtam-histories) " +
    "dan mengembalikan response-nya apa adanya. Mendukung filter opsional " +
    "`startDateTime.lessThan` (ISO 8601) dan override `size` (maks. 5000). " +
    "Ini satu-satunya jalur resmi untuk mengambil data ASHTAM — frontend tidak lagi " +
    "mengakses NAVSIM secara langsung.",
  request: {
    query: z.object({
      "startDateTime.lessThan": z
        .string()
        .datetime()
        .optional()
        .describe("ISO 8601, contoh: 2026-04-21T00:00:00Z"),
      size: z.coerce
        .number()
        .int()
        .positive()
        .max(5000)
        .optional()
        .describe("Default 2000 jika tidak diisi"),
    }),
  },
  responses: {
    200: {
      description: "Berhasil mengambil data ASHTAM dari NAVSIM",
      content: {
        "application/json": { schema: ashtamHistoriesSuccessResponse },
      },
    },
    400: {
      description: "Query parameter tidak valid",
      content: {
        "application/json": {
          schema: z.object({ error: z.string(), message: z.string() }),
        },
      },
    },
    502: upstreamErrorResponse(
      "Gagal menghubungi NAVSIM, atau NAVSIM membalas dengan error / body yang tidak valid",
    ),
    504: upstreamErrorResponse(
      "NAVSIM tidak merespons dalam batas waktu yang ditentukan",
    ),
    500: upstreamErrorResponse("Error tak terduga di ashtam-service"),
  },
});

export const openApiDocument = new OpenApiGeneratorV3(
  registry.definitions,
).generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Advisory Service API (NOTAM & ASHTAM)",
    version: "1.0.0",
    description:
      "Bridge/proxy antara frontend dan NAVSIM untuk data NOTAM dan ASHTAM. " +
      "Backend adalah satu-satunya pihak yang mengakses navsim.kemenhub.go.id " +
      "secara langsung.",
  },
});
