import { ApiError, catchAsync, success } from "@repo/shared";
import type {
  CreateSessionRequest,
  PlaybackControlRequest,
} from "../schema/playback.schema";
import {
  applyControl,
  disposeEngine,
  primeEngine,
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
  const eventCount = await primeEngine(session.id, session.airportId, from, to);

  return success(
    c,
    { session, eventCount, wsPath: `/api/worker/ws/playback/${session.id}` },
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
