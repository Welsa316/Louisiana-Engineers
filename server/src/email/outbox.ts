import type { Db } from "../db/tx";
import { defaultMailer, type Mailer } from "./resend";
import { renderTemplate, type TemplateData } from "./templates/registry";

/** Attempts per outbox row before the sender gives up and records the last error. */
export const MAX_ATTEMPTS = 3;

export interface OutboxBatchResult {
  /** Rows delivered to the mailer in this batch. */
  sent: number;
  /** Rows whose attempt failed in this batch (including those given up on). */
  failed: number;
  /** Rows that reached MAX_ATTEMPTS in this batch and will not be tried again. */
  gaveUp: number;
}

interface OutboxRow {
  id: string;
  notification_id: string | null;
  to_email: string;
  template: string;
  payload: TemplateData;
  attempts: number;
}

/** Templates whose payload is a credential and is emptied once sent. */
const SECRET_PAYLOAD_TEMPLATES = new Set(["magic-link"]);

/**
 * Renders and sends up to `limit` unsent outbox rows, oldest first. Each row
 * is marked `sent_at` on success; on failure `attempts` goes up by one with
 * `last_error`, and a row that reaches three attempts is not picked up again.
 * The linked notification's `email_status` follows (`sent` or `failed`).
 *
 * Runs inside the caller's transaction (the `send-emails` job's `withSystem`);
 * rows are locked with SKIP LOCKED so two senders never take the same row.
 */
export async function sendOutboxBatch(db: Db, limit = 50, mailer: Mailer = defaultMailer()): Promise<OutboxBatchResult> {
  const rows = await db.query<OutboxRow>(
    `SELECT id, notification_id, to_email::text AS to_email, template, payload, attempts
       FROM email_outbox
      WHERE sent_at IS NULL AND attempts < $1
      ORDER BY created_at, id
      LIMIT $2
      FOR UPDATE SKIP LOCKED`,
    [MAX_ATTEMPTS, limit],
  );

  const result: OutboxBatchResult = { sent: 0, failed: 0, gaveUp: 0 };
  for (const row of rows) {
    try {
      const rendered = renderTemplate(row.template, row.payload ?? {});
      await mailer.send({ to: row.to_email, ...rendered });
    } catch (error) {
      const attempts = row.attempts + 1;
      await db.query("UPDATE email_outbox SET attempts = $2, last_error = $3 WHERE id = $1", [
        row.id,
        attempts,
        errorMessage(error),
      ]);
      result.failed += 1;
      if (attempts >= MAX_ATTEMPTS) {
        result.gaveUp += 1;
        if (row.notification_id) {
          await db.query("UPDATE notifications SET email_status = 'failed' WHERE id = $1", [row.notification_id]);
        }
      }
      continue;
    }

    await db.query(
      `UPDATE email_outbox
          SET sent_at = now(), last_error = NULL,
              payload = CASE WHEN $2 THEN '{}'::jsonb ELSE payload END
        WHERE id = $1`,
      [row.id, SECRET_PAYLOAD_TEMPLATES.has(row.template)],
    );
    if (row.notification_id) {
      await db.query("UPDATE notifications SET email_status = 'sent' WHERE id = $1", [row.notification_id]);
    }
    result.sent += 1;
  }
  return result;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000) || "unknown error";
}
