// Shared in-memory ioredis fake for unit tests.
//
// `mock.module("ioredis", ...)` registrations are process-wide in the bun test
// runner and whichever mock is active when a module is *evaluated* wins — so
// every test file must register this same fake. A per-file fake breaks other
// suites when its module graph is reused (e.g. "publisher.publish is not a
// function").
//
// Usage in a test file:
//   import { FakeRedis } from "@repo/shared/src/testing/fakeRedis";
//   mock.module("ioredis", () => ({ Redis: FakeRedis, default: FakeRedis }));

export type RedisMessageHandler = (channel: string, message: string) => void;

interface FakeRedisState {
  counters: Map<string, number>;
  published: { channel: string; message: string }[];
  duplicateCalls: number;
  subscriptions: string[];
  unsubscriptions: string[];
  quitCalls: number;
  removedListenerEvents: (string | undefined)[];
}

const state: FakeRedisState = {
  counters: new Map<string, number>(),
  published: [],
  duplicateCalls: 0,
  subscriptions: [],
  unsubscriptions: [],
  quitCalls: 0,
  removedListenerEvents: [],
};

const messageHandlers = new Set<RedisMessageHandler>();

interface FakeRedisControl {
  state: FakeRedisState;
  emit: (channel: string, message: string) => void;
  reset: () => void;
}

export const fakeRedis: FakeRedisControl = {
  state,
  emit(channel: string, message: string): void {
    for (const handler of [...messageHandlers]) {
      handler(channel, message);
    }
  },
  reset(): void {
    state.counters.clear();
    state.published.length = 0;
    state.duplicateCalls = 0;
    state.subscriptions.length = 0;
    state.unsubscriptions.length = 0;
    state.quitCalls = 0;
    state.removedListenerEvents.length = 0;
    messageHandlers.clear();
  },
};

export class FakeRedis {
  on(event: string, handler: RedisMessageHandler): this {
    if (event === "message") {
      messageHandlers.add(handler);
    }
    return this;
  }

  removeAllListeners(event?: string): this {
    state.removedListenerEvents.push(event);
    if (event === undefined || event === "message") {
      messageHandlers.clear();
    }
    return this;
  }

  async incr(key: string): Promise<number> {
    const next = (state.counters.get(key) || 0) + 1;
    state.counters.set(key, next);
    return next;
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }

  async del(key: string): Promise<number> {
    state.counters.delete(key);
    return 1;
  }

  async publish(channel: string, message: string): Promise<number> {
    state.published.push({ channel, message });
    return 1;
  }

  duplicate(): FakeRedis {
    state.duplicateCalls += 1;
    return new FakeRedis();
  }

  async subscribe(
    channel: string,
    callback?: (err: Error | null) => void,
  ): Promise<void> {
    state.subscriptions.push(channel);
    callback?.(null);
  }

  async unsubscribe(channel: string): Promise<number> {
    state.unsubscriptions.push(channel);
    return 1;
  }

  async quit(): Promise<string> {
    state.quitCalls += 1;
    return "OK";
  }
}
