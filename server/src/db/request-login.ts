import type { Pool } from "./pool";

/**
 * Checks, at start in production, that the request pool logs in as a role
 * that cannot escape row-level security: not a superuser, not BYPASSRLS, not
 * the owner of the tables, and a member of `app_user`. `SET ROLE app_user` is
 * reversible, so a request pool that logged in as the owner would let SQL in
 * a request `RESET ROLE` back to it. Also proves the password works, so a
 * deploy with a wrong `REQUEST_DATABASE_URL` fails its start instead of
 * answering every API request with an error. Returns the login's name.
 */
export async function verifyRequestLogin(pool: Pool): Promise<string> {
  let row: { name: string; superuser: boolean; bypassrls: boolean; owner: boolean; app_user: boolean } | undefined;
  try {
    const result = await pool.query<{
      name: string;
      superuser: boolean;
      bypassrls: boolean;
      owner: boolean;
      app_user: boolean;
    }>(
      `SELECT r.rolname AS name,
              r.rolsuper AS superuser,
              r.rolbypassrls AS bypassrls,
              EXISTS (SELECT 1 FROM pg_tables t
                       WHERE t.schemaname = 'public' AND t.tablename = 'users'
                         AND pg_has_role(r.oid, t.tableowner::regrole, 'MEMBER')) AS owner,
              pg_has_role(r.oid, 'app_user', 'MEMBER') AS app_user
         FROM pg_roles r
        WHERE r.rolname = current_user`,
    );
    row = result.rows[0];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The request pool cannot connect (${reason}). Check REQUEST_DATABASE_URL; see the runbook.`, {
      cause: error,
    });
  }
  if (!row) throw new Error("The request pool's login role was not found. Check REQUEST_DATABASE_URL; see the runbook.");
  if (row.superuser || row.bypassrls || row.owner || !row.app_user) {
    throw new Error(
      `REQUEST_DATABASE_URL logs in as ${row.name}, which can bypass row-level security. ` +
        "It must log in as mest_request; see the runbook.",
    );
  }
  return row.name;
}
