import { beforeEach, describe, expect, it, mock } from "bun:test";
// @repo/shared's rate limiter creates a Redis client at module load time --
// stub ioredis so importing the controller never dials localhost:6379.
import { FakeRedis } from "@repo/shared/testing/fakeRedis";
import type {
  PlaybackControlRequest,
  PlaybackSessionRecord,
} from "../schema/playback.schema";

// Shared fake (packages/shared/src/testing/fakeRedis.ts) � mock.module is
// process-wide in bun test; all files must register the same fake.
mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

// The engine owns the in-memory tick loop + Redis stream publishing, and the
// session service owns Redis persistence -- mock both so these tests exercise
// only routing/validation/controller logic, with no Redis or DB access.
const applyControl = mock(
  async (
    _sessionId: string,
    _control: PlaybackControlRequest,
  ): Promise<void> => {},
);
const disposeEngine = mock((_sessionId: string): void => {});

mock.module("../services/playback-engine.service", () => ({
  applyControl,
  disposeEngine,
}));

const createSessionRecord = mock(
  async (_params: {
    airportId: string;
    from: Date;
    to: Date;
    speed: number;
  }): Promise<PlaybackSessionRecord> => sampleSession,
);
const getSessionRecord = mock(
  async (_sessionId: string): Promise<PlaybackSessionRecord | null> => null,
);
const saveSessionRecord = mock(
  async (_record: PlaybackSessionRecord): Promise<void> => {},
);
const deleteSessionRecord = mock(
  async (_sessionId: string): Promise<void> => {},
);

mock.module("../services/playback-session.service", () => ({
  createSessionRecord,
  getSessionRecord,
  saveSessionRecord,
  deleteSessionRecord,
}));

// Imported dynamically, after the mocks above are registered, so the route
// (via the controller) picks up the mocked services instead of the real ones.
const { default: playbackRoute } = await import("./playback.route");

const sampleSession: PlaybackSessionRecord = {
  id: "sess-1",
  airportId: "WARR",
  from: "2026-07-08T05:00:00.000Z",
  to: "2026-07-08T06:00:00.000Z",
  speed: 1,
  status: "created",
  cursor: Date.parse("2026-07-08T05:00:00.000Z"),
  createdAt: "2026-07-08T04:55:00.000Z",
};

const validCreateBody = {
  airportId: "WARR",
  from: "2026-07-08T05:00:00.000Z",
  to: "2026-07-08T06:00:00.000Z",
  speed: 2,
};

const postJson = (path: string, body: unknown): Promise<Response> =>
  Promise.resolve(
    playbackRoute.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  applyControl.mockReset();
  disposeEngine.mockReset();
  createSessionRecord.mockReset();
  getSessionRecord.mockReset();
  saveSessionRecord.mockReset();
  deleteSessionRecord.mockReset();

  createSessionRecord.mockResolvedValue(sampleSession);
});

describe("POST /sessions", () => {
  it("creates a session and returns it in the ApiResponse envelope", async () => {
    const res = await postJson("/sessions", validCreateBody);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.meta.code).toBe(201);
    expect(body.error).toBeNull();
    expect(body.data.session.id).toBe("sess-1");
    expect(body.data.wsPath).toBe("/api/worker/ws/playback/sess-1");
  });

  it("forwards the parsed body to createSessionRecord", async () => {
    await postJson("/sessions", validCreateBody);

    expect(createSessionRecord).toHaveBeenCalledTimes(1);
    const params = createSessionRecord.mock.calls[0][0];
    expect(params.airportId).toBe("WARR");
    expect(params.speed).toBe(2);
    expect(params.from).toEqual(new Date(validCreateBody.from));
    expect(params.to).toEqual(new Date(validCreateBody.to));
  });

  it("returns 400 VALIDATION_ERROR when the body fails the schema", async () => {
    const res = await postJson("/sessions", {
      from: "not-a-date",
      to: "2026-07-08T06:00:00.000Z",
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.data).toBeNull();
    expect(body.meta.status).toBe("ERROR");
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createSessionRecord).not.toHaveBeenCalled();
  });

  it("returns 400 BAD_REQUEST when `from` is not before `to`", async () => {
    const res = await postJson("/sessions", {
      ...validCreateBody,
      from: "2026-07-08T07:00:00.000Z",
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(createSessionRecord).not.toHaveBeenCalled();
  });
});

describe("GET /sessions/:id", () => {
  it("returns the session when it exists", async () => {
    getSessionRecord.mockResolvedValue(sampleSession);

    const res = await playbackRoute.request("/sessions/sess-1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data.id).toBe("sess-1");
    expect(getSessionRecord).toHaveBeenCalledWith("sess-1");
  });

  it("responds with a NOT_FOUND error contract when the session is missing", async () => {
    getSessionRecord.mockResolvedValue(null);

    const res = await playbackRoute.request("/sessions/unknown");
    const body = await res.json();

    // The controller deliberately overrides NOT_FOUND to HTTP 200.
    expect(res.status).toBe(200);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("POST /sessions/:id/control", () => {
  it("applies a valid control action and returns the updated session", async () => {
    const pausedSession: PlaybackSessionRecord = {
      ...sampleSession,
      status: "paused",
    };
    getSessionRecord.mockResolvedValue(pausedSession);

    const res = await postJson("/sessions/sess-1/control", {
      action: "pause",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data.status).toBe("paused");
    expect(applyControl).toHaveBeenCalledWith("sess-1", {
      action: "pause",
    } satisfies PlaybackControlRequest);
  });

  it("returns 400 VALIDATION_ERROR for an unknown control action", async () => {
    const res = await postJson("/sessions/sess-1/control", {
      action: "rewind",
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(applyControl).not.toHaveBeenCalled();
  });
});

describe("DELETE /sessions/:id", () => {
  it("disposes the engine and removes the session record", async () => {
    const res = await playbackRoute.request("/sessions/sess-1", {
      method: "DELETE",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(disposeEngine).toHaveBeenCalledWith("sess-1");
    expect(deleteSessionRecord).toHaveBeenCalledWith("sess-1");
  });
});
