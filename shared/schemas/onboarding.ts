/**
 * Onboarding payloads (docs/professional-network/03-ux-information-architecture.md
 * section 5). The client validates each step with these schemas and posts the
 * whole payload to `POST /api/me/onboarding`; the server validates again and
 * hands it to `complete_onboarding`.
 */

import { z } from "zod";
import {
  audienceSchema,
  availabilityTextSchema,
  bioSchema,
  checkContact,
  contactMethodsSchema,
  credentialsSchema,
  durationMinSchema,
  educationSchema,
  emailSchema,
  expertiseSchema,
  httpsUrlSchema,
  interestsSchema,
  linkedinUrlSchema,
  locationSchema,
  maxActiveSchema,
  meetingModeSchema,
  mentorAudienceSchema,
  mentoringFormatSchema,
  mentorTopicsSchema,
  nameSchema,
  optionalField,
  organizationSchema,
  participationListSchema,
  phoneSchema,
  programSchema,
  shareWithMembersSchema,
  slugSchema,
  studentGoalsSchema,
  titleSchema,
  topicsNeededSchema,
  yearsExperienceSchema,
} from "./common";
import { onboardingVisibilities } from "../types/common";

/** Step 1: the member confirms the mission statement from src/content/site.ts. */
const acceptMission = z.literal(true, {
  errorMap: () => ({ message: "Confirm the mission statement to continue" }),
});

/** Step 2: basics, both kinds. */
const basics = {
  acceptMission,
  firstName: nameSchema,
  lastName: nameSchema,
  credentials: optionalField(credentialsSchema),
  location: locationSchema,
  /** Prefilled "greater-new-orleans" by the screen; the database defaults it too. */
  region: optionalField(slugSchema),
  linkedinUrl: optionalField(linkedinUrlSchema),
  websiteUrl: optionalField(httpsUrlSchema),
};

/** Step 4, mentorship card: present exactly when `mentoring` is in participation. */
export const mentorshipOfferSchema = z.object({
  topics: mentorTopicsSchema,
  audience: mentorAudienceSchema,
  format: mentoringFormatSchema,
  mode: meetingModeSchema,
  availabilityText: optionalField(availabilityTextSchema),
  durationMin: durationMinSchema,
  /** Omitted means `config.default_max_active`. */
  maxActive: maxActiveSchema.optional(),
});

/** Step 4, contact card. */
export const contactSetupSchema = z.object({
  /** Always includes `mest`. */
  methods: contactMethodsSchema.default(["mest"]),
  /** Shown to signed-in, verified members: a subset of `methods` without `mest`. */
  shareWithMembers: shareWithMembersSchema.default([]),
  /** A different address to share; without it `email` shares the sign-in address. */
  contactEmail: optionalField(emailSchema),
  phone: optionalField(phoneSchema),
  bookingUrl: optionalField(httpsUrlSchema),
});

const studentObject = z.object({
  kind: z.literal("student"),
  ...basics,
  /** Optional for students; when given it meets the same limit. */
  bio: optionalField(bioSchema),
  // Step 3b
  program: programSchema,
  level: audienceSchema,
  institution: programSchema,
  goals: studentGoalsSchema,
  interests: interestsSchema.default([]),
  topicsNeeded: topicsNeededSchema,
});

const professionalObject = z.object({
  kind: z.literal("professional"),
  ...basics,
  bio: bioSchema,
  // Step 3a
  title: titleSchema,
  organization: organizationSchema,
  disciplineId: slugSchema,
  yearsExperience: yearsExperienceSchema,
  /** Labels; unknown ones become `proposed` tags. */
  expertise: expertiseSchema,
  interests: interestsSchema.default([]),
  education: educationSchema.default([]),
  participation: participationListSchema,
  // Step 4
  mentorship: mentorshipOfferSchema.optional(),
  visibility: z.enum(onboardingVisibilities).default("public"),
  contact: contactSetupSchema,
});

type ProfessionalShape = z.output<typeof professionalObject>;

function professionalRules(v: ProfessionalShape, ctx: z.RefinementCtx) {
  const mentoring = v.participation.includes("mentoring");
  if (mentoring && !v.mentorship) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mentorship"], message: "Set up your mentorship offer" });
  }
  if (!mentoring && v.mentorship) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mentorship"],
      message: "Choose Mentorship under participation to offer mentoring",
    });
  }
  checkContact(v.contact, ctx, ["contact"], true);
  if (v.contact.methods.includes("linkedin") && !v.linkedinUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["linkedinUrl"],
      message: "Add your LinkedIn link to share it",
    });
  }
}

export const studentOnboardingSchema = studentObject;
export const professionalOnboardingSchema = professionalObject.superRefine(professionalRules);

/** Either kind, chosen by `kind` (what `POST /api/me/onboarding` accepts). */
export const onboardingSchema = z
  .discriminatedUnion("kind", [studentObject, professionalObject])
  .superRefine((v, ctx) => {
    if (v.kind === "professional") professionalRules(v, ctx);
  });

export type StudentOnboardingInput = z.input<typeof studentOnboardingSchema>;
export type StudentOnboarding = z.output<typeof studentOnboardingSchema>;
export type ProfessionalOnboardingInput = z.input<typeof professionalOnboardingSchema>;
export type ProfessionalOnboarding = z.output<typeof professionalOnboardingSchema>;
export type OnboardingInput = z.input<typeof onboardingSchema>;
export type Onboarding = z.output<typeof onboardingSchema>;
export type MentorshipOffer = z.output<typeof mentorshipOfferSchema>;
export type ContactSetup = z.output<typeof contactSetupSchema>;
