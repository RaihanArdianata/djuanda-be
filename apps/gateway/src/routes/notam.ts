import { Hono } from "hono";
import { notamProxy } from "@/proxy/notam.proxy";

const app = new Hono().all("/*", notamProxy);

export default app;
