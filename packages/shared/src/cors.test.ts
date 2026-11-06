import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import {
  corsOriginFromEnv,
  createCorsMiddleware,
  parseCorsOrigin,
} from "./cors";

const appFor = (origin: string): Hono =>
  new Hono()
    .use(createCorsMiddleware({ origin }))
    .get("/x", (c) => c.text("ok"));

const allowedFor = async (
  origin: string,
  from: string,
): Promise<string | null> => {
  const res = await appFor(origin).request("/x", {
    method: "OPTIONS",
    headers: { origin: from, "access-control-request-method": "GET" },
  });
  return res.headers.get("access-control-allow-origin");
};

describe("parseCorsOrigin", () => {
  it("keeps one origin as a string and several as a list, trimmed and without trailing slashes", () => {
    expect(parseCorsOrigin("https://a.example")).toBe("https://a.example");
    expect(
      parseCorsOrigin(" https://a.example/ , http://localhost:5173 "),
    ).toEqual(["https://a.example", "http://localhost:5173"]);
  });

  it("is '*' when asked for, or when nothing is set", () => {
    expect(parseCorsOrigin("*")).toBe("*");
    expect(parseCorsOrigin("https://a.example,*")).toBe("*");
    expect(parseCorsOrigin("")).toBe("*");
    expect(parseCorsOrigin(" , ")).toBe("*");
  });
});

describe("createCorsMiddleware", () => {
  it("answers only the origins it was given", async () => {
    const list = "https://asmgcs.midigi.id,http://localhost:5173";
    expect(await allowedFor(list, "https://asmgcs.midigi.id")).toBe(
      "https://asmgcs.midigi.id",
    );
    expect(await allowedFor(list, "http://localhost:5173")).toBe(
      "http://localhost:5173",
    );
    expect(await allowedFor(list, "https://evil.example")).toBeNull();
  });

  it("a single origin behaves as before: others get no header", async () => {
    expect(
      await allowedFor("https://asmgcs.midigi.id", "http://localhost:5173"),
    ).toBeNull();
  });

  it("'*' allows any origin", async () => {
    expect(await allowedFor("*", "http://localhost:5173")).toBe("*");
  });

  it("lets @aeroswarm/client send its envelope header (the trail request from another origin)", async () => {
    const res = await appFor("http://localhost:5173").request("/x", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization,x-aero-envelope",
      },
    });
    const allowed = (res.headers.get("access-control-allow-headers") ?? "")
      .toLowerCase()
      .split(",");
    expect(allowed).toContain("x-aero-envelope");
    expect(allowed).toContain("authorization");
  });
});

describe("corsOriginFromEnv", () => {
  it("reads CORS_ORIGIN, the same variable for every service", () => {
    expect(corsOriginFromEnv({ CORS_ORIGIN: " https://a.example " })).toBe(
      "https://a.example",
    );
  });

  it("falls back to the old AEROSWARM_CORS_ORIGINS, then to the given default", () => {
    expect(
      corsOriginFromEnv({ AEROSWARM_CORS_ORIGINS: "https://old.example" }),
    ).toBe("https://old.example");
    expect(
      corsOriginFromEnv({
        CORS_ORIGIN: "https://new.example",
        AEROSWARM_CORS_ORIGINS: "https://old.example",
      }),
    ).toBe("https://new.example");
    expect(corsOriginFromEnv({})).toBe("*");
    expect(corsOriginFromEnv({ CORS_ORIGIN: "  " }, "localhost")).toBe(
      "localhost",
    );
  });
});

describe("createCorsMiddleware with its own headers", () => {
  it("uses the given headers and methods instead of the defaults, and still refuses unlisted origins", async () => {
    const app = new Hono()
      .use(
        createCorsMiddleware({
          origin: "https://dash.example",
          allowHeaders: ["Content-Type", "X-Aero-Ingest-Secret"],
          allowMethods: ["GET", "POST", "OPTIONS"],
        }),
      )
      .get("/x", (c) => c.text("ok"));
    const preflight = (from: string) =>
      app.request("/x", {
        method: "OPTIONS",
        headers: { origin: from, "access-control-request-method": "GET" },
      });

    const ok = await preflight("https://dash.example");
    expect(ok.headers.get("access-control-allow-headers")).toBe(
      "Content-Type,X-Aero-Ingest-Secret",
    );
    expect(ok.headers.get("access-control-allow-methods")).toBe(
      "GET,POST,OPTIONS",
    );

    const other = await preflight("https://evil.example");
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
