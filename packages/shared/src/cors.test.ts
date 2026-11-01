import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { createCorsMiddleware, parseCorsOrigin } from "./cors";

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
});
