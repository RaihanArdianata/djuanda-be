import { Hono } from "hono";
import { statisticsProxy } from "@/proxy/statistics.proxy";

const app = new Hono().all("/*", statisticsProxy);

export default app;
