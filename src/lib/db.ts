import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Reuse the connection across hot reloads in dev.
const g = globalThis as unknown as { _sql?: ReturnType<typeof postgres> };
export const sql = g._sql ?? postgres(url, { ssl: "require" });
if (process.env.NODE_ENV !== "production") g._sql = sql;
