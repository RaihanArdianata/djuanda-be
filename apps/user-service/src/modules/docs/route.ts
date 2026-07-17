import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { openApiDocument } from "./openapi";

const app = new Hono()
  .get("/users/openapi.json", (c) => c.json(openApiDocument))
  .get("/users/docs", swaggerUI({ url: "/users/openapi.json" }));

export default app;
