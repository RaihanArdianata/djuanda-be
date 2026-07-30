import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { openApiDocument } from "./openapi";

// Dipasang di /weather/* (bukan root) supaya konsisten dengan path endpoint
// weather yang sebenarnya (lihat src/routes/index.ts), dan tetap bisa diakses
// lewat gateway yang cuma proxy /weather/*.
const app = new Hono()
  .get("/weather/openapi.json", (c) => c.json(openApiDocument))
  .get("/weather/docs", swaggerUI({ url: "/weather/openapi.json" }));

export default app;
