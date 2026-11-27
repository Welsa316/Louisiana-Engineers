import type { Job } from "./scheduler";

export interface AdminDigestResult {
  /** Whether a week had passed since the last digest, so one went out. */
  due: boolean;
  /** Administrators notified this run. */
  notified: number;
}

/**
 * Daily, acting weekly: `admin_digest(now)` sends each active administrator
 * one `admin_digest` notification (queue size, open reports, requests
 * waiting, the oldest one's date) when the last digest is at least seven
 * days old, and does nothing otherwise. The function keeps that date
 * itself, under a lock, because the scheduler stamps this job's own
 * `job_runs.last_run_at` after every daily run.
 */
export const adminDigestJob: Job = {
  name: "admin-digest",
  everyMs: 86_400_000,
  async run(db, now): Promise<AdminDigestResult> {
    const row = await db.one<{ notified: number | null }>("SELECT admin_digest($1) AS notified", [now]);
    return row.notified === null ? { due: false, notified: 0 } : { due: true, notified: row.notified };
  },
};
