import ApiError from "@repo/shared/api-error";
import { success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
import type {
  CreateSessionRequest,
  PlaybackControlRequest,
} from "../schema/playback.schema";
import {
  applyControl,
  disposeEngine,
} from "../services/playback-engine.service";
import {
  createSessionRecord,
  deleteSessionRecord,
  getSessionRecord,
} from "../services/playback-session.service";

export const createPlaybackSession = catchAsync(async (c) => {
  const body = c.get("parsedData") as CreateSessionRequest;
  const from = new Date(body.from);
  const to = new Date(body.to);
  if (from >= to)
    throw new ApiError("BAD_REQUEST", {
      message: "`from` must be before `to`",
    });

  const session = await createSessionRecord({
    airportId: body.airportId,
    from,
    to,
    speed: body.speed,
  });
  // The timeline is loaded lazily by ensureEngine() when the websocket
  // connects/plays — priming here would block the create response on a
  // full loadTimeline scan and the in-memory engine wouldn't even live in
  // the same process that serves the websocket.

  return success(
    c,
    { session, wsPath: `/api/worker/ws/playback/${session.id}` },
    {
      message: "Playback session created successfully",
      code: 201,
    },
  );
});

export const getPlaybackSessionById = catchAsync(async (c) => {
  const session = await getSessionRecord(c.req.param("id") as string);
  if (!session)
    throw new ApiError("NOT_FOUND", {
      message: "Session not found",
      statusCode: 200,
    });
  return success(c, session, { message: "Session retrieved successfully" });
});

export const controlPlaybackSession = catchAsync(async (c) => {
  const sessionId = c.req.param("id") as string;
  const control = c.get("parsedData") as PlaybackControlRequest;

  await applyControl(sessionId, control);

  const session = await getSessionRecord(sessionId);
  return success(c, session, { message: "Control applied successfully" });
});

export const deletePlaybackSession = catchAsync(async (c) => {
  const sessionId = c.req.param("id") as string;
  disposeEngine(sessionId);
  await deleteSessionRecord(sessionId);
  return success(c, null, {
    message: "Playback session deleted successfully",
    code: 200,
  });
});
