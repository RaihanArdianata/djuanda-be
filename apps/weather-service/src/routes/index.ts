import { Hono } from "hono";
import route from "@/modules/weather/route/weather.route";
import docs from "../docs/docs";
import health from "./health";

// docs harus di-mount SEBELUM /weather, karena weather.route.ts pasang
// `.use("/*", authentication)` yang jadi wildcard "/weather/*" di router ini.
// Kalau docs didaftarkan setelahnya, /weather/docs & /weather/openapi.json
// ikut kena auth middleware itu duluan (ketimbang langsung nyampe ke handler
// docs) dan bikin request docs error karena gak ada Bearer token.
const app = new Hono()
  .route("/health", health)
  .route("/", docs)
  .route("/weather", route);

export default app;