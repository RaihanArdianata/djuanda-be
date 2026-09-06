import "dotenv/config";
import { logger } from "@repo/logger";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./drizzle/schema";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || "10", 10),
  idleTimeoutMillis: parseInt(
    process.env.DB_POOL_IDLE_TIMEOUT_MS || "30000",
    10,
  ),
  connectionTimeoutMillis: parseInt(
    process.env.DB_POOL_CONNECTION_TIMEOUT_MS || "5000",
    10,
  ),
});

pool.on("error", (err) => {
  // Log idle/connection errors so they are observable, but keep the pool
  // alive — most of these are recoverable client errors rather than fatal.
  logger.error({ err }, "database pool error");
});

export const db = drizzle({ client: pool, schema });
