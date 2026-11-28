/**
 * Post-completion feedback (Task 32, REL-8): `GET` and `POST
 * /api/requests/:id/feedback` for the two parties, `GET /api/admin/feedback`
 * for administrators. Each party answers once, after the relationship is
 * completed, and only they read their answer: the other party never sees
 * it, and administrators for every region read the comments without any
 * author, request, relationship or kind attached, dated by quarter, and
 * never those about a relationship they were a party to (the average and
 * the count are on the dashboard, once there are 5 answers).
 */

import type { Paged } from "./common";
import type { RequestRole } from "./requests";

/**
 * Where the caller stands: `unavailable` until the relationship is
 * completed (or for a request that never became one), `open` once they can
 * answer, `left` after they did.
 */
export const feedbackStates = ["unavailable", "open", "left"] as const;
export type FeedbackState = (typeof feedbackStates)[number];

/** The caller's own answer. */
export interface OwnFeedback {
  /** 1 (not helpful) to 5 (very helpful). */
  helpful: number;
  /** null when they left none, or after the retention or deletion rules emptied it. */
  comment: string | null;
  createdAt: string;
}

/** `GET /api/requests/:id/feedback`, and the answer to `POST`. */
export interface FeedbackResponse {
  state: FeedbackState;
  mine: OwnFeedback | null;
}

/**
 * `409` codes of `POST /api/requests/:id/feedback`: the relationship is not
 * completed yet, the caller already answered, or the other party has left
 * and a comment can no longer be added (the rating alone still can).
 */
export type FeedbackErrorCode = "not_completed" | "feedback_exists" | "comment_closed";

/** One comment as administrators read it: which side wrote it and when (by quarter), nothing more. */
export interface AdminFeedbackComment {
  id: string;
  authorRole: RequestRole;
  helpful: number;
  comment: string;
  /** YYYY-"Q"Q, for example 2026-Q4, America/Chicago. */
  quarter: string;
}

/**
 * `GET /api/admin/feedback?page&size`: comments only, by quarter, newest
 * first, then in an order that says nothing about when. A chapter
 * administrator is answered `409 { code: 'out_of_region' }`.
 */
export type AdminFeedbackResponse = Paged<AdminFeedbackComment>;

/** In the personal data export: the caller's own answers only. */
export interface ExportFeedback {
  /** The request the relationship came from, as listed in `requests`. */
  requestId: string;
  role: RequestRole;
  /** The other party's display name ("Former member" once deleted). */
  counterparty: string;
  helpful: number;
  comment: string | null;
  createdAt: string;
}
