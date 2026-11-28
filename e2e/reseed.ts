import { closePool } from "../server/src/db/pool";
import { withSystem } from "../server/src/db/tx";
import { runSeed } from "../server/seed/seed";
import { SEED_ADMINS } from "../server/seed/profiles";
import { seedUserId } from "../server/seed/users";

/**
 * Global setup: reseeds the e2e database, and revokes any administrator role
 * the seed did not grant. admin-bootstrap.spec.ts makes one per run and
 * revokes it at the end; a run stopped part way would otherwise leave a third
 * administrator that changes what the admin specs see.
 */
export async function reseed(): Promise<void> {
  try {
    await runSeed();
    await withSystem((db) =>
      db.query("UPDATE admin_roles SET revoked_at = now() WHERE revoked_at IS NULL AND NOT (profile_id = ANY ($1::uuid[]))", [
        SEED_ADMINS.map((admin) => seedUserId(admin.key)),
      ]),
    );
  } finally {
    await closePool();
  }
}

export default reseed;
