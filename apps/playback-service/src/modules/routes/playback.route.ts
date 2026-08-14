import { Hono } from "hono";
import {
  controlSchema,
  createSessionSchema,
} from "@/modules/schema/playback.schema";
import {
  controlPlaybackSession,
  createPlaybackSession,
  deletePlaybackSession,
  getPlaybackSessionById,
} from "@/modules/controller/playback.controller";
import { validate } from "@repo/validation";

const app = new Hono()
  .post("/sessions", validate(createSessionSchema), createPlaybackSession)
  .get("/sessions/:id", getPlaybackSessionById)
  .post(
    "/sessions/:id/control",
    validate(controlSchema),
    controlPlaybackSession,
  )
  .delete("/sessions/:id", deletePlaybackSession);

export default app;
