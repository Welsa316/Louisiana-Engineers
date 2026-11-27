/**
 * `PATCH /api/me/profile`: the owner's editable profile columns. Every key is
 * optional; a missing key leaves the column alone and `""` or `null` clears an
 * optional one. Unknown keys are refused, so protected columns
 * (`approvalState`, `kind`, `verified`, `adminHiddenAt`, ...) cannot be sent at
 * all; the owner-guard triggers refuse them again in the database.
 *
 * The schema does not know the member's kind: rules that depend on it (a
 * professional's bio cannot be cleared, student fields need a student) are the
 * service's and the database's.
 */

import { z } from "zod";
import {
  audienceSchema,
  bioSchema,
  clearable,
  credentialsSchema,
  educationSchema,
  expertiseSchema,
  httpsUrlSchema,
  interestsSchema,
  linkedinUrlSchema,
  locationSchema,
  nameSchema,
  organizationSchema,
  participationListSchema,
  programSchema,
  slugSchema,
  studentGoalsSchema,
  titleSchema,
  topicsNeededSchema,
  yearsExperienceSchema,
} from "./common";

export const profilePatchSchema = z
  .object({
    // Both kinds
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    credentials: clearable(credentialsSchema),
    location: locationSchema.optional(),
    region: slugSchema.optional(),
    bio: clearable(bioSchema),
    linkedinUrl: clearable(linkedinUrlSchema),
    websiteUrl: clearable(httpsUrlSchema),
    interests: interestsSchema.optional(),
    // Professionals
    title: titleSchema.optional(),
    organization: organizationSchema.optional(),
    disciplineId: slugSchema.optional(),
    yearsExperience: yearsExperienceSchema.optional(),
    expertise: expertiseSchema.optional(),
    education: educationSchema.optional(),
    participation: participationListSchema.optional(),
    // Students
    program: programSchema.optional(),
    level: audienceSchema.optional(),
    institution: programSchema.optional(),
    goals: studentGoalsSchema.optional(),
    topicsNeeded: topicsNeededSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to change" });

export type ProfilePatchInput = z.input<typeof profilePatchSchema>;
export type ProfilePatch = z.output<typeof profilePatchSchema>;
