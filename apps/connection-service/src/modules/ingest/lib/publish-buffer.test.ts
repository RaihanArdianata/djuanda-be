import { describe, expect, it } from "bun:test";
import { createPublishBuffer } from "./publish-buffer";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("publish buffer", () => {
  it("sends what accumulated in one batch after the interval", async () => {
    const batches: number[][] = [];
    const buffer = createPublishBuffer<number>({
      intervalMs: 20,
      publish: async (batch) => {
        batches.push(batch);
      },
      onError: () => undefined,
    });
    buffer.add(1);
    buffer.add(2);
    buffer.add(3);
    expect(buffer.pending).toBe(3);
    await sleep(60);
    expect(batches).toEqual([[1, 2, 3]]);
    expect(buffer.pending).toBe(0);
  });

  it("starts a new batch for items that arrive after a send", async () => {
    const batches: number[][] = [];
    const buffer = createPublishBuffer<number>({
      intervalMs: 15,
      publish: async (batch) => {
        batches.push(batch);
      },
      onError: () => undefined,
    });
    buffer.add(1);
    await sleep(40);
    buffer.add(2);
    await sleep(40);
    expect(batches).toEqual([[1], [2]]);
  });

  it("reports a failed send and keeps working", async () => {
    const errors: number[] = [];
    let calls = 0;
    const buffer = createPublishBuffer<number>({
      intervalMs: 10,
      publish: async () => {
        calls++;
        if (calls === 1) throw new Error("kafka down");
      },
      onError: (_err, size) => {
        errors.push(size);
      },
    });
    buffer.add(1);
    buffer.add(2);
    await sleep(30);
    buffer.add(3);
    await sleep(30);
    expect(errors).toEqual([2]);
    expect(calls).toBe(2);
  });

  it("flushes immediately on request and does nothing when empty", async () => {
    const batches: number[][] = [];
    const buffer = createPublishBuffer<number>({
      intervalMs: 10_000,
      publish: async (batch) => {
        batches.push(batch);
      },
      onError: () => undefined,
    });
    await buffer.flush();
    expect(batches).toEqual([]);
    buffer.add(7);
    await buffer.flush();
    expect(batches).toEqual([[7]]);
  });
});
