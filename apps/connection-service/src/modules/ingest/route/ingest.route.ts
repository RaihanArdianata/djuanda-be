import { Hono } from "hono";
import { ingest } from "../controller/ingest.controller";

const app = new Hono().post("/", ingest);

export default app;
