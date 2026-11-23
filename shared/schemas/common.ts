/**
 * Building blocks for the shared zod schemas. Every length comes from
 * shared/limits.ts; nothing here hardcodes a number the limits table owns.
 */

import { z } from "zod";
import { fieldLimits, limits, paging, type Range } from "../limits";
import { audienceIds, contactMethodIds, participationIds } from "../taxonomy";
import {
  mentoringFormats,
  mentorStatuses,
  meetingModes,
  requestFormats,
  visibilities,
} from "../types/common";

/** Length as Postgres `char_length` counts it: code points, not UTF-16 units. */
export const charCount = (s: string) => Array.from(s).length;

/** Trimmed text whose character count lies in `range`. */
export function chars(range: Range) {
  return z
    .string()
    .trim()
    .superRefine((s, ctx) => {
      const n = charCount(s);
      if (n < range.min) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          type: "string",
          minimum: range.min,
          inclusive: true,
          message: range.min === 1 ? "Required" : `Use at least ${range.min} characters`,
        });
      } else if (n > range.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          type: "string",
          maximum: range.max,
          inclusive: true,
          message: `Use at most ${range.max} characters`,
        });
      }
    });
}

/**
 * Whitespace only. Listed after the real schema in the unions below, so when
 * both fail the person sees the real schema's message (zod reports the first
 * option that got past type checks).
 */
const blank = z.string().regex(/^\s*$/);

/**
 * An optional field in a form: missing or empty (after trimming) means "not
 * given" and parses to `undefined`; anything else must pass `schema`.
 */
export function optionalField<T extends z.ZodTypeAny>(schema: T) {
  return z
    .union([schema, blank])
    .optional()
    .transform((v) => (typeof v === "string" && v.trim() === "" ? undefined : v) as z.output<T> | undefined);
}

/**
 * A field in a patch that the owner may clear: `""` or `null` parse to `null`
 * (clear it), a missing key stays `undefined` (leave it alone).
 */
export function clearable<T extends z.ZodTypeAny>(schema: T) {
  return z
    .union([schema, z.null(), blank])
    .optional()
    .transform((v) => (typeof v === "string" && v.trim() === "" ? null : v) as z.output<T> | null | undefined);
}

/** A list with a counted size and no duplicates (compared by `key`). */
export function uniqueList<T extends z.ZodTypeAny>(
  item: T,
  range: { min: number; max: number },
  key: (v: z.output<T>) => unknown = (v) => v,
) {
  return z
    .array(item)
    .min(range.min, range.min === 1 ? "Choose at least one" : `Choose at least ${range.min}`)
    .max(range.max, `Choose at most ${range.max}`)
    .superRefine((items, ctx) => {
      const seen = new Set<unknown>();
      for (const v of items) {
        const k = key(v);
        if (seen.has(k)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Remove the duplicate" });
          return;
        }
        seen.add(k);
      }
    });
}

/* ----------------------------------------------------------------- formats */

export const uuidSchema = z.string().uuid();

/** Lowercase slug: vocabulary ids, topic ids, region. */
export const slugSchema = z
  .string()
  .min(fieldLimits.slug.min)
  .max(fieldLimits.slug.max)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens");

function parseUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/** An absolute `https` URL. */
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(fieldLimits.url.max)
  .refine((s) => parseUrl(s)?.protocol === "https:", "Use a full link starting with https://");

/** A LinkedIn link: `https` on `linkedin.com` or `www.linkedin.com`. */
export const linkedinUrlSchema = httpsUrlSchema.refine((s) => {
  const host = parseUrl(s)?.hostname;
  return host === "linkedin.com" || host === "www.linkedin.com";
}, "Use your linkedin.com profile link");

export const emailSchema = z.string().trim().max(fieldLimits.email.max).email("Use a valid email address");

/**
 * A phone number, normalized to E.164. Accepts what people type: spaces,
 * dashes, dots and parentheses are dropped, and a 10-digit number (or 1 plus
 * 10 digits) is read as North American.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((s) => {
    const compact = s.replace(/[\s().-]/g, "");
    if (/^\d{10}$/.test(compact)) return `+1${compact}`;
    if (/^1\d{10}$/.test(compact)) return `+${compact}`;
    return compact;
  })
  .refine((s) => /^\+[1-9]\d{6,14}$/.test(s), "Use a full phone number, for example +1 504 555 0100");

/** A calendar date `YYYY-MM-DD` that exists. */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-01-15")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Use a real date");

/* ------------------------------------------------------------------- enums */

export const visibilitySchema = z.enum(visibilities);
export const mentorStatusSchema = z.enum(mentorStatuses);
export const mentoringFormatSchema = z.enum(mentoringFormats);
export const requestFormatSchema = z.enum(requestFormats);
export const meetingModeSchema = z.enum(meetingModes);
export const audienceSchema = z.enum(audienceIds);
export const contactMethodSchema = z.enum(contactMethodIds);
export const participationSchema = z.enum(participationIds);

/** A method a member can hand over: every contact method except `mest`. */
export const sharableMethodSchema = contactMethodSchema.refine(
  (m) => m !== "mest",
  "Requests through MEST is not a contact detail",
);

export const durationMinSchema = z.union([
  z.literal(fieldLimits.durationMin[0]),
  z.literal(fieldLimits.durationMin[1]),
  z.literal(fieldLimits.durationMin[2]),
]);

/* ----------------------------------------------------------- profile parts */

export const nameSchema = chars(limits.name);
export const credentialsSchema = chars(limits.credentials);
export const bioSchema = chars(limits.bio);
export const locationSchema = chars(limits.location);
export const titleSchema = chars(limits.title);
export const organizationSchema = chars(limits.organization);
export const programSchema = chars(limits.program);
export const studentGoalsSchema = chars(limits.goals);
export const availabilityTextSchema = chars(limits.availabilityText);

export const yearsExperienceSchema = z
  .number()
  .int()
  .min(limits.yearsExperience.min)
  .max(limits.yearsExperience.max);

export const maxActiveSchema = z.number().int().min(limits.maxActive.min).max(limits.maxActive.max);

/** Expertise tag labels; unknown labels become `proposed` tags on the server. */
export const expertiseSchema = uniqueList(chars(limits.expertise.tag), limits.expertise, (v) => v.toLowerCase());

export const interestsSchema = uniqueList(chars(limits.interests.item), limits.interests, (v) => v.toLowerCase());

export const educationEntrySchema = z.object({
  degree: chars(fieldLimits.educationText),
  field: chars(fieldLimits.educationText),
  school: chars(fieldLimits.educationText),
  year: z
    .number()
    .int()
    .min(fieldLimits.educationYear.min)
    .refine(
      (y) => y <= new Date().getFullYear() + fieldLimits.educationYear.yearsAhead,
      `Use a year no more than ${fieldLimits.educationYear.yearsAhead} years ahead`,
    ),
});

export const educationSchema = z.array(educationEntrySchema).min(limits.education.min).max(limits.education.max);

export const participationListSchema = uniqueList(participationSchema, {
  min: 0,
  max: participationIds.length,
});

export const topicsNeededSchema = uniqueList(slugSchema, limits.topicsNeeded);

export const mentorTopicsSchema = uniqueList(slugSchema, { min: fieldLimits.mentorTopics.min, max: 50 });

export const mentorAudienceSchema = uniqueList(audienceSchema, {
  min: fieldLimits.mentorAudience.min,
  max: audienceIds.length,
});

export const contactMethodsSchema = uniqueList(contactMethodSchema, { min: 1, max: contactMethodIds.length });

export const shareWithMembersSchema = uniqueList(contactMethodSchema, { min: 0, max: contactMethodIds.length });

/* ------------------------------------------------------------------ paging */

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(paging.maxSize).default(paging.defaultSize),
});

/* ------------------------------------------------------ contact rule checks */

interface ContactShape {
  methods?: readonly string[];
  shareWithMembers?: readonly string[];
  phone?: string | null;
  bookingUrl?: string | null;
}

/**
 * The contact rules: `methods` contains `mest`; `shareWithMembers` never
 * contains `mest` and is a subset of `methods`; a chosen method has its value.
 * `email` needs no value (it falls back to the sign-in address at release
 * time); `linkedin` is checked by the caller because the link is a profile
 * field, not a contact field.
 *
 * `complete` is true for a whole payload (onboarding), where a missing value
 * is an error. In a patch (`complete` false) a missing key means "unchanged"
 * and only an explicit clear (`null`) of a chosen method's value is an error;
 * the database checks the stored row.
 */
export function checkContact(
  c: ContactShape,
  ctx: z.RefinementCtx,
  path: (string | number)[],
  complete: boolean,
) {
  const missing = (v: string | null | undefined) => (complete ? !v : v === null);
  if (c.methods && !c.methods.includes("mest")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "methods"],
      message: "Requests through MEST is always on",
    });
  }
  if (c.shareWithMembers) {
    if (c.shareWithMembers.includes("mest")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "shareWithMembers"],
        message: "Requests through MEST is not a contact detail",
      });
    } else if (c.methods && c.shareWithMembers.some((m) => !c.methods!.includes(m))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "shareWithMembers"],
        message: "Only share methods you have turned on",
      });
    }
  }
  if (c.methods?.includes("phone") && missing(c.phone)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "phone"], message: "Add the phone number to share" });
  }
  if (c.methods?.includes("booking") && missing(c.bookingUrl)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "bookingUrl"],
      message: "Add the scheduling link to share",
    });
  }
}
