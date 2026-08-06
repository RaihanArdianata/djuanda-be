import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { openApiDocument } from "./openapi";

// Dipasang di /advisory/* (bukan root) supaya Swagger UI untuk NOTAM dan
// ASHTAM satu pintu, dan tetap bisa diakses lewat gateway yang proxy
// /advisory/*. openApiDocument sendiri sudah berisi definisi kedua endpoint
// (/notam dan /ashtam) — lihat src/docs/openapi.ts — jadi cukup satu mount.
const app = new Hono()
  .get("/advisory/openapi.json", (c) => c.json(openApiDocument))
  .get("/advisory/docs", swaggerUI({ url: "/advisory/openapi.json" }));

export default app;
