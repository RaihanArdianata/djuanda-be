import { Hono } from "hono";
import { weatherProxy } from "@/proxy/weather.proxy";

const app = new Hono().all("/*", weatherProxy);

export default app;