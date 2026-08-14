import { validate } from "@repo/validation";
import { Hono } from "hono";
import {
  controlPlaybackSession,
  createPlaybackSession,
  deletePlaybackSession,
  getPlaybackSessionById,
} from "../controller/playback.controller";
import { controlSchema, createSessionSchema } from "../schema/playback.schema";

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
