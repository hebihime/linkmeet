// Runs db/schema.sql against DATABASE_URL.
// Usage: node --env-file=.env.local scripts/migrate.mjs
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set (use: node --env-file=.env.local scripts/migrate.mjs)");
  process.exit(1);
}

const sql = postgres(url, { ssl: "require" });
const schema = readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8");

try {
  await sql.unsafe(schema);
  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name`;
  console.log("Migration OK. Tables:", tables.map((t) => t.table_name).join(", "));
} catch (err) {
  // AggregateError (e.g. all-connect-attempts-timed-out) has an EMPTY message;
  // dump the useful fields so a network failure never masquerades as SQL.
  console.error("Migration failed:", err.message || `${err.name} (${err.code})`);
  if (err.errors) for (const e of err.errors) console.error("  -", e.message);
  if (err.code === "ETIMEDOUT" || err.code === "EHOSTUNREACH")
    console.error(
      "Network issue reaching the DB — if attempts time out, raise Node's",
      "happy-eyeballs timeout: --network-family-autoselection-attempt-timeout=3000",
    );
  process.exit(1);
} finally {
  await sql.end();
}
