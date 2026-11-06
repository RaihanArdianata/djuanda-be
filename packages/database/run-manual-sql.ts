// biome-ignore-start lint/suspicious/noConsole: skrip CLI, keluarannya untuk operator
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { splitStatements } from "./drizzle/manual-sql";

/**
 * Menjalankan berkas SQL dari `drizzle/manual/` satu pernyataan per satu, TANPA transaksi, supaya
 * `CREATE INDEX CONCURRENTLY` bisa jalan (drizzle-kit migrate membungkus migrasi dalam transaksi). Satu koneksi langsung
 * ke Postgres (`DATABASE_URL`, jangan lewat pgbouncer), tanpa batas waktu pernyataan. Hasil SELECT dicetak sebagai tabel.
 *
 *   bun run db:manual drizzle/manual/0025_aeroswarm_tracks_icao24_fused.sql
 *   bun run db:manual drizzle/manual/0025_check.sql
 */
const file: string | undefined = process.argv[2];
if (!file) {
  console.error("Pemakaian: bun run db:manual <berkas.sql>");
  process.exit(1);
}

const url: string | undefined = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL kosong");
  process.exit(1);
}

const statements = splitStatements(readFileSync(resolve(file), "utf8"));
const target = new URL(url);
console.log(
  `Ke ${target.hostname}:${target.port || "5432"}${target.pathname}, ${statements.length} pernyataan`,
);

const client = new Client({
  connectionString: url,
  statement_timeout: 0,
  application_name: "manual-sql",
});
await client.connect();
try {
  for (const statement of statements) {
    console.log(`\n> ${statement.replace(/\s+/g, " ").slice(0, 120)}`);
    const started = Date.now();
    const result = await client.query(statement);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (result.rows.length > 0) console.table(result.rows);
    console.log(`selesai dalam ${seconds} dtk`);
  }
} finally {
  await client.end();
}
// biome-ignore-end lint/suspicious/noConsole: skrip CLI, keluarannya untuk operator
