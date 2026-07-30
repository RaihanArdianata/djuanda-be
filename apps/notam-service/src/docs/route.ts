import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { openApiDocument } from "./openapi";

// Dipasang di /notam/* (bukan root) supaya konsisten dengan path endpoint
// notam yang sebenarnya, dan tetap bisa diakses lewat gateway yang cuma
// proxy /notam/*.
const app = new Hono()
  .get("/notam/openapi.json", (c) => c.json(openApiDocument))
  .get("/notam/docs", swaggerUI({ url: "/notam/openapi.json" }));

export default app;
