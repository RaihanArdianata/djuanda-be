import { Hono } from "hono";

import { fetchNotamController } from "../controller/notam.fetch.controller";
import { publishNotamEventController } from "../controller/notam.publish.controller";
import { triggerNotamController } from "../controller/notam.trigger.controller";

const app = new Hono()
  .post("/trigger", triggerNotamController)
  .post("/fetch", fetchNotamController)
  .post("/publish", publishNotamEventController);

export default app;
