import { eachRow } from "./each-row";
import type { Job } from "./scheduler";

export interface ExpireRequestsResult {
  expired: number;
  errored: number;
}

/**
 * Hourly: every pending request past its `expires_at` goes to
 * `expire_request`, which marks it expired, tells the mentee (`response`,
 * `request-expired`, email) and audits it. The job only selects ids.
 */
export const expireRequestsJob: Job = {
  name: "expire-requests",
  everyMs: 3_600_000,
  transaction: false,
  async run(db, now): Promise<ExpireRequestsResult> {
    const due = await db.query<{ id: string }>(
      `SELECT id FROM mentorship_requests
        WHERE status = 'pending' AND expires_at <= $1
        ORDER BY expires_at, id`,
      [now],
    );
    const totals = await eachRow(
      "expire-requests",
      due,
      (row) => `request ${row.id}`,
      async (tx, row) => (await tx.one<{ moved: boolean }>("SELECT expire_request($1, $2) AS moved", [row.id, now])).moved,
    );
    return { expired: totals.moved, errored: totals.errored };
  },
};
