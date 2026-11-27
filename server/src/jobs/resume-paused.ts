import { eachRow } from "./each-row";
import type { Job } from "./scheduler";

export interface ResumePausedResult {
  resumed: number;
  errored: number;
}

/**
 * The day `paused_until` is compared with: the scheduler's `now` (`$1`) as a
 * Louisiana date, the calendar request payloads state their dates in.
 */
const TODAY = `($1::timestamptz AT TIME ZONE 'America/Chicago')::date`;

/**
 * Daily: every paused mentor whose `paused_until` has come goes to
 * `resume_mentor`, which makes them active again (or off, when their offer
 * is no longer complete) and audits it. The job only selects ids.
 */
export const resumePausedJob: Job = {
  name: "resume-paused",
  everyMs: 86_400_000,
  transaction: false,
  async run(db, now): Promise<ResumePausedResult> {
    const due = await db.query<{ profile_id: string }>(
      `SELECT profile_id FROM mentorship_settings
        WHERE status = 'paused' AND paused_until <= ${TODAY}
        ORDER BY paused_until, profile_id`,
      [now],
    );
    const totals = await eachRow(
      "resume-paused",
      due,
      (row) => `mentor ${row.profile_id}`,
      async (tx, row) =>
        (await tx.one<{ moved: boolean }>(`SELECT resume_mentor($2, ${TODAY}) AS moved`, [now, row.profile_id])).moved,
    );
    return { resumed: totals.moved, errored: totals.errored };
  },
};
