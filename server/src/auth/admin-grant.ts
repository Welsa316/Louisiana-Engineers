import { emailSchema } from "@shared/schemas/common";
import type { Db } from "../db/tx";

/**
 * `npm run admin:grant -- <email>`: makes the member who signed in with that
 * address an administrator. This is how the first two administrators are
 * created on a new database (02 section 10), along with ADMIN_EMAILS at
 * sign-in (`grantListedAdmin` below); after that, administrators
 * grant each other from the admin screen through `admin_grant`, which keeps
 * the two-administrator minimum.
 *
 * It runs as the table owner (`withSystem`), the one command-line path the
 * architecture allows, because no administrator exists yet to call
 * `admin_grant`. It only grants: it never creates an account, so the person
 * signs in once first, and it refuses an account that could not act as an
 * administrator anyway (unverified, suspended, leaving or deleted).
 */

export type AdminGrantStatus = "granted" | "restored" | "widened" | "already_admin";

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
 * regard to case), for every region (migration 0020). Restores a revoked
 * role; widens a current chapter administrator to every region, the way back
 * when no administrator acts for every region; a current region-wide
 * administrator is left as is. Writes `admin.granted` to the audit log with no actor, since no one
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

  const before = await db.maybeOne<{ revoked: boolean; region_id: string | null }>(
    "SELECT revoked_at IS NOT NULL AS revoked, region_id FROM admin_roles WHERE profile_id = $1 FOR UPDATE",
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
  } else if (before.region_id !== null) {
    // A chapter administrator: the command's roles act for every region.
    await db.query("UPDATE admin_roles SET region_id = NULL WHERE profile_id = $1", [account.id]);
    status = "widened";
  } else {
    status = "already_admin";
  }
  if (status !== "already_admin") {
    await db.query("SELECT write_audit('admin.granted', 'profile', $1, $2::jsonb)", [
      account.id,
      JSON.stringify(status === "widened" ? { via: "admin-grant", region: null } : { via: "admin-grant" }),
    ]);
  }

  const { n } = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM admin_roles WHERE revoked_at IS NULL");
  return { status, profileId: account.id, activeAdmins: n };
}

/**
 * ADMIN_EMAILS at sign-in: grants the role to a listed address that has
 * never held it. Runs inside the sign-in transaction (`withSystem`, the auth
 * module's allowed exception). A role that was revoked is left revoked, and
 * an account that cannot act (suspended, leaving) simply signs in as before.
 */
export async function grantListedAdmin(db: Db, userId: string, listed: readonly string[]): Promise<void> {
  if (listed.length === 0) return;
  const row = await db.maybeOne<{ email: string }>(
    `SELECT u.email::text AS email FROM users u
      WHERE u.id = $1 AND NOT EXISTS (SELECT 1 FROM admin_roles a WHERE a.profile_id = u.id)`,
    [userId],
  );
  if (!row || !listed.includes(row.email.toLowerCase())) return;
  try {
    await grantAdminByEmail(db, row.email);
  } catch (error) {
    if (!(error instanceof AdminGrantError)) throw error;
  }
}
