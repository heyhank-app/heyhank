import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema.js";

/**
 * Lazy singleton for the Drizzle ORM client using Neon's HTTP driver.
 *
 * Requires `DATABASE_URL` env var (Neon Postgres connection string).
 * The singleton avoids creating multiple connections and mirrors the lazy
 * initialisation pattern used in `stripe.ts`.
 */
let _db: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const sql = neon(url);
    _db = drizzle(sql, { schema });
  }
  return _db;
}
