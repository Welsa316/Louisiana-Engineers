import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AdminGrantError, grantAdminByEmail, parseAdminGrantArgs } from "../auth/admin-grant";

/**
 * `npm run admin:grant -- <email>`. The grant itself lives in
 * ../auth/admin-grant.ts, which sign-in also uses for ADMIN_EMAILS; this file
 * only parses the argument and prints the outcome.
 */

export * from "../auth/admin-grant";

async function main(): Promise<void> {
  let email: string;
  try {
    email = parseAdminGrantArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const { withSystem } = await import("../db/tx");
  const { closePool } = await import("../db/pool");
  try {
    const outcome = await withSystem((db) => grantAdminByEmail(db, email));
    const what = {
      granted: "Granted the administrator role",
      restored: "Restored the administrator role",
      widened: "Widened the administrator role to every region",
      already_admin: "Already an administrator; nothing changed",
    }[outcome.status];
    console.log(`${what} (profile ${outcome.profileId}).`);
    console.log(`${outcome.activeAdmins} active administrator${outcome.activeAdmins === 1 ? "" : "s"}.`);
    if (outcome.activeAdmins < 2) {
      console.log("The board's rule is at least two administrators. Grant a second one.");
    }
  } catch (error) {
    if (error instanceof AdminGrantError) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      throw error;
    }
  } finally {
    await closePool();
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
