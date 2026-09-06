import { beforeEach, describe, expect, it, mock } from "bun:test";
import { FakeRedis, fakeRedis } from "@repo/shared/testing/fakeRedis";

// The SSE fan-out goes through Redis pub/sub -- stub ioredis so no real
// connection to localhost:6379 is attempted. The fake is shared
// (packages/shared/src/testing/fakeRedis.ts) because mock.module is
// process-wide in bun test: all files must register the same fake or another
// file's partial stub wins and this suite fails.
mock.module("ioredis", () => ({
  default: FakeRedis,
  Redis: FakeRedis,
}));

// Imported dynamically, after the ioredis mock is registered, so the module
//-level `new Redis(...)` publisher picks up the fake.
const { publishToTopic, subscribeToTopic } = await import("./service");

beforeEach(() => {
  fakeRedis.reset();
});

describe("publishToTopic", () => {
  it("publishes string payloads as-is on the events:<topic> channel", async () => {
    await publishToTopic("alerts", "raw-payload");

    expect(fakeRedis.state.published).toEqual([
      { channel: "events:alerts", message: "raw-payload" },
    ]);
  });

  it("serializes non-string payloads to JSON before publishing", async () => {
    await publishToTopic("weather", { station: "WARR", kind: "METAR" });

    expect(fakeRedis.state.published).toEqual([
      {
        channel: "events:weather",
        message: '{"station":"WARR","kind":"METAR"}',
      },
    ]);
  });
});

describe("subscribeToTopic", () => {
  it("subscribes a dedicated connection to the events:<topic> channel", () => {
    subscribeToTopic("alerts", mock());

    expect(fakeRedis.state.duplicateCalls).toBe(1);
    expect(fakeRedis.state.subscriptions).toEqual(["events:alerts"]);
  });

  it("invokes the handler only for messages on the matching channel", () => {
    const onMessage = mock((_message: string): void => {});
    subscribeToTopic("alerts", onMessage);

    fakeRedis.emit("events:other", "skip-me");
    expect(onMessage).not.toHaveBeenCalled();

    fakeRedis.emit("events:alerts", "deliver-me");
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith("deliver-me");
  });

  it("unsubscribes and quits the dedicated connection on cleanup", async () => {
    const unsubscribe = subscribeToTopic("alerts", mock());

    await unsubscribe();

    expect(fakeRedis.state.removedListenerEvents).toContain("message");
    expect(fakeRedis.state.unsubscriptions).toEqual(["events:alerts"]);
    expect(fakeRedis.state.quitCalls).toBe(1);
  });

  it("cleanup is idempotent -- a second call does not touch redis again", async () => {
    const unsubscribe = subscribeToTopic("alerts", mock());

    await unsubscribe();
    await unsubscribe();

    expect(fakeRedis.state.unsubscriptions).toHaveLength(1);
    expect(fakeRedis.state.quitCalls).toBe(1);
  });
});
