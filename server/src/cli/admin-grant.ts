import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emailSchema } from "@shared/schemas/common";
import type { Db } from "../db/tx";

/**
 * `npm run admin:grant -- <email>`: makes the member who signed in with that
 * address an administrator. This is how the first two administrators are
 * created on a new database (02 section 10); after that, administrators
 * grant each other from the admin screen through `admin_grant`, which keeps
 * the two-administrator minimum.
 *
 * It runs as the table owner (`withSystem`), the one command-line path the
 * architecture allows, because no administrator exists yet to call
 * `admin_grant`. It only grants: it never creates an account, so the person
 * signs in once first, and it refuses an account that could not act as an
 * administrator anyway (unverified, suspended, leaving or deleted).
 */

export type AdminGrantStatus = "granted" | "restored" | "already_admin";

export interface AdminGrantOutcome {
  status: AdminGrantStatus;
  profileId: string;
  /** Active administrator roles after the grant. */
  activeAdmins: number;
}

export type AdminGrantErrorCode = "not_found" | "not_verified" | "suspended" | "deleting" | "deleted";

const MESSAGES: Record<AdminGrantErrorCode, string> = {
  not_found: "No account uses that address. Ask the person to sign in once at /network/signin, then run this again.",
  not_verified: "That account has not confirmed its address yet. Ask the person to sign in with a link, then run this again.",
  suspended: "That account is suspended. Lift the suspension before granting the administrator role.",
  deleting: "That account is scheduled for deletion. It can be granted after the member keeps the account.",
  deleted: "That account has been deleted.",
};

/** A refusal. The message never repeats the address, so logs stay free of it. */
export class AdminGrantError extends Error {
  constructor(readonly code: AdminGrantErrorCode) {
    super(MESSAGES[code]);
    this.name = "AdminGrantError";
  }
}

const USAGE = "Usage: npm run admin:grant -- <email>";

/** The one argument: the address the person signs in with. */
export function parseAdminGrantArgs(args: readonly string[]): string {
  if (args.length !== 1) throw new Error(USAGE);
  const parsed = emailSchema.safeParse(args[0]);
  if (!parsed.success) throw new Error(`That is not an email address. ${USAGE}`);
  return parsed.data;
}

/**
 * Grants the administrator role to the account with `email` (matched without
 * regard to case). Restores a revoked role; a current administrator is left
 * as is. Writes `admin.granted` to the audit log with no actor, since no one
 * is signed in, and no address.
 */
export async function grantAdminByEmail(db: Db, email: string): Promise<AdminGrantOutcome> {
  const address = email.trim();
  const account = await db.maybeOne<{
    id: string;
    verified: boolean;
    suspended: boolean;
    anonymized: boolean;
    deleting: boolean;
  }>(
    `SELECT u.id,
            u.email_verified_at IS NOT NULL AS verified,
            u.suspended_at IS NOT NULL AS suspended,
            p.anonymized_at IS NOT NULL AS anonymized,
            EXISTS (SELECT 1 FROM account_deletions d
                     WHERE d.profile_id = u.id AND d.canceled_at IS NULL AND d.executed_at IS NULL) AS deleting
       FROM users u
       JOIN profiles p ON p.id = u.id
      WHERE u.email = $1::citext AND u.deleted_at IS NULL
      FOR UPDATE OF u`,
    [address],
  );
  if (!account) throw new AdminGrantError("not_found");
  if (account.anonymized) throw new AdminGrantError("deleted");
  if (!account.verified) throw new AdminGrantError("not_verified");
  if (account.suspended) throw new AdminGrantError("suspended");
  if (account.deleting) throw new AdminGrantError("deleting");

  const before = await db.maybeOne<{ revoked: boolean }>(
    "SELECT revoked_at IS NOT NULL AS revoked FROM admin_roles WHERE profile_id = $1 FOR UPDATE",
    [account.id],
  );
  let status: AdminGrantStatus;
  if (!before) {
    await db.query("INSERT INTO admin_roles (profile_id, granted_by, granted_at) VALUES ($1, NULL, now())", [account.id]);
    status = "granted";
  } else if (before.revoked) {
    await db.query(
      "UPDATE admin_roles SET granted_by = NULL, granted_at = now(), revoked_at = NULL, region_id = NULL WHERE profile_id = $1",
      [account.id],
    );
    status = "restored";
  } else {
    status = "already_admin";
  }
  if (status !== "already_admin") {
    await db.query("SELECT write_audit('admin.granted', 'profile', $1, $2::jsonb)", [
      account.id,
      JSON.stringify({ via: "admin-grant" }),
    ]);
  }

  const { n } = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM admin_roles WHERE revoked_at IS NULL");
  return { status, profileId: account.id, activeAdmins: n };
}

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
