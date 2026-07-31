import { Hono } from "hono";
import { aerodromeProxy } from "@/proxy/aerodrome.proxy";

const app = new Hono().all("/*", aerodromeProxy);

export default app;
