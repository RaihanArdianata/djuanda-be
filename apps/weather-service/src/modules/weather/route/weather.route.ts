import { authentication, rbacMiddleware } from "@repo/auth";
import { validate } from "@repo/validation";
import { Hono } from "hono";
import {
  getCurrent,
  getForecast,
  getHistory,
  getMetar,
  getSpeci,
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

app.get("/metar", validate(getCurrentObservationSchema), getMetar);
app.get("/speci", validate(getCurrentObservationSchema), getSpeci);
app.get("/taf", validate(getForecastSchema), getForecast);

export default app;
