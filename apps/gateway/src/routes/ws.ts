import { Hono } from "hono";
import { wsProxy } from "@/proxy/ws.proxy";

const app = new Hono().get("/*", wsProxy);

export default app;
