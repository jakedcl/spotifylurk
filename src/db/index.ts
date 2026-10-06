import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let database: Db | undefined;

function needsSsl(connectionString: string) {
  return !/localhost|127\.0\.0\.1/.test(connectionString);
}

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({
      connectionString,
      max: 8,
      ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export function getDb() {
  if (!database) database = drizzle(getPool(), { schema });
  return database;
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
  database = undefined;
}
