import { env } from "../env";
import { createPool } from "../db/pool";
import { runMigrations } from "../db/migrate";

/** `npm run migrate`: apply pending migrations to DATABASE_URL and exit. */
async function main(): Promise<void> {
  const pool = createPool(env.DATABASE_URL, { max: 1 });
  try {
    const result = await runMigrations(pool);
    for (const name of result.applied) console.log(`applied ${name}`);
    console.log(`${result.total} migration${result.total === 1 ? "" : "s"} recorded`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
