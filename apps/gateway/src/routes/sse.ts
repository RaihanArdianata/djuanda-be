import { Hono } from "hono";
import { sseProxy } from "@/proxy/sse.proxy";

const app = new Hono().all("/*", sseProxy);

export default app;
