import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withSystem, type Db } from "../src/db/tx";
import { SEED_ADMINS, SEED_PEOPLE, joinedAt, lastActiveAt, seedProfiles } from "./profiles";
import { seedProfilesDetails } from "./profiles-details";
import { seedRequests } from "./requests";
import { seedEmail, seedUserId, seedUsers } from "./users";

/**
 * Development and end-to-end seed. `npm run seed` fills the local database
 * with the prototype's fictional people. Each area adds its own
 * `seed/<area>.ts` module exporting `seed<Area>(db)`, called below in
 * dependency order; this file only calls them. Safe to run again: every
 * module upserts on stable ids.
 */

export interface SeedIdentity {
  id: string;
  email: string;
}

/** Prototype id (and `admin`, `admin2`) to the seeded user's id and email. */
export const SEED: Readonly<Record<string, SeedIdentity>> = Object.freeze(
  Object.fromEntries(
    [...SEED_PEOPLE, ...SEED_ADMINS].map((person) => [person.key, { id: seedUserId(person.key), email: seedEmail(person.key) }]),
  ),
);

/** Every seed module, in order, inside one system transaction. */
export async function seedAll(db: Db): Promise<void> {
  await seedUsers(
    db,
    [...SEED_PEOPLE, ...SEED_ADMINS].map((person) => ({
      key: person.key,
      joinedAt: joinedAt(person),
      lastSignInAt: lastActiveAt(person),
    })),
  );
  await seedProfiles(db);
  await seedProfilesDetails(db);
  await seedRequests(db);
}

/** Runs the seed against the process pool (`DATABASE_URL`, or the test database under the harness). */
export function runSeed(): Promise<void> {
  return withSystem(seedAll);
}

async function main(): Promise<void> {
  const { env } = await import("../src/env");
  if (env.NODE_ENV === "production") {
    throw new Error("seed: refusing to run with NODE_ENV=production");
  }
  const { getPool, closePool } = await import("../src/db/pool");
  const { runMigrations } = await import("../src/db/migrate");
  try {
    await runMigrations(getPool());
    await runSeed();
    console.log(
      `[seed] ${SEED_PEOPLE.length} people and ${SEED_ADMINS.length} administrators; sign in as <prototype-id>@example.test or admin@example.test`,
    );
  } finally {
    await closePool();
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
