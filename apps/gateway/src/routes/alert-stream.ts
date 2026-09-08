import { Hono } from "hono";
import { alertStreamProxy } from "@/proxy/alert-stream.proxy";

const app = new Hono().get("/", alertStreamProxy);

export default app;
