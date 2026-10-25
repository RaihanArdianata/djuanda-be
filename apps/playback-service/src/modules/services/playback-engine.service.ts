import { logger } from "@repo/logger";
import ApiError from "@repo/shared/api-error";
import { redis, streamChannel } from "../../redis/client";
import type {
  PlaybackControlRequest,
  TimelineEvent,
} from "../schema/playback.schema";
import { loadTimeline } from "./playback-data.service";
import {
  getSessionRecord,
  saveSessionRecord,
} from "./playback-session.service";

const TICK_MS = Number(process.env.PLAYBACK_TICK_MS ?? 500);

interface EngineState {
  timeline: TimelineEvent[];
  cursorIndex: number; // pointer into timeline, events before this index have been emitted
  interval?: ReturnType<typeof setInterval>;
}

// Engine state lives in this process's memory. Redis only carries the
// published events and the session's persisted status/cursor, so the
// REST API stays stateless while a single engine instance drives the clock.
// Running multiple instances would need the tick loop pinned to one
// instance per session (e.g. via a Redis lock) — out of scope for now.
const engines = new Map<string, EngineState>();
const enginePromises = new Map<string, Promise<EngineState>>();

export function ensureEngine(
  sessionId: string,
  airportId: string,
  from: Date,
  to: Date,
  fileId?: string,
): Promise<EngineState> {
  const existing = engines.get(sessionId);
  if (existing) return Promise.resolve(existing);

  let pending = enginePromises.get(sessionId);
  if (!pending) {
    pending = (async (): Promise<EngineState> => {
      try {
        // Loaded lazily: time-range sessions never import the files module
        // (minio/bullmq/playback_files), so their module graph stays exactly
        // what it was before playback files existed.
        const timeline = fileId
          ? await (
              await import("../files/playback-files.service")
            ).loadEventsFromFile(fileId)
          : await loadTimeline(airportId, from, to);
        const engine: EngineState = { timeline, cursorIndex: 0 };
        engines.set(sessionId, engine);
        return engine;
      } finally {
        enginePromises.delete(sessionId);
      }
    })();
    enginePromises.set(sessionId, pending);
  }
  return pending;
}

export async function applyControl(
  sessionId: string,
  control: PlaybackControlRequest,
): Promise<void> {
  const session = await getSessionRecord(sessionId);
  if (!session)
    throw new ApiError("NOT_FOUND", {
      message: "Session not found",
      statusCode: 200,
    });

  const engine = await ensureEngine(
    sessionId,
    session.airportId,
    new Date(session.from),
    new Date(session.to),
    session.fileId,
  );

  switch (control.action) {
    case "play": {
      session.status = "playing";
      await saveSessionRecord(session);
      startTicking(sessionId);
      break;
    }
    case "pause": {
      session.status = "paused";
      await saveSessionRecord(session);
      stopTicking(sessionId);
      break;
    }
    case "stop": {
      session.status = "stopped";
      await saveSessionRecord(session);
      stopTicking(sessionId);
      break;
    }
    case "seek": {
      if (control.value === undefined)
        throw new ApiError("BAD_REQUEST", {
          message: "seek requires a value (epoch ms)",
        });
      const toMs = new Date(session.to).getTime();
      const fromMs = new Date(session.from).getTime();
      session.cursor = Math.min(Math.max(control.value, fromMs), toMs);
      // Re-point the cursor index to match the new position so we don't
      // replay already-past events or skip ones we jumped backward over.
      engine.cursorIndex = engine.timeline.findIndex(
        (e) => e.ts > session.cursor,
      );
      if (engine.cursorIndex === -1)
        engine.cursorIndex = engine.timeline.length;
      await saveSessionRecord(session);
      break;
    }
    case "set_speed": {
      if (
        control.value === undefined ||
        control.value <= 0 ||
        control.value > 16
      )
        throw new ApiError("BAD_REQUEST", {
          message: "set_speed requires a positive value of at most 16",
        });
      session.speed = control.value;
      await saveSessionRecord(session);
      break;
    }
  }
}

function startTicking(sessionId: string): void {
  const engine = engines.get(sessionId);
  if (!engine || engine.interval) return; // already ticking

  engine.interval = setInterval(
    () =>
      tick(sessionId).catch((err) => logger.error("playback tick failed", err)),
    TICK_MS,
  );
}

function stopTicking(sessionId: string): void {
  const engine = engines.get(sessionId);
  if (engine?.interval) {
    clearInterval(engine.interval);
    engine.interval = undefined;
  }
}

async function tick(sessionId: string): Promise<void> {
  const engine = engines.get(sessionId);
  const session = await getSessionRecord(sessionId);
  if (!engine || !session || session.status !== "playing") {
    stopTicking(sessionId);
    if (!session) engines.delete(sessionId);
    return;
  }

  const toMs = new Date(session.to).getTime();
  const nextCursor = Math.min(session.cursor + TICK_MS * session.speed, toMs);

  const dueEvents: TimelineEvent[] = [];
  while (
    engine.cursorIndex < engine.timeline.length &&
    engine.timeline[engine.cursorIndex].ts <= nextCursor
  ) {
    dueEvents.push(engine.timeline[engine.cursorIndex]);
    engine.cursorIndex++;
  }

  for (const event of dueEvents) {
    await redis.publish(streamChannel(sessionId), JSON.stringify(event));
  }

  session.cursor = nextCursor;
  await saveSessionRecord(session);

  await redis.publish(
    streamChannel(sessionId),
    JSON.stringify({ type: "session_state", data: session }),
  );

  if (nextCursor >= toMs) {
    session.status = "finished";
    await saveSessionRecord(session);
    await redis.publish(
      streamChannel(sessionId),
      JSON.stringify({
        type: "finished",
        ts: nextCursor,
        timestamp: new Date(nextCursor).toISOString(),
        data: null,
      }),
    );
    stopTicking(sessionId);
  }
}

export function disposeEngine(sessionId: string): void {
  stopTicking(sessionId);
  engines.delete(sessionId);
}
