import { Hono } from "hono";
import { usersProxy } from "@/proxy/users.proxy";

const app = new Hono().all("/*", usersProxy);

export default app;
