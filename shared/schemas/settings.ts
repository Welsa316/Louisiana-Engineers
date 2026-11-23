/**
 * `PATCH /api/me/settings`: visibility, contact preferences, the mentorship
 * offer and notification preferences. Every section and key is optional; a
 * missing key leaves the stored value alone, `""` or `null` clears an optional
 * value. Unknown keys are refused at every level.
 *
 * A change to `mentorship.status` goes through `set_mentorship_status`, which
 * takes the status and `resumeOn` together: to change only the resume date of
 * a paused offer, send `status: "paused"` with the new `resumeOn`.
 */

import { z } from "zod";
import {
  availabilityTextSchema,
  checkContact,
  clearable,
  contactMethodsSchema,
  dateSchema,
  durationMinSchema,
  emailSchema,
  httpsUrlSchema,
  maxActiveSchema,
  meetingModeSchema,
  mentorAudienceSchema,
  mentoringFormatSchema,
  mentorStatusSchema,
  mentorTopicsSchema,
  phoneSchema,
  shareWithMembersSchema,
  visibilitySchema,
} from "./common";

export const contactPatchSchema = z
  .object({
    methods: contactMethodsSchema.optional(),
    shareWithMembers: shareWithMembersSchema.optional(),
    contactEmail: clearable(emailSchema),
    phone: clearable(phoneSchema),
    bookingUrl: clearable(httpsUrlSchema),
  })
  .strict()
  .superRefine((c, ctx) => checkContact(c, ctx, [], false));

export const mentorshipPatchSchema = z
  .object({
    status: mentorStatusSchema.optional(),
    /** Only with `status: "paused"`; the `resume-paused` job resumes on this date. */
    resumeOn: dateSchema.nullish(),
    topics: mentorTopicsSchema.optional(),
    audience: mentorAudienceSchema.optional(),
    format: mentoringFormatSchema.optional(),
    mode: meetingModeSchema.optional(),
    availabilityText: clearable(availabilityTextSchema),
    durationMin: durationMinSchema.optional(),
    /** Lowering it keeps existing relationships; it only stops new accepts. */
    maxActive: maxActiveSchema.optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.resumeOn && m.status !== "paused") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resumeOn"],
        message: "A resume date needs the paused status",
      });
    }
  });

/** Keys follow `notification_preferences` (`email_requests` is `requests`, ...). */
export const notificationPatchSchema = z
  .object({
    requests: z.boolean().optional(),
    responses: z.boolean().optional(),
    reminders: z.boolean().optional(),
    profile: z.boolean().optional(),
    reports: z.boolean().optional(),
    adminDigest: z.boolean().optional(),
    productUpdates: z.boolean().optional(),
  })
  .strict();

export const settingsPatchSchema = z
  .object({
    visibility: visibilitySchema.optional(),
    contact: contactPatchSchema.optional(),
    mentorship: mentorshipPatchSchema.optional(),
    notifications: notificationPatchSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to change" });

export type SettingsPatchInput = z.input<typeof settingsPatchSchema>;
export type SettingsPatch = z.output<typeof settingsPatchSchema>;
export type ContactPatch = z.output<typeof contactPatchSchema>;
export type MentorshipPatch = z.output<typeof mentorshipPatchSchema>;
export type NotificationPatch = z.output<typeof notificationPatchSchema>;
