import { Hono } from "hono";
import { services } from "../config/services";
import { isServiceHealthy } from "../lib/http-client";

const app = new Hono()
  .get("/", (c) => c.json({ status: "ok" }))
  .get("/live", (c) => c.json({ status: "ok" }))
  .get("/ready", async (c) => {
    const [authOk, notificationOk] = await Promise.all([
      isServiceHealthy(services.AUTH_SERVICE),
      isServiceHealthy(services.NOTIFICATION_SERVICE),
    ]);

    const ready = authOk && notificationOk;

    return c.json(
      {
        status: ready ? "ok" : "degraded",
        services: { auth: authOk, notification: notificationOk },
      },
      ready ? 200 : 503,
    );
  });

export default app;
