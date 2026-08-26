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

const aftnMessageSchema = z.object({
  id: z.string().uuid(),
  providerId: z.string(),
  datetime: z.string(),
  messageType: z.string(),
  callSign: z.string().nullable(),
  registration: z.string().nullable(),
  aircraftType: z.string().nullable(),
  departure: z.string().nullable(),
  departureTime: z.string().nullable(),
  destination: z.string().nullable(),
  destinationTime: z.string().nullable(),
  duration: z.string().nullable(),
  speed: z.string().nullable(),
  altitude: z.string().nullable(),
  route: z.string().nullable(),
  raw: z.string(),
  parsed: z.record(z.string(), z.unknown()),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const aftnSyncResultSchema = z.object({
  totalReceived: z.number(),
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  failed: z.number(),
});

registry.registerPath({
  method: "get",
  path: "/advisory/aftn",
  tags: ["AFTN"],
  summary: "Daftar AFTN message dari database lokal",
  description:
    "Menyajikan AFTN message (FPL/DEP/ARR/DLA/CHG) yang sudah disinkronkan dari " +
    "provider setiap 30 menit. Mendukung filter, pagination, dan sorting. " +
    "Field yang tidak tersedia pada satu message type bernilai null, dan raw " +
    "message selalu disertakan.",
  request: {
    query: z.object({
      messageType: z
        .string()
        .optional()
        .describe("FPL | DEP | ARR | DLA | CHG"),
      callSign: z.string().optional(),
      registration: z.string().optional(),
      aircraftType: z.string().optional(),
      departure: z.string().optional().describe("ICAO, mis. WMKK"),
      destination: z.string().optional().describe("ICAO, mis. WBGS"),
      startDate: z.string().optional().describe("ISO 8601, filter datetime >="),
      endDate: z.string().optional().describe("ISO 8601, filter datetime <="),
      page: z.coerce.number().int().min(1).optional().describe("Default 1"),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Default 20, maks. 200"),
      sortBy: z
        .enum([
          "datetime",
          "messageType",
          "callSign",
          "registration",
          "aircraftType",
          "departure",
          "destination",
          "createdAt",
        ])
        .optional()
        .describe("Default datetime"),
      sortOrder: z.enum(["asc", "desc"]).optional().describe("Default desc"),
    }),
  },
  responses: {
    200: {
      description: "Berhasil mengambil daftar AFTN message",
      content: {
        "application/json": { schema: z.array(aftnMessageSchema) },
      },
    },
    422: {
      description: "Query parameter tidak valid",
      content: {
        "application/json": {
          schema: z.object({ error: z.string(), message: z.string() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/advisory/aftn/{id}",
  tags: ["AFTN"],
  summary: "Detail satu AFTN message (normalized + raw)",
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Berhasil mengambil detail AFTN message",
      content: { "application/json": { schema: aftnMessageSchema } },
    },
    404: {
      description: "AFTN message tidak ditemukan",
      content: {
        "application/json": {
          schema: z.object({ error: z.string(), message: z.string() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/advisory/aftn/sync",
  tags: ["AFTN"],
  summary: "Manual synchronization AFTN untuk satu rentang waktu",
  description:
    "Memicu sinkronisasi ke provider (POST /api/aftn) untuk window yang diminta. " +
    "Message di-upsert berdasarkan identity, sehingga rentang yang overlap dengan " +
    "scheduled sync tidak menghasilkan duplicate.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            startDate: z.string().describe("ISO 8601"),
            endDate: z.string().describe("ISO 8601"),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Sinkronisasi selesai",
      content: { "application/json": { schema: aftnSyncResultSchema } },
    },
    422: {
      description: "Body tidak valid",
      content: {
        "application/json": {
          schema: z.object({ error: z.string(), message: z.string() }),
        },
      },
    },
    502: upstreamErrorResponse(
      "Provider AFTN tidak dapat dihubungi / membalas error",
    ),
    504: upstreamErrorResponse(
      "Provider AFTN tidak merespons dalam batas waktu",
    ),
  },
});

const notamItemSchema = z
  .object({
    header: z.string().optional(),
    msg_id: z.string().optional(),
    fir: z.string().optional(),
    qcode: z.string().optional(),
    traffic: z.string().optional(),
    purpose: z.string().optional(),
    scope: z.string().optional(),
    lower_limit: z.string().optional(),
    upper_limit: z.string().optional(),
    coordinates: z.string().optional(),
    location: z.string().optional(),
    effective_time: z.string().optional(),
    expiration_time: z.string().optional(),
    schedule: z.string().optional(),
    remark: z.string().optional(),
    lower_altitude_limit: z.string().optional(),
    upper_altitude_limit: z.string().optional(),
    raw: z.unknown().optional(),
  })
  .partial()
  .passthrough();

const notamTriggerBodySchema = z.union([
  notamItemSchema,
  z.array(notamItemSchema),
]);

const notamFetchBodySchema = z.object({
  start_date: z.string().describe("YYYY-MM-DD HH:mm:ss"),
  end_date: z.string().describe("YYYY-MM-DD HH:mm:ss"),
});

const notamPublishBodySchema = z.object({
  eventType: z
    .enum(["NOTAM_RECEIVED", "NOTAM_UPDATED"])
    .optional()
    .describe("Default NOTAM_UPDATED"),
});

const successResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.unknown(),
});

const notamQuerySchema = z.object({
  airportId: z.string().describe("ICAO airport identifier"),
});

registry.registerPath({
  method: "post",
  path: "/advisory/notam/trigger",
  tags: ["NOTAM"],
  summary: "Manual trigger NOTAM",
  description:
    "Menerima satu NOTAM atau array NOTAM, menyimpannya, memetakan ke taxiway, " +
    "mengubah status taxiway yang cocok menjadi INACTIVE, dan menerbitkan event ke Redpanda.",
  request: {
    query: notamQuerySchema,
    body: {
      content: {
        "application/json": { schema: notamTriggerBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: "Trigger berhasil diproses",
      content: { "application/json": { schema: successResponseSchema } },
    },
    400: {
      description: "Body atau query tidak valid",
      content: {
        "application/json": {
          schema: z.object({ error: z.string(), message: z.string() }),
        },
      },
    },
    500: upstreamErrorResponse("Gagal memproses trigger NOTAM"),
  },
});

registry.registerPath({
  method: "post",
  path: "/advisory/notam/fetch",
  tags: ["NOTAM"],
  summary: "Ambil dan trigger NOTAM dari provider",
  description:
    "Memanggil provider /api/notam (auth sama seperti AFTN) untuk window yang diberikan, " +
    "lalu memproses setiap NOTAM seperti endpoint /advisory/notam/trigger.",
  request: {
    query: notamQuerySchema,
    body: {
      content: { "application/json": { schema: notamFetchBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Fetch dan trigger berhasil",
      content: { "application/json": { schema: successResponseSchema } },
    },
    400: {
      description: "Body atau query tidak valid",
      content: {
        "application/json": {
          schema: z.object({ error: z.string(), message: z.string() }),
        },
      },
    },
    502: upstreamErrorResponse("Provider NOTAM membalas error"),
    504: upstreamErrorResponse(
      "Provider NOTAM tidak merespons dalam batas waktu",
    ),
    500: upstreamErrorResponse("Gagal fetch dan trigger NOTAM"),
  },
});

registry.registerPath({
  method: "post",
  path: "/advisory/notam/publish",
  tags: ["NOTAM"],
  summary: "Publish event NOTAM ke Redpanda",
  description:
    "Menerbitkan event NOTAM_RECEIVED atau NOTAM_UPDATED untuk airportId yang dituju ke Redpanda. " +
    "Alert-service akan mengonsumsinya dan memperbarui context-nya.",
  request: {
    query: notamQuerySchema,
    body: {
      content: { "application/json": { schema: notamPublishBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Event berhasil dipublish",
      content: { "application/json": { schema: successResponseSchema } },
    },
    400: {
      description: "Body atau query tidak valid",
      content: {
        "application/json": {
          schema: z.object({ error: z.string(), message: z.string() }),
        },
      },
    },
    500: upstreamErrorResponse("Gagal publish NOTAM event"),
  },
});

export const openApiDocument = new OpenApiGeneratorV3(
  registry.definitions,
).generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Advisory Service API (NOTAM, ASHTAM & AFTN)",
    version: "1.1.0",
    description:
      "NOTAM & ASHTAM: bridge/proxy antara frontend dan NAVSIM. " +
      "AFTN: operational message yang disinkronkan dari provider setiap 30 menit " +
      "lalu disajikan dari database lokal sebagai source of truth. " +
      "Backend adalah satu-satunya pihak yang mengakses navsim.kemenhub.go.id " +
      "secara langsung.",
  },
});
