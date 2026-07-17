import { Hono } from "hono";
import { replayServer } from "../service/history.service";

// REST history surface, served by @aeroswarm/replay-server:
//   GET /replay/days · GET /replay/range · GET /tracks/:trackId/history · GET /alerts
// (mounted under /aero by routes/index.ts — the WS half lives in
// src/index.ts because Bun.serve owns the upgrade, not Hono).
const app = new Hono();

await replayServer.mountHono(app, "");

export default app;
