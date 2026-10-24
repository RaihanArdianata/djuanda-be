import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
// @repo/shared's rate limiter creates a Redis client at module load time --
// stub ioredis so importing the routes never dials localhost:6379.
import { FakeRedis } from "@repo/shared/testing/fakeRedis";

mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

// Same stand-ins as the download test: auth/RBAC are applied once in
// routes/index.ts, so the import route must sit behind them too.
mock.module("@repo/auth", () => ({
  authentication: async (
    c: import("hono").Context,
    next: import("hono").Next,
  ) => {
    if (c.req.header("authorization") !== "Bearer valid")
      return c.json(
        { data: null, error: { code: "UNAUTHORIZED" }, meta: { code: 401 } },
        401,
      );
    await next();
  },
  rbacMiddleware: async (
    c: import("hono").Context,
    next: import("hono").Next,
  ) => {
    if (c.req.header("x-test-role") === "blocked")
      return c.json(
        { data: null, error: { code: "FORBIDDEN" }, meta: { code: 403 } },
        403,
      );
    await next();
  },
}));

mock.module("./storage", () => ({
  playbackBucket: "playback-files",
  minio: {},
  ensurePlaybackBucket: async (): Promise<void> => {},
  isMissingObjectError: (error: unknown): boolean => {
    const code = (error as { code?: string }).code;
    return code === "NotFound" || code === "NoSuchKey";
  },
}));

interface ImportCall {
  airportId: string;
  fileName: string;
  displayName?: string;
  notes?: string;
  source?: string;
  body: Readable;
  size: number;
}

const importPlaybackFile = mock(async (input: ImportCall) => ({
  id: "11111111-1111-4111-8111-111111111111",
  airportId: input.airportId,
  kind: "imported",
  displayName: input.displayName ?? input.fileName,
  originalFileName: input.fileName,
  status: "processing",
  progress: 0,
  sizeBytes: input.size,
  storageKey: "playback/secret-key/x.pbk",
}));
const unused = async (): Promise<never> => {
  throw new Error("not used by the import route");
};

mock.module("./playback-files.service", () => ({
  importPlaybackFile,
  getPlaybackFile: unused,
  toPublicPlaybackFile: (file: { storageKey: string }) => {
    const { storageKey: _storageKey, ...publicFile } = file;
    return publicFile;
  },
  createGeneratedFile: unused,
  deletePlaybackFile: unused,
  getPlaybackFileStats: unused,
  listPlaybackFiles: unused,
  patchPlaybackFile: unused,
  stageFileForPlayback: unused,
  processPlaybackFile: unused,
  loadEventsFromFile: unused,
}));

mock.module("../services/playback-session.service", () => ({
  createSessionRecord: unused,
  getSessionRecord: unused,
  saveSessionRecord: unused,
  deleteSessionRecord: unused,
}));

// Imported dynamically, after the mocks above are registered.
const { default: routes } = await import("../../routes");
const { createPbkImporter, assertValidPbkUpload, ImportTooLargeError } =
  await import("./playback-files.import");

const pbk = (events = 1) =>
  gzipSync(
    [
      JSON.stringify({ type: "metadata", format: "pbk" }),
      ...Array.from({ length: events }, (_, i) =>
        JSON.stringify({ ts: i, kind: "x", data: {} }),
      ),
    ].join("\n"),
  );

const form = (
  parts: {
    file?: Blob | string | null;
    name?: string;
    fields?: Record<string, string>;
  } = {},
) => {
  const body = new FormData();
  body.append("airportId", "WARR");
  for (const [key, value] of Object.entries(parts.fields ?? {}))
    body.append(key, value);
  const file = parts.file === undefined ? new Blob([pbk()]) : parts.file;
  if (file !== null)
    body.append(
      "file",
      file as Blob,
      ...(typeof file === "string" ? [] : [parts.name ?? "WARR-2026.pbk"]),
    );
  return body;
};

const post = (
  body: BodyInit | null,
  headers: Record<string, string> = { Authorization: "Bearer valid" },
) =>
  routes.request("/playback/files/import", {
    method: "POST",
    headers,
    body,
  });

const readAll = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks) as Buffer;
};

beforeEach(() => {
  importPlaybackFile.mockClear();
  delete process.env.PLAYBACK_IMPORT_MAX_BYTES;
});

describe("POST /playback/files/import", () => {
  it("accepts a valid .pbk and hands the bytes to the service", async () => {
    const content = pbk(3);
    let received: Buffer = Buffer.alloc(0);
    importPlaybackFile.mockImplementationOnce(async (input) => {
      received = await readAll(input.body);
      return {
        id: "11111111-1111-4111-8111-111111111111",
        airportId: input.airportId,
        kind: "imported",
        displayName: input.fileName,
        originalFileName: input.fileName,
        status: "processing",
        progress: 0,
        sizeBytes: input.size,
        storageKey: "playback/secret-key/x.pbk",
      };
    });

    const res = await post(
      form({
        file: new Blob([content]),
        fields: { displayName: "Morning run", notes: "n", source: "adsb" },
      }),
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      data: { status: string; displayName: string; sizeBytes: number };
    };
    expect(body.data.status).toBe("processing");
    expect(body.data.sizeBytes).toBe(content.length);
    expect(importPlaybackFile).toHaveBeenCalledTimes(1);
    const call = importPlaybackFile.mock.calls[0][0];
    expect(call).toMatchObject({
      airportId: "WARR",
      fileName: "WARR-2026.pbk",
      displayName: "Morning run",
      notes: "n",
      source: "adsb",
      size: content.length,
    });
    expect(received.equals(content)).toBe(true);
  });

  it("uses the fileName field over the part's own name", async () => {
    await post(form({ fields: { fileName: "custom.pbk" } }));
    expect(importPlaybackFile.mock.calls[0][0].fileName).toBe("custom.pbk");
  });

  it("never exposes storage details in the response", async () => {
    const res = await post(form());
    const text = await res.text();

    for (const forbidden of [
      "storageKey",
      "secret-key",
      "uploadUrl",
      "presigned",
      "X-Amz",
      "minio",
      "9000",
      "requiredHeaders",
    ])
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  it("rejects a request without a file", async () => {
    const res = await post(form({ file: null }));
    expect(res.status).toBe(400);
    expect(importPlaybackFile).not.toHaveBeenCalled();
  });

  it("rejects a `file` field that is plain text, not a file part", async () => {
    const res = await post(form({ file: "not-a-file" }));
    expect(res.status).toBe(400);
    expect(importPlaybackFile).not.toHaveBeenCalled();
  });

  it("rejects a non-multipart request", async () => {
    const res = await post(JSON.stringify({ airportId: "WARR" }), {
      Authorization: "Bearer valid",
      "Content-Type": "application/json",
    });
    expect(res.status).toBe(400);
    expect(importPlaybackFile).not.toHaveBeenCalled();
  });

  it("rejects a file that is not .pbk", async () => {
    const res = await post(form({ name: "recording.zip" }));
    expect(res.status).toBe(400);
    expect(importPlaybackFile).not.toHaveBeenCalled();
  });

  it("rejects an empty file", async () => {
    const res = await post(form({ file: new Blob([]) }));
    expect(res.status).toBe(400);
    expect(importPlaybackFile).not.toHaveBeenCalled();
  });

  it("rejects content that is not gzip even with a .pbk name", async () => {
    const res = await post(form({ file: new Blob(["plain text, not gzip"]) }));
    expect(res.status).toBe(400);
    expect(importPlaybackFile).not.toHaveBeenCalled();
  });

  it("rejects invalid metadata", async () => {
    const invalid: Record<string, string>[] = [
      { source: "other" },
      { fileName: "a.txt" },
      { notes: "x".repeat(2001) },
      { airportId: "A".repeat(33) },
    ];
    for (const fields of invalid) {
      const body = form();
      for (const [key, value] of Object.entries(fields)) body.set(key, value);
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    expect(importPlaybackFile).not.toHaveBeenCalled();
  });

  it("rejects a missing airportId", async () => {
    const body = form();
    body.delete("airportId");
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(importPlaybackFile).not.toHaveBeenCalled();
  });

  it("answers 413 for a file over the limit, before the service runs", async () => {
    process.env.PLAYBACK_IMPORT_MAX_BYTES = "10";
    const res = await post(form());
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(importPlaybackFile).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const res = await post(form(), {});
    expect(res.status).toBe(401);
    expect(importPlaybackFile).not.toHaveBeenCalled();
  });

  it("enforces RBAC", async () => {
    const res = await post(form(), {
      Authorization: "Bearer valid",
      "x-test-role": "blocked",
    });
    expect(res.status).toBe(403);
    expect(importPlaybackFile).not.toHaveBeenCalled();
  });

  it("no longer serves the presigned-URL endpoints", async () => {
    const urlRes = await routes.request("/playback/files/import-url", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ airportId: "WARR", fileName: "a.pbk" }),
    });
    const doneRes = await routes.request(
      "/playback/files/abc/import-complete",
      {
        method: "POST",
        headers: { Authorization: "Bearer valid" },
      },
    );
    expect([400, 404, 405]).toContain(urlRes.status);
    expect([404, 405]).toContain(doneRes.status);
  });
});

describe("assertValidPbkUpload", () => {
  const ok = { fileName: "a.pbk", size: 4, head: new Uint8Array([0x1f, 0x8b]) };

  it("accepts a gzip .pbk", () => {
    expect(() => assertValidPbkUpload(ok)).not.toThrow();
    expect(() =>
      assertValidPbkUpload({ ...ok, fileName: "A.PBK" }),
    ).not.toThrow();
  });
  it("throws ImportTooLargeError past the configured limit", () => {
    process.env.PLAYBACK_IMPORT_MAX_BYTES = "3";
    expect(() => assertValidPbkUpload(ok)).toThrow(ImportTooLargeError);
  });
  it("falls back to the default limit when the env value is invalid", () => {
    process.env.PLAYBACK_IMPORT_MAX_BYTES = "abc";
    expect(() => assertValidPbkUpload(ok)).not.toThrow();
  });
});

describe("createPbkImporter lifecycle", () => {
  const calls: string[] = [];
  const stored = new Map<string, number>();
  const rows = new Map<string, Record<string, unknown>>();
  const queued: string[] = [];
  const failures = {
    put: false,
    insert: false,
    enqueue: false,
    remove: false,
    delete: false,
  };

  const importer = createPbkImporter({
    newId: () => "id-1",
    ensureBucket: async () => {
      calls.push("bucket");
    },
    putObject: async (key, body, size, contentType) => {
      calls.push(`put:${contentType}`);
      await readAll(body);
      if (failures.put)
        throw Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:9000"), {
          code: "ECONNREFUSED",
        });
      stored.set(key, size);
    },
    removeObject: async (key) => {
      calls.push("remove");
      if (failures.remove) throw new Error("boom");
      stored.delete(key);
    },
    insertFile: async (values) => {
      calls.push("insert");
      if (failures.insert) throw new Error("db down");
      const row = { ...values, kind: "imported", status: "processing" };
      rows.set(values.id, row);
      return row as typeof row & { id: string };
    },
    deleteFile: async (id) => {
      calls.push("delete");
      if (failures.delete) throw new Error("db down");
      rows.delete(id);
    },
    markFileFailed: async (id, message) => {
      calls.push("markFailed");
      const row = rows.get(id);
      if (row) Object.assign(row, { status: "failed", errorMessage: message });
    },
    enqueueScan: async (fileId) => {
      calls.push("enqueue");
      if (failures.enqueue) throw new Error("redis down");
      queued.push(fileId);
    },
  });

  const run = (overrides: Partial<Parameters<typeof importer>[0]> = {}) =>
    importer({
      airportId: "WARR",
      fileName: "adsb_2026.pbk",
      body: Readable.from([Buffer.from("abc")]),
      size: 3,
      ...overrides,
    });

  beforeEach(() => {
    calls.length = 0;
    stored.clear();
    rows.clear();
    queued.length = 0;
    for (const key of Object.keys(failures))
      failures[key as keyof typeof failures] = false;
  });

  it("stores the object, then inserts a processing row, then queues a scan", async () => {
    const file = await run();

    expect(calls).toEqual([
      "bucket",
      "put:application/gzip",
      "insert",
      "enqueue",
    ]);
    expect(file).toMatchObject({
      id: "id-1",
      kind: "imported",
      status: "processing",
      airportId: "WARR",
      originalFileName: "adsb_2026.pbk",
      displayName: "adsb_2026",
      source: "adsb",
      sizeBytes: 3,
    });
    expect(stored.get("playback/id-1/adsb_2026.pbk")).toBe(3);
    expect(queued).toEqual(["id-1"]);
  });

  it("never marks the file ready itself", async () => {
    const file = (await run()) as { status: string };
    expect(file.status).not.toBe("ready");
  });

  it("keeps explicit metadata over the derived defaults", async () => {
    const file = await run({
      displayName: "Mine",
      notes: "hello",
      source: "radar",
    });
    expect(file).toMatchObject({
      displayName: "Mine",
      notes: "hello",
      source: "radar",
    });
  });

  it("derives the object key from the server id and a sanitized name", async () => {
    await run({ fileName: "../../evil name.pbk" });
    expect([...stored.keys()]).toEqual(["playback/id-1/.._.._evil_name.pbk"]);
  });

  it("creates no record when storage fails, and hides the cause", async () => {
    failures.put = true;
    const error = await run().catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Could not store playback file");
    expect((error as Error).message).not.toContain("10.1.2.3");
    expect(rows.size).toBe(0);
    expect(queued).toEqual([]);
    expect(calls).not.toContain("insert");
  });

  it("removes the stored object when the record cannot be saved", async () => {
    failures.insert = true;
    await expect(run()).rejects.toThrow("Could not save playback file");

    expect(stored.size).toBe(0);
    expect(rows.size).toBe(0);
    expect(queued).toEqual([]);
  });

  it("rolls back row and object when the job cannot be queued", async () => {
    failures.enqueue = true;
    await expect(run()).rejects.toThrow(
      "Could not queue playback file validation",
    );

    expect(rows.size).toBe(0);
    expect(stored.size).toBe(0);
  });

  it("marks the row failed, and keeps the object, if rollback cannot delete the row", async () => {
    failures.enqueue = true;
    failures.delete = true;
    await expect(run()).rejects.toThrow(
      "Could not queue playback file validation",
    );

    expect(rows.get("id-1")).toMatchObject({ status: "failed" });
    expect(stored.size).toBe(1);
    expect(calls).toContain("markFailed");
  });

  it("still reports the original failure when cleanup itself fails", async () => {
    failures.insert = true;
    failures.remove = true;
    await expect(run()).rejects.toThrow("Could not save playback file");
  });
});
