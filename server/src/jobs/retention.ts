import type { Job } from "./scheduler";

export interface RetentionResult {
  purged: number;
}

/**
 * Daily: `purge_request_text(now - config.retention_months)` empties the
 * free text of expired and declined requests created before the cut-off
 * (A9, 24 months by default) and audits the count. One call, inside the
 * scheduler's system transaction.
 */
export const retentionJob: Job = {
  name: "retention",
  everyMs: 86_400_000,
  async run(db, now): Promise<RetentionResult> {
    const row = await db.maybeOne<{ purged: number }>(
      `SELECT purge_request_text($1::timestamptz - make_interval(months => c.value::int)) AS purged
         FROM config c WHERE c.key = 'retention_months'`,
      [now],
    );
    return { purged: row?.purged ?? 0 };
  },
};
