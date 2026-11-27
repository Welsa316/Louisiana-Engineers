import { eachRow } from "./each-row";
import type { Job } from "./scheduler";

export interface RemindersResult {
  sent: number;
  errored: number;
}

/**
 * Daily: a pending request whose next reminder is due, that is one created at
 * least `config.reminder_days[n]` days ago with `reminders_sent = n`, goes to
 * `send_request_reminder(id, n)`, which tells the mentor and counts it.
 *
 * Each request is selected once per run at its current count, so a run that
 * comes after a missed day sends the overdue reminder and leaves the next
 * one to a later run rather than sending both at once.
 */
export const remindersJob: Job = {
  name: "reminders",
  everyMs: 86_400_000,
  transaction: false,
  async run(db, now): Promise<RemindersResult> {
    const due = await db.query<{ id: string; n: number }>(
      `SELECT r.id, r.reminders_sent AS n
         FROM mentorship_requests r
         JOIN config c ON c.key = 'reminder_days'
        WHERE r.status = 'pending'
          AND r.expires_at > $1
          AND r.reminders_sent < jsonb_array_length(c.value)
          AND r.created_at + make_interval(days => (c.value ->> r.reminders_sent)::int) <= $1
        ORDER BY r.created_at, r.id`,
      [now],
    );
    const totals = await eachRow(
      "reminders",
      due,
      (row) => `request ${row.id} reminder ${row.n + 1}`,
      async (tx, row) =>
        (await tx.one<{ moved: boolean }>("SELECT send_request_reminder($1, $2, $3) AS moved", [row.id, row.n, now])).moved,
    );
    return { sent: totals.moved, errored: totals.errored };
  },
};
