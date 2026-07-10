import { Hono } from "hono";
import { authentication } from "../middleware/auth";
import { authProxy } from "../proxy/auth.proxy";

// Role & permission management tinggal di auth-service. Router ini dipakai untuk
const app = new Hono().use("/*", authentication).all("/*", authProxy);

export default app;
