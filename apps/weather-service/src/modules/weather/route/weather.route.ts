import { authentication, rbacMiddleware } from "@repo/auth";
import { validate } from "@repo/validation";
import { Hono } from "hono";
import {
  getCurrent,
  getForecast,
  getHistory,
  getMetar,
  getSpeci,
  syncWeather,
} from "../controller/weather.controller";
import {
  getCurrentObservationSchema,
  getForecastSchema,
  getObservationHistorySchema,
} from "../validator/weather.validator";

// Sync manual hanya butuh login (bukan izin RBAC per-endpoint): tombol di panel
// cuaca dipakai semua operator. Router terpisah supaya wildcard RBAC di route
// lain tidak ikut memproses endpoint ini.
const syncRoute = new Hono().use("/*", authentication).post("/", syncWeather);

const protectedRoute = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get("/current", validate(getCurrentObservationSchema), getCurrent)
  .get("/history", validate(getObservationHistorySchema), getHistory)
  .get("/forecast", validate(getForecastSchema), getForecast)
  .get("/metar", validate(getCurrentObservationSchema), getMetar)
  .get("/speci", validate(getCurrentObservationSchema), getSpeci)
  .get("/taf", validate(getForecastSchema), getForecast);

const app = new Hono().route("/sync", syncRoute).route("/", protectedRoute);

export default app;
