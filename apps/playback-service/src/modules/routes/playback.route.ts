import { validate } from "@repo/validation";
import { Hono } from "hono";
import {
  controlPlaybackSession,
  createPlaybackSession,
  deletePlaybackSession,
  getPlaybackSessionById,
} from "../controller/playback.controller";
import playbackFilesRoute from "../files/playback-files.route";
import { controlSchema, createSessionSchema } from "../schema/playback.schema";

const app = new Hono()
  .route("/", playbackFilesRoute)
  .post("/sessions", validate(createSessionSchema), createPlaybackSession)
  .get("/sessions/:id", getPlaybackSessionById)
  .post(
    "/sessions/:id/control",
    validate(controlSchema),
    controlPlaybackSession,
  )
  .delete("/sessions/:id", deletePlaybackSession);

export default app;
