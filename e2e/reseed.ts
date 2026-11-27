import { closePool } from "../server/src/db/pool";
import { runSeed } from "../server/seed/seed";

/**
 * Puts the seeded rows back the way `npm run seed` leaves them (the seed
 * upserts on stable ids, resets approval and hiding, and reopens the pending
 * reviews). Runs before every e2e run, and after any spec that changes
 * seeded rows, so no spec depends on run order or on a manual re-seed.
 */
export async function reseed(): Promise<void> {
  try {
    await runSeed();
  } finally {
    await closePool();
  }
}

export default reseed;
