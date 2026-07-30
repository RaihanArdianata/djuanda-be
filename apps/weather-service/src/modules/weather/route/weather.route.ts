import {
  authentication,
  rbacMiddleware,
} from "@repo/auth-service/src/middleware/auth.middleware";
import { validate } from "@repo/validation";
import { Hono } from "hono";
import {
  getCurrent,
  getForecast,
  getHistory,
} from "../controller/weather.controller";
import {
  getCurrentObservationSchema,
  getForecastSchema,
  getObservationHistorySchema,
} from "../validator/weather.validator";

const app = new Hono()
  .use("/*", authentication)
  .use("/*", rbacMiddleware)
  .get("/current", validate(getCurrentObservationSchema), getCurrent)
  .get("/history", validate(getObservationHistorySchema), getHistory)
  .get("/forecast", validate(getForecastSchema), getForecast);

export default app;
