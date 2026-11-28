/**
 * Post-completion feedback (Task 32): the two questions. `leave_feedback`
 * re-checks both numbers and everything that depends on stored state (the
 * relationship being completed, the caller being a party, one answer each).
 */

import { z } from "zod";
import { fieldLimits } from "../limits";
import { chars, optionalField } from "./common";

/** `POST /api/requests/:id/feedback`. An empty comment is no comment. */
export const leaveFeedbackSchema = z
  .object({
    helpful: z.number().int().min(fieldLimits.feedbackHelpful.min).max(fieldLimits.feedbackHelpful.max),
    comment: optionalField(chars(fieldLimits.feedbackComment)),
  })
  .strict();
export type LeaveFeedback = z.output<typeof leaveFeedbackSchema>;
