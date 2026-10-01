import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { env } from "./env";

// Lazy-initialize the connection so it isn't evaluated at build time
// (env.DATABASE_URL may be a build placeholder when .env.local is absent)
let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const sql = neon(env.DATABASE_URL);
    _db = drizzle(sql, { schema });
  }
  return _db;
}

// Named export for convenience – identical to calling getDb() lazily
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});

