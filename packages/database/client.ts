<<<<<<< HEAD
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
=======
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './drizzle/schema';
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0

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

pool.on("error", (_err) => {});

export const db = drizzle({ client: pool, schema });
