/**
 * The onboarding form model: the values the screens edit, how they become the
 * payload `POST /api/me/onboarding` accepts, and how the shared schemas'
 * issues map back onto the field that shows them.
 *
 * The screens never re-state a rule. Every check (lengths, counts, the
 * mission statement, the contact rules) comes from
 * shared/schemas/onboarding.ts; this file only filters the issues down to the
 * fields of the step on screen and rewrites zod's default wording into plain
 * English.
 */

import type { ZodIssue } from "zod";
import {
  professionalOnboardingSchema,
  studentOnboardingSchema,
  type Onboarding,
} from "@shared/schemas/onboarding";
import type { AudienceId, ContactMethodId, ParticipationId } from "@shared/taxonomy";
import type { MeetingMode, MentoringFormat, ProfileKind } from "@shared/types/common";
import type { OwnProfile } from "@shared/types/me";

/* ------------------------------------------------------------------ values */

export interface EducationValues {
  degree: string;
  field: string;
  school: string;
  /** Typed as text; converted to a number for the payload. */
  year: string;
}

export interface MentorshipValues {
  topics: string[];
  audience: AudienceId[];
  format: MentoringFormat;
  mode: MeetingMode;
  availabilityText: string;
  durationMin: "30" | "45" | "60";
  maxActive: string;
}

export interface ContactValues {
  methods: ContactMethodId[];
  shareWithMembers: ContactMethodId[];
  contactEmail: string;
  phone: string;
  bookingUrl: string;
}

/** Everything both paths edit. The payload keeps only what the chosen kind uses. */
export interface OnboardingValues {
  kind: ProfileKind | "";
  acceptMission: boolean;
  // Step 2, both kinds
  firstName: string;
  lastName: string;
  credentials: string;
  location: string;
  region: string;
  bio: string;
  linkedinUrl: string;
  websiteUrl: string;
  /** Students and professionals both list interests. */
  interests: string[];
  // Step 3b, students
  program: string;
  level: AudienceId | "";
  institution: string;
  goals: string;
  topicsNeeded: string[];
  // Step 3a, professionals
  title: string;
  organization: string;
  disciplineId: string;
  yearsExperience: string;
  expertise: string[];
  education: EducationValues[];
  participation: ParticipationId[];
  // Step 4, professionals
  mentorship: MentorshipValues;
  visibility: "public" | "members";
  contact: ContactValues;
}

/** The one region the network serves today (02 section 4.3; regions arrive in Phase 4). */
export const DEFAULT_REGION = "greater-new-orleans";

export function defaultValues(kind: ProfileKind | "" = ""): OnboardingValues {
  return {
    kind,
    acceptMission: false,
    firstName: "",
    lastName: "",
    credentials: "",
    location: "",
    region: DEFAULT_REGION,
    bio: "",
    linkedinUrl: "",
    websiteUrl: "",
    interests: [],
    program: "",
    level: "",
    institution: "",
    goals: "",
    topicsNeeded: [],
    title: "",
    organization: "",
    disciplineId: "",
    yearsExperience: "",
    expertise: [],
    education: [],
    participation: ["directory", "networking"],
    mentorship: {
      topics: [],
      audience: [],
      format: "either",
      mode: "either",
      availabilityText: "",
      durationMin: "45",
      // Filled from `config.default_max_active` once the public config
      // arrives (the wizard does it); left empty, the server applies it.
      maxActive: "",
    },
    visibility: "public",
    // Phone and every other method start off; Requests through MEST is always on.
    contact: { methods: ["mest"], shareWithMembers: [], contactEmail: "", phone: "", bookingUrl: "" },
  };
}

/**
 * Values for a professional whose submission was declined and who is
 * submitting again: what they sent last time, so they change only what the
 * administrator asked about.
 */
export function valuesFromProfile(profile: OwnProfile): OnboardingValues {
  const base = defaultValues(profile.kind ?? "");
  const pro = profile.professional;
  const mentorship = profile.settings.mentorship;
  const contact = profile.settings.contact;
  return {
    ...base,
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    credentials: profile.credentials ?? "",
    location: profile.location ?? "",
    region: profile.region || DEFAULT_REGION,
    bio: profile.bio ?? "",
    linkedinUrl: profile.linkedinUrl ?? "",
    websiteUrl: profile.websiteUrl ?? "",
    interests: pro?.interests ?? profile.student?.interests ?? [],
    title: pro?.title ?? "",
    organization: pro?.organization ?? "",
    disciplineId: pro?.disciplineId ?? "",
    yearsExperience: pro ? String(pro.yearsExperience) : "",
    expertise: pro?.expertise.filter((t) => t.status !== "rejected").map((t) => t.label) ?? [],
    education: profile.education.map((e) => ({ degree: e.degree, field: e.field, school: e.school, year: String(e.year) })),
    participation: pro?.participation ?? base.participation,
    mentorship:
      mentorship && pro?.participation.includes("mentoring")
        ? {
            topics: mentorship.topics,
            audience: mentorship.audience,
            format: mentorship.format,
            mode: mentorship.mode,
            availabilityText: mentorship.availability ?? "",
            durationMin: String(mentorship.durationMin) as MentorshipValues["durationMin"],
            maxActive: String(mentorship.maxActive),
          }
        : base.mentorship,
    visibility: profile.visibility === "members" ? "members" : "public",
    contact: contact
      ? {
          methods: contact.methods,
          shareWithMembers: contact.shareWithMembers,
          contactEmail: contact.contactEmail ?? "",
          phone: contact.phone ?? "",
          bookingUrl: contact.bookingUrl ?? "",
        }
      : base.contact,
  };
}

/* ----------------------------------------------------------------- payload */

/** "" stays undefined (the schema then says it is required); anything else is read as a number. */
function toNumber(s: string): number | undefined {
  const trimmed = s.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

/** The body of `POST /api/me/onboarding` for the chosen kind, before validation. */
export function toPayload(values: OnboardingValues): Record<string, unknown> {
  const basics = {
    acceptMission: values.acceptMission,
    firstName: values.firstName,
    lastName: values.lastName,
    credentials: values.credentials,
    location: values.location,
    region: values.region || DEFAULT_REGION,
    bio: values.bio,
    linkedinUrl: values.linkedinUrl,
    websiteUrl: values.websiteUrl,
    interests: values.interests,
  };
  if (values.kind === "student") {
    return {
      kind: "student",
      ...basics,
      program: values.program,
      level: values.level || undefined,
      institution: values.institution,
      goals: values.goals,
      topicsNeeded: values.topicsNeeded,
    };
  }
  const mentoring = values.participation.includes("mentoring");
  const methods: ContactMethodId[] = ["mest", ...values.contact.methods.filter((m) => m !== "mest")];
  const uses = (m: ContactMethodId) => methods.includes(m);
  const m = values.mentorship;
  return {
    kind: "professional",
    ...basics,
    title: values.title,
    organization: values.organization,
    disciplineId: values.disciplineId,
    yearsExperience: toNumber(values.yearsExperience),
    expertise: values.expertise,
    education: values.education.map((e) => ({ ...e, year: toNumber(e.year) })),
    participation: values.participation,
    mentorship: mentoring
      ? {
          topics: m.topics,
          audience: m.audience,
          format: m.format,
          mode: m.mode,
          availabilityText: m.availabilityText,
          durationMin: Number(m.durationMin),
          maxActive: toNumber(m.maxActive),
        }
      : undefined,
    visibility: values.visibility,
    contact: {
      methods,
      shareWithMembers: values.contact.shareWithMembers.filter((s) => s !== "mest" && uses(s)),
      // A value is kept only for a method the person turned on.
      contactEmail: uses("email") ? values.contact.contactEmail : "",
      phone: uses("phone") ? values.contact.phone : "",
      bookingUrl: uses("booking") ? values.contact.bookingUrl : "",
    },
  };
}

/* ------------------------------------------------------------------- steps */

export type StepId =
  | "who"
  | "basics"
  | "studies"
  | "work"
  | "participation"
  | "mentorship"
  | "visibility"
  | "contact"
  | "review";

export const stepLabels: Record<StepId, string> = {
  who: "Who you are",
  basics: "Basics",
  studies: "Your studies",
  work: "Your work",
  participation: "Taking part",
  mentorship: "Mentorship",
  visibility: "Visibility",
  contact: "Contact",
  review: "Review",
};

/** The steps for the values on screen: the mentorship step only when mentoring is chosen. */
export function stepsFor(values: Pick<OnboardingValues, "kind" | "participation">): StepId[] {
  if (values.kind === "student") return ["who", "basics", "studies", "review"];
  if (values.kind === "professional") {
    const mentoring = values.participation.includes("mentoring");
    return ["who", "basics", "work", "participation", ...(mentoring ? (["mentorship"] as const) : []), "visibility", "contact", "review"];
  }
  // Before a path is chosen: the shorter outline.
  return ["who", "basics", "studies", "review"];
}

/** The field names (prefixes) each step owns. The review step owns everything. */
function stepFields(step: StepId, values: OnboardingValues): string[] | null {
  switch (step) {
    case "who":
      return ["kind", "acceptMission"];
    case "basics":
      return ["firstName", "lastName", "credentials", "location", "region", "bio", "linkedinUrl", "websiteUrl"];
    case "studies":
      return ["program", "level", "institution", "goals", "interests", "topicsNeeded"];
    case "work":
      return ["title", "organization", "disciplineId", "yearsExperience", "expertise", "interests", "education"];
    case "participation":
      return ["participation"];
    case "mentorship":
      return ["mentorship"];
    case "visibility":
      return ["visibility"];
    case "contact":
      // The LinkedIn link is asked for again here when LinkedIn is chosen.
      return values.contact.methods.includes("linkedin") ? ["contact", "linkedinUrl"] : ["contact"];
    case "review":
      return null;
  }
}

/* ------------------------------------------------------------------ issues */

/** One problem, keyed by the field that shows it (`education.0.year`, `contact.phone`). */
export interface FieldIssue {
  name: string;
  message: string;
}

const LIST_FIELDS = new Set(["expertise", "interests", "topicsNeeded", "participation"]);

/** The field a zod issue belongs to. */
function fieldName(path: (string | number)[]): string {
  const [head, second, third] = path;
  if (head === undefined) return "form";
  if (head === "education" && typeof second === "number" && typeof third === "string") return `education.${second}.${third}`;
  if ((head === "mentorship" || head === "contact") && typeof second === "string") return `${head}.${second}`;
  return String(head);
}

/** zod's built-in wording, which the shared schemas leave in place for type and range checks. */
const ZOD_DEFAULT = /^(Required|Expected |Invalid enum value|Invalid literal value|Invalid input|Number must be|String must contain)/;

function plainMessage(issue: ZodIssue, name: string): string {
  if (!ZOD_DEFAULT.test(issue.message)) return issue.message;
  switch (issue.code) {
    case "invalid_type":
      if (issue.received === "nan") return "Enter a whole number";
      return isChoice(name) ? "Choose one" : "Required";
    case "invalid_enum_value":
    case "invalid_literal":
    case "invalid_union":
      return "Choose one";
    case "too_small":
      if (issue.type === "number") return `Use ${issue.minimum} or more`;
      return isChoice(name) ? "Choose one" : "Required";
    case "too_big":
      if (issue.type === "number") return `Use ${issue.maximum} or less`;
      return issue.message;
    case "invalid_string":
      return "Check the format";
    default:
      return issue.message;
  }
}

function isChoice(name: string): boolean {
  return name === "kind" || name === "level" || name === "disciplineId" || name.startsWith("mentorship.") || name === "visibility";
}

/**
 * Checks the values with the shared schema for their kind. Issues about one
 * item of a tag list name the item, so "Use at most 40 characters" says which
 * tag is too long.
 */
export function validate(values: OnboardingValues): { issues: FieldIssue[]; payload: Onboarding | null } {
  if (values.kind !== "student" && values.kind !== "professional") {
    const issues: FieldIssue[] = [{ name: "kind", message: "Choose student or professional" }];
    if (!values.acceptMission) issues.push({ name: "acceptMission", message: "Confirm the mission statement to continue" });
    return { issues, payload: null };
  }
  const schema = values.kind === "student" ? studentOnboardingSchema : professionalOnboardingSchema;
  const result = schema.safeParse(toPayload(values));
  if (result.success) return { issues: [], payload: result.data };

  const seen = new Set<string>();
  const issues: FieldIssue[] = [];
  for (const issue of result.error.issues) {
    const name = fieldName(issue.path);
    let message = plainMessage(issue, name);
    const index = issue.path[1];
    if (LIST_FIELDS.has(name) && typeof index === "number") {
      const list = values[name as "expertise" | "interests"] as string[] | undefined;
      const item = list?.[index];
      if (item) message = `"${item}": ${message}`;
    }
    const key = `${name}\u0000${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ name, message });
  }
  return { issues, payload: null };
}

function owns(prefixes: string[], name: string): boolean {
  return prefixes.some((p) => name === p || name.startsWith(`${p}.`));
}

/** The issues the given step shows. */
export function issuesForStep(step: StepId, values: OnboardingValues): FieldIssue[] {
  const { issues } = validate(values);
  const fields = stepFields(step, values);
  return fields ? issues.filter((i) => owns(fields, i.name)) : issues;
}

/** The first step (in the order on screen) that shows one of these issues. */
export function firstStepWith(issues: FieldIssue[], values: OnboardingValues): StepId | null {
  for (const step of stepsFor(values)) {
    const fields = stepFields(step, values);
    if (fields && issues.some((i) => owns(fields, i.name))) return step;
  }
  return null;
}

/** Turns the server's validation issues (zod paths) into field issues. */
export function fromServerIssues(issues: { path: (string | number)[]; message: string }[]): FieldIssue[] {
  return issues.map((i) => ({ name: fieldName(i.path), message: i.message }));
}

/* ------------------------------------------------------------------ labels */

const LABELS: Record<string, string> = {
  form: "Your profile",
  kind: "Who you are",
  acceptMission: "Mission statement",
  firstName: "First name",
  lastName: "Last name",
  credentials: "Credentials",
  location: "General location",
  region: "Region",
  bio: "Short biography",
  linkedinUrl: "LinkedIn link",
  websiteUrl: "Website",
  interests: "Interests",
  program: "Program",
  level: "Where you are",
  institution: "School or institution",
  goals: "What you are working toward",
  topicsNeeded: "Topics you want help with",
  title: "Job title",
  organization: "Company or institution",
  disciplineId: "Discipline",
  yearsExperience: "Years of experience",
  expertise: "Areas of expertise",
  education: "Education",
  participation: "Taking part",
  mentorship: "Mentorship offer",
  "mentorship.topics": "Topics you will talk about",
  "mentorship.audience": "Who you would like to help",
  "mentorship.format": "Format",
  "mentorship.mode": "Where",
  "mentorship.availabilityText": "General availability",
  "mentorship.durationMin": "Usual meeting length",
  "mentorship.maxActive": "Active mentees at once",
  visibility: "Directory visibility",
  contact: "Contact",
  "contact.methods": "Methods I use",
  "contact.shareWithMembers": "Show to signed-in members",
  "contact.contactEmail": "Email to share",
  "contact.phone": "Phone number",
  "contact.bookingUrl": "Scheduling link",
};

const EDUCATION_LABELS: Record<string, string> = { degree: "degree", field: "field", school: "school", year: "year" };

export function labelFor(name: string): string {
  const education = /^education\.(\d+)\.(\w+)$/.exec(name);
  if (education) return `Education ${Number(education[1]) + 1}, ${EDUCATION_LABELS[education[2]] ?? education[2]}`;
  return LABELS[name] ?? name;
}

/** The id of the control that shows a field, so error links can move focus to it. */
export function fieldId(name: string): string {
  return `onb-${(FIELD_ALIASES[name] ?? name).replace(/\./g, "-")}`;
}

/** Fields shown by another field's control: the contact table holds both columns. */
const FIELD_ALIASES: Record<string, string> = {
  contact: "contact.methods",
  "contact.shareWithMembers": "contact.methods",
  mentorship: "mentorship.topics",
};
