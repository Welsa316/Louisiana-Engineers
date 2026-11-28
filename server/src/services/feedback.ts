import type { Paged } from "@shared/types/common";
import type { AdminFeedbackComment, ExportFeedback, FeedbackResponse, OwnFeedback } from "@shared/types/feedback";
import type { RequestRole } from "@shared/types/requests";
import type { LeaveFeedback } from "@shared/schemas/feedback";
import type { Db } from "../db/tx";
import { UUID_PATTERN } from "./directory";
import { counterpartyName } from "./export";

/**
 * Post-completion feedback (Task 32). The one write is `leave_feedback`,
 * which checks the caller, the relationship and the numbers and raises
 * `mest.<code>`. Reads go through the row policy on `relationship_feedback`
 * (the author only) and, for administrators, `admin_feedback` (comments with
 * no author attached).
 */

interface OwnRow {
  helpful: number;
  comment: string | null;
  created_at: Date;
}

function own(row: OwnRow): OwnFeedback {
  return { helpful: row.helpful, comment: row.comment, createdAt: row.created_at.toISOString() };
}

/**
 * The caller's feedback state for the request `requestId`, or null when the
 * request is not theirs (the request's row policy shows it to its two
 * parties only), so the route answers 404.
 */
export async function getFeedback(db: Db, requestId: string): Promise<FeedbackResponse | null> {
  if (!UUID_PATTERN.test(requestId)) return null;
  const request = await db.maybeOne<{ completed: boolean }>(
    `SELECT rel.completed_at IS NOT NULL AS completed
       FROM mentorship_requests r
       LEFT JOIN mentorship_relationships rel ON rel.request_id = r.id
      WHERE r.id = $1`,
    [requestId],
  );
  if (!request) return null;
  const mine = await db.maybeOne<OwnRow>(
    `SELECT f.helpful, f.comment, f.created_at
       FROM relationship_feedback f
       JOIN mentorship_relationships rel ON rel.id = f.relationship_id
      WHERE rel.request_id = $1 AND f.author_id = app_uid()`,
    [requestId],
  );
  if (mine) return { state: "left", mine: own(mine) };
  return { state: request.completed ? "open" : "unavailable", mine: null };
}

/** `leave_feedback`; the caller's state afterwards. */
export async function leaveFeedback(db: Db, requestId: string, input: LeaveFeedback): Promise<FeedbackResponse> {
  await db.query("SELECT leave_feedback($1, $2, $3)", [requestId, input.helpful, input.comment ?? null]);
  const after = await getFeedback(db, requestId);
  if (!after) throw new Error(`feedback for ${requestId} not readable after leave_feedback`);
  return after;
}

/* ------------------------------------------------------------ administrators */

interface AdminRow {
  id: string;
  author_role: RequestRole;
  helpful: number;
  comment: string;
  quarter: string;
  total: string;
}

/**
 * `admin_feedback`: the comments by quarter, newest first, with no author.
 * Administrators for every region only (a chapter administrator's call
 * raises `mest.out_of_region`), and never the comments about a
 * relationship the caller was a party to.
 */
export async function listFeedbackComments(db: Db, page: { page: number; size: number }): Promise<Paged<AdminFeedbackComment>> {
  const rows = await db.query<AdminRow>(
    "SELECT id, author_role, helpful, comment, quarter, total FROM admin_feedback($1, $2)",
    [page.page, page.size],
  );
  let total = rows.length > 0 ? Number(rows[0].total) : 0;
  if (rows.length === 0 && page.page > 1) {
    // Past the last page: the window count is not there to read, so ask once.
    const first = await db.maybeOne<{ total: string }>("SELECT total FROM admin_feedback(1, 1)");
    total = first ? Number(first.total) : 0;
  }
  return {
    items: rows.map((row) => ({
      id: row.id,
      authorRole: row.author_role,
      helpful: row.helpful,
      comment: row.comment,
      quarter: row.quarter,
    })),
    total,
  };
}

/* ------------------------------------------------------------------ export */

interface ExportRow {
  request_id: string;
  role: RequestRole;
  counterparty_first_name: string | null;
  counterparty_last_name: string | null;
  counterparty_former: boolean;
  helpful: number;
  comment: string | null;
  created_at: Date;
}

/**
 * The caller's own answers for the export, with the other party as a
 * display name from `my_requests`. The row policy keeps every other
 * member's answers out, the other party's included.
 */
export async function exportFeedback(db: Db): Promise<ExportFeedback[]> {
  const rows = await db.query<ExportRow>(
    `SELECT r.id AS request_id, r.role, r.counterparty_first_name, r.counterparty_last_name, r.counterparty_former,
            f.helpful, f.comment, f.created_at
       FROM relationship_feedback f
       JOIN mentorship_relationships rel ON rel.id = f.relationship_id
       JOIN my_requests r ON r.id = rel.request_id
      WHERE f.author_id = app_uid()
      ORDER BY f.created_at, f.id`,
  );
  return rows.map((row) => ({
    requestId: row.request_id,
    role: row.role,
    counterparty: counterpartyName(row.counterparty_first_name, row.counterparty_last_name, row.counterparty_former),
    helpful: row.helpful,
    comment: row.comment,
    createdAt: row.created_at.toISOString(),
  }));
}
