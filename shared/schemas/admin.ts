/**
 * Administrator actions (03 section 8; routes under `/api/admin/*`). The SQL
 * functions validate again: `admin_update_config` applies the same per-key
 * ranges from `configLimits`.
 */

import { z } from "zod";
import { configLimits, fieldLimits, limits } from "../limits";
import { reportActions, verifiedMethods, vocabularyKinds } from "../types/common";
import { chars, optionalField, slugSchema } from "./common";

/** `POST /api/admin/reviews/:id`. Declining needs notes: they are sent to the member. */
export const adminReviewSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approved"),
    notes: optionalField(chars(limits.reportDetail)),
  }),
  z.object({
    decision: z.literal("declined"),
    notes: chars({ min: 1, max: limits.reportDetail.max }),
  }),
]);

/** `POST /api/admin/profiles/:id/verified`. `null` clears verification. */
export const adminVerifiedSchema = z.object({
  method: z.enum(verifiedMethods).nullable(),
});

/** `POST /api/admin/tags/:id`. */
export const adminTagDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

/** `POST /api/admin/vocabulary`: add a discipline or a mentorship topic. */
export const adminVocabularySchema = z.object({
  kind: z.enum(vocabularyKinds),
  id: slugSchema,
  label: chars(fieldLimits.vocabularyLabel),
});

/** Resolving or dismissing a report (Task 24). A dismissal takes no action. */
export const adminResolveReportSchema = z
  .object({
    status: z.enum(["resolved", "dismissed"]),
    note: optionalField(chars(limits.reportDetail)),
    action: z.enum(reportActions).default("none"),
  })
  .superRefine((r, ctx) => {
    if (r.status === "dismissed" && r.action !== "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["action"],
        message: "A dismissed report takes no action",
      });
    }
  });

type NumericConfigKey = {
  [K in keyof typeof configLimits]: (typeof configLimits)[K] extends { min: number } ? K : never;
}[keyof typeof configLimits];

const configInt = (key: NumericConfigKey) =>
  z.number().int().min(configLimits[key].min).max(configLimits[key].max).optional();

/**
 * `PATCH /api/admin/config`, keyed by the `config` table's keys. Each key is
 * checked against its range; `reminder_days` must be ascending and each below
 * `request_expiry_days` (the one in the patch, or else the largest allowed;
 * the function checks the stored value).
 */
export const configPatchSchema = z
  .object({
    request_expiry_days: configInt("request_expiry_days"),
    reminder_days: z.array(z.number().int().min(1)).max(10).optional(),
    pending_cap: configInt("pending_cap"),
    default_max_active: configInt("default_max_active"),
    daily_request_limit: configInt("daily_request_limit"),
    daily_report_limit: configInt("daily_report_limit"),
    magic_links_per_hour: configInt("magic_links_per_hour"),
    platform_paused: z.boolean().optional(),
    retention_months: configInt("retention_months"),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (Object.keys(c).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Nothing to change" });
    }
    const days = c.reminder_days;
    if (!days) return;
    if (days.some((d, i) => i > 0 && d <= days[i - 1])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reminder_days"],
        message: "List reminder days in ascending order without repeats",
      });
    }
    const expiry = c.request_expiry_days ?? configLimits.request_expiry_days.max;
    if (days.some((d) => d >= expiry)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reminder_days"],
        message: `Send every reminder before the request expires (day ${expiry})`,
      });
    }
  });

export type AdminReview = z.output<typeof adminReviewSchema>;
export type AdminVerified = z.output<typeof adminVerifiedSchema>;
export type AdminTagDecision = z.output<typeof adminTagDecisionSchema>;
export type AdminVocabulary = z.output<typeof adminVocabularySchema>;
export type AdminResolveReport = z.output<typeof adminResolveReportSchema>;
export type ConfigPatch = z.output<typeof configPatchSchema>;
