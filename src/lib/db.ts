import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

// Reuse the connection across hot reloads / lambda invocations.
const g = globalThis as unknown as { _sql?: Sql };

// Lazy: the env check runs on first query, not at import — `next build`
// collects page data by importing modules and must not require a live env.
function getSql(): Sql {
  if (!g._sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // sslmode=disable in the URL opts out (local throwaway DBs for tests);
    // anything else — i.e. Neon — always connects over TLS.
    g._sql = postgres(url, {
      ssl: url.includes("sslmode=disable") ? false : "require",
    });
  }
  return g._sql;
}

export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_target, _thisArg, args) =>
    Reflect.apply(getSql() as unknown as (...a: unknown[]) => unknown, undefined, args),
  get: (_target, prop) => {
    const real = getSql() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});
