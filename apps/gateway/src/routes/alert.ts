import { alertProxy } from "@/proxy/alert.proxy";
import { Hono } from "hono";

const app = new Hono().all("/*", alertProxy);

export default app;
