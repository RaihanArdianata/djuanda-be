import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { openApiDocument } from "./openapi";

const app = new Hono()
  .get("/playback/openapi.json", (c) => c.json(openApiDocument))
  .get("/playback/docs", swaggerUI({ url: "/playback/openapi.json" }));

export default app;
