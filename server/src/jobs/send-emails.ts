import { withSystem } from "../db/tx";
import { MAX_ATTEMPTS, recordOutboxFailure, sendOutboxRow } from "../email/outbox";
import { defaultMailer, type Mailer } from "../email/resend";
import type { Job } from "./scheduler";
import { safeErrorSummary } from "../http/errors";

export interface SendEmailsResult {
  sent: number;
  failed: number;
  gaveUp: number;
  /** Rows whose transaction threw (not a provider refusal); counted as one attempt each. */
  errored: number;
}

export interface SendEmailsOptions {
  /** Defaults to Resend, or the log mailer without `RESEND_API_KEY`. */
  mailer?: Mailer;
  /** Rows per run (default 50). */
  batchSize?: number;
}

/**
 * Drains the email outbox every minute. Each row is claimed, sent and marked
 * in its own short transaction, so a failure on one row never rolls back the
 * marks of rows already sent (which would send them again next run). Each
 * row is tried at most once per run, so a provider outage spends one of a
 * row's three attempts per minute rather than all three at once.
 */
export function createSendEmailsJob(options: SendEmailsOptions = {}): Job {
  const batchSize = options.batchSize ?? 50;
  return {
    name: "send-emails",
    everyMs: 60_000,
    transaction: false,
    async run(db): Promise<SendEmailsResult> {
      const mailer = options.mailer ?? defaultMailer();
      const due = await db.query<{ id: string }>(
        `SELECT id FROM email_outbox
          WHERE sent_at IS NULL AND attempts < $1
          ORDER BY created_at, id
          LIMIT $2`,
        [MAX_ATTEMPTS, batchSize],
      );

      const totals: SendEmailsResult = { sent: 0, failed: 0, gaveUp: 0, errored: 0 };
      for (const { id } of due) {
        try {
          const result = await withSystem((tx) => sendOutboxRow(tx, id, mailer));
          totals.sent += result.sent;
          totals.failed += result.failed;
          totals.gaveUp += result.gaveUp;
        } catch (error) {
          console.error(`[jobs] send-emails: outbox row ${id} failed`, safeErrorSummary(error));
          totals.errored += 1;
          // If even this fails the database is unreachable: stop the run and
          // let the scheduler retry on the next interval.
          await withSystem((tx) => recordOutboxFailure(tx, id, error));
        }
      }
      return totals;
    },
  };
}

export const sendEmailsJob: Job = createSendEmailsJob();
