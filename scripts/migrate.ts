import fs from "fs";
import path from "path";
import pg from "pg";
import { loadEnv } from "./load-env";

function sslFor(connectionString: string) {
  return /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false };
}

export async function migrate(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString, ssl: sslFor(connectionString) });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const dir = path.join(process.cwd(), "drizzle");
    const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const done = await pool.query(`SELECT 1 FROM schema_migrations WHERE id = $1`, [file]);
      if (done.rowCount) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("migrate.ts") || invoked.endsWith("migrate.js")) {
  loadEnv();
  migrate()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
