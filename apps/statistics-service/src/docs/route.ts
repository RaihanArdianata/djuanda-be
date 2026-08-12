
import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { openApiDocument } from "./openapi";

const app = new Hono()
  .get("/statistics/openapi.json", (c) => c.json(openApiDocument))
  .get(
    "/statistics/docs",
    swaggerUI({
      url: "/statistics/openapi.json",
    }),
  );

export default app;

