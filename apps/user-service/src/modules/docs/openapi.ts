import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type ResponseConfig,
} from "@asteasolutions/zod-to-openapi";
import type { ReferenceObject } from "@asteasolutions/zod-to-openapi/dist/types";
import z from "zod";
import {
  createUserSchema,
  getAllUsersSchema,
  updateUserPasswordSchema,
  updateUserSchema,
} from "../user/validator/user.validator";

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

registry.registerPath({
  method: "post",
  path: "/users",
  tags: ["Users"],
  security: [{ [bearerAuth.name]: [] }],
  summary: "Create a new user",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createUserSchema,
        },
      },
    },
  },
  responses: {
    "201": {
      description: "User created successfully",
    },
    "400": errorResponse("Bad Request"),
    "401": errorResponse("Unauthorized"),
    "403": errorResponse("Forbidden"),
  },
});

registry.registerPath({
  method: "get",
  path: "/users",
  tags: ["Users"],
  summary: "Get all or filtered users",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: getAllUsersSchema,
  },
  responses: {
    200: {
      description: "Successfully retrieved all users",
    },
    400: errorResponse("Bad Request"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Update user by ID",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      id: z.uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: updateUserSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Successfully updated user by ID",
    },
    400: errorResponse("Bad Request"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("User not found"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Delete user by ID",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      id: z.uuid(),
    }),
  },
  responses: {
    200: {
      description: "Successfully deleted user by ID",
    },
    400: errorResponse("Bad Request"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("User not found"),
  },
});

registry.registerPath({
  method: "put",
  path: "/users/{id}/update-password",
  tags: ["Users"],
  summary: "Update user password by ID",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      id: z.uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: updateUserPasswordSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Successfully updated user password by ID",
    },
    400: errorResponse("Bad Request"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("Forbidden"),
    404: errorResponse("User not found"),
  },
});

export const openApiDocument = new OpenApiGeneratorV3(
  registry.definitions,
).generateDocument({
  openapi: "3.0.0",
  info: {
    title: "User Service API",
    version: "1.0.0",
    description: "API documentation for the User Service",
  },
});
