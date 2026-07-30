import { Hono } from "hono";

import notam from "@/modules/route/notam.route";
import health from "./health";

const app = new Hono().route("/notam", notam).route("/health", health);

export default app;
