import type { Job } from "./scheduler";

export interface CompletePastMeetingsResult {
  completed: number;
}

/**
 * Daily: `complete_past_meetings(now)` moves every upcoming meeting whose
 * time is over to `completed` (02 section 4.6), which is what the
 * dashboard's "meetings held" counts. A meeting a party already answered
 * "Did you meet?" for has left `upcoming` and is not touched. One call,
 * inside the scheduler's system transaction; the job holds no rule itself.
 */
export const completePastMeetingsJob: Job = {
  name: "complete-past-meetings",
  everyMs: 86_400_000,
  async run(db, now): Promise<CompletePastMeetingsResult> {
    const row = await db.one<{ completed: number }>("SELECT complete_past_meetings($1) AS completed", [now]);
    return { completed: row.completed };
  },
};
