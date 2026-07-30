import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type ResponseConfig,
} from "@asteasolutions/zod-to-openapi";
import type { ReferenceObject } from "@asteasolutions/zod-to-openapi/dist/types";
import { z } from "zod";

const registry = new OpenAPIRegistry();

const notamHistoriesSuccessResponse = z.unknown();

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
  path: "/notam",
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

export const openApiDocument = new OpenApiGeneratorV3(
  registry.definitions,
).generateDocument({
  openapi: "3.0.0",
  info: {
    title: "NOTAM Service API",
    version: "1.0.0",
    description:
      "Bridge/proxy antara frontend dan NAVSIM untuk data NOTAM. Backend adalah " +
      "satu-satunya pihak yang mengakses navsim.kemenhub.go.id secara langsung.",
  },
});
