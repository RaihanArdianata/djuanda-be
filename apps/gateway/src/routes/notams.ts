import { Hono } from "hono";
import { advisoryProxy } from "@/proxy/advisory.proxy";

const app = new Hono().all("/*", advisoryProxy);

export default app;
