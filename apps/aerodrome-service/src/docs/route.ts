import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { openApiDocument } from "./openapi";

const app = new Hono()
  .get("/aerodrome/openapi.json", (c) => c.json(openApiDocument))
  .get("/aerodrome/docs", swaggerUI({ url: "/aerodrome/openapi.json" }));

export default app;
