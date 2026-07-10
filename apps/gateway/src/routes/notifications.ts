import { Hono } from "hono";
import { authentication } from "../middleware/auth";
import { notificationProxy } from "../proxy/notification.proxy";

const app = new Hono().use("/*", authentication).all("/*", notificationProxy);

export default app;
