import type { Job } from "./scheduler";

export interface MemberDigestResult {
  /** Members sent a digest this run. */
  sent: number;
}

/**
 * Daily, acting at most weekly per member: `member_digest(now)` sends each
 * member who turned the digest on (`email_member_digest`, off by default)
 * one `member_digest` notification, emailed with template `member-digest`,
 * when their last digest is at least seven days old and something is new
 * since: professionals newly listed in their discipline, or mentors who
 * started taking requests for the topics they chose. Names and titles only.
 * A member with nothing new gets nothing, and their week does not restart.
 * One call, inside the scheduler's system transaction, so the notifications
 * and the per-member stamps commit together.
 */
export const memberDigestJob: Job = {
  name: "member-digest",
  everyMs: 86_400_000,
  async run(db, now): Promise<MemberDigestResult> {
    const row = await db.one<{ sent: number }>("SELECT member_digest($1) AS sent", [now]);
    return { sent: row.sent };
  },
};
