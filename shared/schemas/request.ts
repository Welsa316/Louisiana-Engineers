/**
 * Mentorship requests, introductions, responses and reports
 * (03 sections 6.3, 7.2 and 8.2). The SQL functions re-check everything that
 * depends on stored state (the mentor's topics, capacity, caps).
 */

import { z } from "zod";
import { limits } from "../limits";
import { contactMethodIds } from "../taxonomy";
import { declineReasons, reportReasons, requestKinds } from "../types/common";
import {
  chars,
  meetingModeSchema,
  optionalField,
  requestFormatSchema,
  sharableMethodSchema,
  slugSchema,
  uniqueList,
  uuidSchema,
} from "./common";

/** `POST /api/requests`. An introduction has no topic and is one-time. */
export const createRequestSchema = z
  .object({
    mentorId: uuidSchema,
    kind: z.enum(requestKinds),
    topicId: slugSchema.nullish(),
    why: chars(limits.why),
    goals: optionalField(chars(limits.requestGoals)),
    format: requestFormatSchema,
    mode: meetingModeSchema,
    schedulingNote: optionalField(chars(limits.schedulingNote)),
  })
  .superRefine((r, ctx) => {
    if (r.kind === "mentorship" && !r.topicId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["topicId"], message: "Choose a topic" });
    }
    if (r.kind === "introduction") {
      if (r.topicId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["topicId"],
          message: "An introduction has no topic",
        });
      }
      if (r.format !== "one-time") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["format"],
          message: "An introduction is a one-time request",
        });
      }
    }
  });

const note = optionalField(chars(limits.note));

/**
 * `POST /api/requests/:id/respond`. Accepting shares at least one contact
 * method for this relationship (never `mest`, which is not a handoff);
 * declining gives a reason. The function checks the methods have values.
 */
export const respondSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("accept"),
      note,
      shareMethods: uniqueList(sharableMethodSchema, {
        min: 1,
        max: contactMethodIds.length - 1,
      }),
    })
    .strict(),
  z
    .object({
      decision: z.literal("decline"),
      note,
      declineReason: z.enum(declineReasons),
    })
    .strict(),
]);

/** `POST /api/profiles/:id/report`. */
export const reportSchema = z.object({
  reason: z.enum(reportReasons),
  detail: optionalField(chars(limits.reportDetail)),
});

export type CreateRequestInput = z.input<typeof createRequestSchema>;
export type CreateRequest = z.output<typeof createRequestSchema>;
export type RespondInput = z.input<typeof respondSchema>;
export type Respond = z.output<typeof respondSchema>;
export type ReportInput = z.input<typeof reportSchema>;
export type Report = z.output<typeof reportSchema>;
