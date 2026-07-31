import { listFeatureResultSchema } from "@/modules/feature/service/feature.service";
import {
  createFeatureSchema,
  listFeatureQuerySchema,
  updateFeatureSchema,
} from "@/modules/feature/validator/feature.validator";
import {
  addPreviewFeatureSchema,
  importSessionSchema,
  updatePreviewFeatureSchema,
} from "@/modules/import/validator/import.validator";
import { layerFilterSchema } from "@/modules/layer/validator/layer.validator";
import { GeoJsonSchema } from "@/types/geojson";
import { layerSchema } from "@/types/layer";
import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
  type ResponseConfig,
} from "@asteasolutions/zod-to-openapi";
import type { ReferenceObject } from "@asteasolutions/zod-to-openapi/dist/types";
import {
  aerodromeImportFeaturesSelectSchema,
  aerodromeImportsSelectSchema,
  aerodromeImportWithFeaturesSelectSchema,
} from "@repo/database";
import z from "zod";

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
  method: "get",
  path: "/aerodrome/export",
  tags: ["Export"],
  summary: "Export data master aerodrome",
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: successResponse("Success", GeoJsonSchema),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "get",
  path: "/aerodrome/layers",
  tags: ["Layer"],
  summary: "Get all layers",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: layerFilterSchema.describe(
      "Filter layers by name. If not provided, all layers will be returned.",
    ),
  },
  responses: {
    200: successResponse(
      "Success",
      layerSchema.array().describe("List of layers"),
    ),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "get",
  path: "/aerodrome/features",
  tags: ["Feature"],
  summary: "Get all features",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: listFeatureQuerySchema.describe(
      "Query parameters for listing features. If not provided, default values will be used.",
    ),
  },
  responses: {
    200: successResponse(
      "Success",
      listFeatureResultSchema.describe("List of features"),
    ),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "get",
  path: "/aerodrome/features/{id}",
  tags: ["Feature"],
  summary: "Get feature by ID",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ id: z.uuid() }).describe("Feature ID"),
  },
  responses: {
    200: successResponse("Success", GeoJsonSchema.describe("Feature data")),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Feature not found"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "post",
  path: "/aerodrome/features",
  tags: ["Feature"],
  summary: "Create a new feature",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createFeatureSchema.describe(
            "Feature data to create. The 'layer' field must be a valid layer name.",
          ),
        },
      },
    },
  },
  responses: {
    201: successResponse(
      "Feature created",
      GeoJsonSchema.describe("Created feature data"),
    ),
    400: errorResponse("Validation failed"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/aerodrome/features/{id}",
  tags: ["Feature"],
  summary: "Update a feature by ID",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ id: z.uuid() }).describe("Feature ID"),
    body: {
      content: {
        "application/json": {
          schema: updateFeatureSchema.describe(
            "Feature data to update. The 'layer' field must be a valid layer name.",
          ),
        },
      },
    },
  },
  responses: {
    200: successResponse(
      "Feature updated",
      GeoJsonSchema.describe("Updated feature data"),
    ),
    400: errorResponse("Validation failed"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Feature not found"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/aerodrome/features/{id}",
  tags: ["Feature"],
  summary: "Delete a feature by ID",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ id: z.uuid() }).describe("Feature ID"),
  },
  responses: {
    204: { description: "Feature deleted" },
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Feature not found"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "post",
  path: "/aerodrome/import",
  tags: ["Import"],
  summary: "Create a new import session",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: importSessionSchema.describe(
            "Import session data. The 'file' field must be a valid GeoJSON file.",
          ),
        },
      },
    },
  },
  responses: {
    201: successResponse(
      "Import session created",
      aerodromeImportsSelectSchema.describe("Created import session data"),
    ),
    400: errorResponse("Validation failed"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "get",
  path: "/aerodrome/import/{importId}",
  tags: ["Import"],
  summary: "Get import session by ID",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ importId: z.uuid() }).describe("Import session ID"),
  },
  responses: {
    200: successResponse(
      "Success",
      aerodromeImportWithFeaturesSelectSchema.describe("Import session data"),
    ),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Import session not found"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/aerodrome/import/{importId}/features/{featureId}",
  tags: ["Import"],
  summary: "Update a preview feature in an import session",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      importId: z.uuid().describe("Import session ID"),
      featureId: z.uuid().describe("Preview feature ID"),
    }),
    body: {
      content: {
        "application/json": {
          schema: updatePreviewFeatureSchema.describe(
            "Preview feature data to update. The 'layer' field must be a valid layer name.",
          ),
        },
      },
    },
  },
  responses: {
    200: successResponse(
      "Preview feature updated",
      aerodromeImportFeaturesSelectSchema.describe(
        "Updated preview feature data",
      ),
    ),
    400: errorResponse("Validation failed"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Import session or preview feature not found"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/aerodrome/import/{importId}/features/{featureId}",
  tags: ["Import"],
  summary: "Delete a preview feature in an import session",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      importId: z.uuid().describe("Import session ID"),
      featureId: z.uuid().describe("Preview feature ID"),
    }),
  },
  responses: {
    200: successResponse(
      "Preview feature deleted",
      z.null().describe("No content"),
    ),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Import session or preview feature not found"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "post",
  path: "/aerodrome/import/{importId}/features",
  tags: ["Import"],
  summary: "Add a new preview feature to an import session",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      importId: z.uuid().describe("Import session ID"),
    }),
    body: {
      content: {
        "application/json": {
          schema: addPreviewFeatureSchema.describe(
            "Preview feature data to add. The 'layer' field must be a valid layer name.",
          ),
        },
      },
    },
  },
  responses: {
    201: successResponse(
      "Preview feature added",
      aerodromeImportFeaturesSelectSchema.describe(
        "Added preview feature data",
      ),
    ),
    400: errorResponse("Validation failed"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Import session not found"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "post",
  path: "/aerodrome/import/{importId}/commit",
  tags: ["Import"],
  summary: "Commit an import session",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      importId: z.uuid().describe("Import session ID"),
    }),
  },
  responses: {
    200: successResponse(
      "Import session committed",
      aerodromeImportsSelectSchema.describe("Committed import session data"),
    ),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Import session not found"),
    500: errorResponse("Internal Server Error"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/aerodrome/import/{importId}",
  tags: ["Import"],
  summary: "Cancel an import session",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      importId: z.uuid().describe("Import session ID"),
    }),
  },
  responses: {
    200: successResponse(
      "Import session canceled",
      aerodromeImportsSelectSchema.describe("Canceled import session data"),
    ),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Import session not found"),
    500: errorResponse("Internal Server Error"),
  },
});

export const openApiDocument = new OpenApiGeneratorV3(
  registry.definitions,
).generateDocument({
  openapi: "3.1.0",
  info: {
    title: "Aerodrome Management Service API",
    version: "1.0.0",
    description:
      "API untuk AJ-43 - master data spasial (GeoJSON) Aerodrome Bandara Juanda (A-SMGCS).",
  },
  tags: [
    { name: "Layer", description: "Daftar layer peta" },
    { name: "Feature", description: "CRUD Feature GeoJSON (master data)" },
    {
      name: "Import",
      description: "Upload, preview, edit, dan commit GeoJSON",
    },
    { name: "Export", description: "Export master data" },
  ],
});
