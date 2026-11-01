import { Hono } from "hono";
import { connectionProxy } from "@/proxy/connection.proxy";

// Only /aero/tracks (a track's trail) goes through the gateway. The rest of connection-service
// (/aero/ingest, /aero/replay, its WebSocket) is reached directly and is deliberately not exposed here.
const app = new Hono().all("/*", connectionProxy);

export default app;
