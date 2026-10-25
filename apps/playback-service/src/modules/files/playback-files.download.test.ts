import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Readable } from "node:stream";
// @repo/shared's rate limiter creates a Redis client at module load time --
// stub ioredis so importing the routes never dials localhost:6379.
import { FakeRedis } from "@repo/shared/testing/fakeRedis";

mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

// Authentication/RBAC are applied once in routes/index.ts for everything under
// /playback. Stand-ins that reject like the real ones would, so the test can
// prove the download route sits behind them.
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

const BUCKET = "playback-files";
const STORAGE_KEY = "playback/3880df80/WARR-2026-08-01.pbk";

// Same export set as ./storage so other test files that load the real service
// chain keep linking. `presignedGetObject` is here only to prove it is unused.
const statObject = mock(
  async (_bucket: string, _key: string): Promise<{ size: number }> => ({
    size: 6,
  }),
);
const getObject = mock(
  async (_bucket: string, _key: string): Promise<Readable> =>
    Readable.from([Buffer.from("abc"), Buffer.from("def")]),
);
const presignedGetObject = mock(async (): Promise<string> => "http://leak");
const presignedUploadUrl = mock(async (_key: string): Promise<string> => "u");

mock.module("./storage", () => ({
  playbackBucket: BUCKET,
  minio: { statObject, getObject, presignedGetObject },
  ensurePlaybackBucket: async (): Promise<void> => {},
  isMissingObjectError: (error: unknown): boolean => {
    const code = (error as { code?: string }).code;
    return code === "NotFound" || code === "NoSuchKey";
  },
  presignedUploadUrl,
}));

interface FileRecord {
  id: string;
  displayName: string;
  originalFileName: string | null;
  storageKey: string;
  status: string;
}

const baseFile: FileRecord = {
  id: "3880df80-c69d-4e5a-bfce-4f877bc9a287",
  displayName: "WARR recording",
  originalFileName: null,
  storageKey: STORAGE_KEY,
  status: "ready",
};

const getPlaybackFile = mock(
  async (_id: string): Promise<FileRecord | null> => baseFile,
);
const unused = async (): Promise<never> => {
  throw new Error("not used by the download route");
};

mock.module("./playback-files.service", () => ({
  getPlaybackFile,
  toPublicPlaybackFile: (file: FileRecord) => file,
  createGeneratedFile: unused,
  importPlaybackFile: unused,
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
const { safeDownloadFileName, buildDownloadHeaders, toWebStream } =
  await import("./playback-files.download");

const download = (
  id: string = baseFile.id,
  headers: Record<string, string> = { Authorization: "Bearer valid" },
  query = "",
): Promise<Response> =>
  Promise.resolve(
    routes.request(`/playback/files/${id}/download${query}`, { headers }),
  );

beforeEach(() => {
  statObject.mockReset();
  getObject.mockReset();
  presignedGetObject.mockReset();
  presignedUploadUrl.mockReset();
  getPlaybackFile.mockReset();

  statObject.mockResolvedValue({ size: 6 });
  getObject.mockImplementation(async () =>
    Readable.from([Buffer.from("abc"), Buffer.from("def")]),
  );
  getPlaybackFile.mockResolvedValue(baseFile);
});

describe("GET /playback/files/:id/download", () => {
  it("returns the binary file for a ready record, not a JSON envelope", async () => {
    const res = await download();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("abcdef");
  });

  it("sets attachment headers with a safe filename and the real size", async () => {
    const res = await download();

    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="WARR_recording.pbk"',
    );
    expect(res.headers.get("content-length")).toBe("6");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    await res.arrayBuffer();
  });

  it("cannot be used for header injection through the file name", async () => {
    getPlaybackFile.mockResolvedValue({
      ...baseFile,
      displayName: 'x"\r\nSet-Cookie: pwned=1\r\n\r\n<script>',
      originalFileName: null,
    });

    const res = await download();
    const disposition = res.headers.get("content-disposition") ?? "";

    expect(res.headers.get("set-cookie")).toBeNull();
    expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9._-]+"$/);
    await res.arrayBuffer();
  });

  it("returns the NOT_FOUND error contract when the record does not exist", async () => {
    getPlaybackFile.mockResolvedValue(null);

    const res = await download();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(statObject).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
  });

  for (const status of ["uploading", "processing", "failed"]) {
    it(`rejects a file in status "${status}" without touching storage`, async () => {
      getPlaybackFile.mockResolvedValue({ ...baseFile, status });

      const res = await download();
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error.code).toBe("CONFLICT");
      expect(statObject).not.toHaveBeenCalled();
      expect(getObject).not.toHaveBeenCalled();
    });
  }

  it("returns NOT_FOUND when the stored object is missing", async () => {
    statObject.mockRejectedValue(
      Object.assign(new Error("not found"), { code: "NoSuchKey" }),
    );

    const res = await download();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(getObject).not.toHaveBeenCalled();
  });

  it("does not leak storage internals when MinIO fails", async () => {
    const secret =
      `connect ECONNREFUSED 10.72.124.214:9000 bucket=${BUCKET} ` +
      `key=${STORAGE_KEY} X-Amz-Signature=deadbeef`;
    getObject.mockRejectedValue(
      Object.assign(new Error(secret), { code: "ECONNREFUSED" }),
    );

    const res = await download();
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
    for (const forbidden of [
      "10.72.124.214",
      "9000",
      BUCKET,
      STORAGE_KEY,
      "X-Amz",
      "ECONNREFUSED",
    ])
      expect(text).not.toContain(forbidden);
  });

  it("never creates a presigned URL", async () => {
    const res = await download();
    await res.arrayBuffer();

    expect(presignedGetObject).not.toHaveBeenCalled();
    expect(presignedUploadUrl).not.toHaveBeenCalled();
  });

  it("reads the object from the record's storageKey, ignoring client input", async () => {
    const res = await download(
      baseFile.id,
      { Authorization: "Bearer valid" },
      "?key=playback/other/secret.pbk&bucket=other-bucket&storageKey=x",
    );
    await res.arrayBuffer();

    expect(getPlaybackFile).toHaveBeenCalledWith(baseFile.id);
    expect(statObject).toHaveBeenCalledWith(BUCKET, STORAGE_KEY);
    expect(getObject).toHaveBeenCalledWith(BUCKET, STORAGE_KEY);
  });

  it("does not expose the storage key or bucket in the response", async () => {
    const res = await download();
    await res.arrayBuffer();

    const everything = [...res.headers.entries()].flat().join("\n");
    expect(everything).not.toContain(STORAGE_KEY);
    expect(everything).not.toContain(BUCKET);
  });
});

describe("authentication and authorization", () => {
  it("rejects requests without credentials before reaching the handler", async () => {
    const res = await download(baseFile.id, {});

    expect(res.status).toBe(401);
    expect(getPlaybackFile).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
  });

  it("rejects requests blocked by RBAC before reaching the handler", async () => {
    const res = await download(baseFile.id, {
      Authorization: "Bearer valid",
      "X-Test-Role": "blocked",
    });

    expect(res.status).toBe(403);
    expect(getPlaybackFile).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
  });
});

describe("streaming", () => {
  const countingSource = (total: number) => {
    let produced = 0;
    const source = Readable.from(
      (async function* () {
        for (let i = 0; i < total; i++) {
          produced++;
          yield Buffer.alloc(1024, i);
        }
      })(),
    );
    return { source, produced: () => produced };
  };

  it("pulls from MinIO on demand instead of buffering the whole object", async () => {
    const { source, produced } = countingSource(500);
    getObject.mockResolvedValue(source);

    const res = await download();
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();

    expect(first.done).toBe(false);
    expect(produced()).toBeLessThan(500);

    await reader.cancel();
  });

  it("destroys the MinIO stream when the client goes away", async () => {
    const { source } = countingSource(500);
    getObject.mockResolvedValue(source);

    const res = await download();
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel();

    expect(source.destroyed).toBe(true);
  });

  it("errors the response and releases the source when the stream fails mid-way", async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.from("partial"));
        this.destroy(new Error("socket hang up 10.72.124.214:9000"));
      },
    });
    const seen: unknown[] = [];
    const web = toWebStream(failing, (error) => seen.push(error));
    const reader = web.getReader();

    await reader.read();
    await expect(reader.read()).rejects.toThrow();
    expect(failing.destroyed).toBe(true);
    expect(seen).toHaveLength(1);
  });
});

describe("safeDownloadFileName", () => {
  const file = { id: baseFile.id, displayName: "d", originalFileName: null };

  it("prefers the original file name and keeps a single .pbk extension", () => {
    expect(
      safeDownloadFileName({
        ...file,
        originalFileName: "adsb_run 1.PBK",
      }),
    ).toBe("adsb_run_1.pbk");
  });

  it("strips anything outside [A-Za-z0-9._-], including path separators", () => {
    expect(
      safeDownloadFileName({
        ...file,
        displayName: "../../etc/passwd\u0000 – WARR 02:53",
      }),
    ).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*\.pbk$/);
  });

  it("falls back to the file id when nothing usable is left", () => {
    expect(safeDownloadFileName({ ...file, displayName: "—— ///" })).toBe(
      `playback-${baseFile.id}.pbk`,
    );
  });

  it("limits the length of the name", () => {
    expect(
      safeDownloadFileName({ ...file, displayName: "a".repeat(500) }).length,
    ).toBeLessThanOrEqual(124);
  });
});

describe("buildDownloadHeaders", () => {
  it("omits Content-Length when the size is unknown", () => {
    expect(
      buildDownloadHeaders("a.pbk", null)["Content-Length"],
    ).toBeUndefined();
    expect(buildDownloadHeaders("a.pbk", 0)["Content-Length"]).toBe("0");
  });
});
