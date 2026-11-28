import type { Job } from "./scheduler";

export interface MeetingCheckInResult {
  asked: number;
}

/**
 * Daily: `meeting_prompt(now)` asks both parties of every meeting that
 * started at least a day ago, and that nobody has answered or canceled,
 * "Did you meet?" (reminder, template `meeting-check-in`, emailed), once per
 * meeting. One call, inside the scheduler's system transaction, so the
 * notifications and the `check_in_sent_at` marks commit together.
 */
export const meetingCheckInJob: Job = {
  name: "meeting-check-in",
  everyMs: 86_400_000,
  async run(db, now): Promise<MeetingCheckInResult> {
    const row = await db.one<{ asked: number }>("SELECT meeting_prompt($1) AS asked", [now]);
    return { asked: row.asked };
  },
};
