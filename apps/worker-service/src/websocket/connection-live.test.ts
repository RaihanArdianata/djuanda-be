import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { websocket } from "hono/bun";

import { connectionLiveProxy, liveTargetUrl } from "./connection-live";

describe("liveTargetUrl", () => {
  it("keeps the path and the query (the token) and switches to ws", () => {
    expect(
      liveTargetUrl(
        "http://x/ws/tracks/live?token=abc",
        "http://connection-service:3005",
      ),
    ).toBe("ws://connection-service:3005/ws/tracks/live?token=abc");
    expect(liveTargetUrl("https://x/ws/tracks/live", "https://c.example")).toBe(
      "wss://c.example/ws/tracks/live",
    );
  });
});

describe("/ws/tracks/live relay", () => {
  const stops: Array<() => void> = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    delete process.env.CONNECTION_SERVICE_URL;
  });

  /** A stand-in for connection-service: greets, echoes, and remembers what it was asked for. */
  function upstream() {
    const seen: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        seen.push(new URL(req.url).pathname + new URL(req.url).search);
        return srv.upgrade(req)
          ? undefined
          : new Response("no", { status: 400 });
      },
      websocket: {
        open: (ws) => {
          ws.send("hello");
        },
        message: (ws, m) => {
          if (m === "bye") ws.close(1000, "done");
          else ws.send(`echo:${m}`);
        },
      },
    });
    stops.push(() => server.stop(true));
    return { server, seen };
  }

  function relay() {
    const app = new Hono().get("/ws/tracks/live", connectionLiveProxy);
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
    stops.push(() => server.stop(true));
    return server;
  }

  const open = (url: string) =>
    new Promise<{ ws: WebSocket; got: string[]; closed: Promise<number> }>(
      (resolve, reject) => {
        const ws = new WebSocket(url);
        const got: string[] = [];
        let onClosed: (code: number) => void = () => {};
        const closed = new Promise<number>((r) => (onClosed = r));
        ws.onmessage = (e) => got.push(String(e.data));
        ws.onclose = (e) => onClosed(e.code);
        ws.onopen = () => resolve({ ws, got, closed });
        ws.onerror = () => reject(new Error("could not connect"));
      },
    );
  const until = async (cond: () => boolean) => {
    for (let i = 0; i < 100 && !cond(); i++) await Bun.sleep(20);
    expect(cond()).toBe(true);
  };

  it("relays frames both ways and passes the token on to connection-service", async () => {
    const up = upstream();
    process.env.CONNECTION_SERVICE_URL = `http://localhost:${up.server.port}`;
    const proxy = relay();

    const { ws, got } = await open(
      `ws://localhost:${proxy.port}/ws/tracks/live?token=T0KEN`,
    );
    await until(() => got.includes("hello")); // from connection-service
    ws.send("ping"); // sent at once, possibly before the upstream link is up
    await until(() => got.includes("echo:ping"));
    expect(up.seen).toEqual(["/ws/tracks/live?token=T0KEN"]);
    ws.close();
  });

  it("closes the browser's socket when connection-service closes its own", async () => {
    const up = upstream();
    process.env.CONNECTION_SERVICE_URL = `http://localhost:${up.server.port}`;
    const proxy = relay();
    const { ws, got, closed } = await open(
      `ws://localhost:${proxy.port}/ws/tracks/live`,
    );
    await until(() => got.includes("hello"));
    ws.send("bye");
    expect(await closed).toBe(1000);
  });

  it("closes cleanly, not hanging, when connection-service is not there", async () => {
    process.env.CONNECTION_SERVICE_URL = "http://localhost:1"; // nothing listens
    const proxy = relay();
    const { closed } = await open(
      `ws://localhost:${proxy.port}/ws/tracks/live`,
    );
    expect(await closed).toBe(1011);
  });
});
