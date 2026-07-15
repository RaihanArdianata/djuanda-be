import { Hono } from "hono";
import { alertProxy } from "@/proxy/alert.proxy";

const app = new Hono().all("/*", alertProxy);

export default app;
