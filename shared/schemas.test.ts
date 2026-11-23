import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { configLimits, limits } from "./limits";
import {
  audiences,
  contactMethods,
  experienceBandFor,
  mentorshipTopics,
  participationOptions,
  topicById,
} from "./taxonomy";
import { charCount, pageQuerySchema, phoneSchema } from "./schemas/common";
import {
  onboardingSchema,
  professionalOnboardingSchema,
  studentOnboardingSchema,
} from "./schemas/onboarding";
import { profilePatchSchema } from "./schemas/profile";
import { settingsPatchSchema } from "./schemas/settings";
import { createRequestSchema, reportSchema, respondSchema } from "./schemas/request";
import {
  adminResolveReportSchema,
  adminReviewSchema,
  adminVerifiedSchema,
  adminVocabularySchema,
  configPatchSchema,
} from "./schemas/admin";

/* ------------------------------------------------------------------ helpers */

const str = (n: number, ch = "a") => ch.repeat(n);
const list = <T,>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));
const tags = (n: number) => list(n, (i) => `Tag number ${i + 1}`);
const year = new Date().getFullYear();

function ok(schema: z.ZodTypeAny, value: unknown) {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`expected accept, got ${JSON.stringify(r.error.issues)}`);
  return r.data;
}

/** Rejects, and an issue points at `path`, so a different rule cannot be what failed. */
function bad(schema: z.ZodTypeAny, value: unknown, path: (string | number)[]) {
  const r = schema.safeParse(value);
  expect(r.success, `expected reject at "${path.join(".")}"`).toBe(false);
  if (!r.success) {
    const paths = r.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain(path.join("."));
  }
}

const docs = readFileSync(
  new URL("../docs/professional-network/02-technical-architecture.md", import.meta.url),
  "utf8",
);

const student = {
  kind: "student",
  acceptMission: true,
  firstName: "Amina",
  lastName: "Yusuf",
  location: "New Orleans, LA",
  program: "BS Civil Engineering, junior",
  level: "undergrad",
  institution: "Tulane University",
  goals: "Find an internship in coastal engineering this summer.",
  topicsNeeded: ["internships-and-first-jobs"],
};

const mentorship = {
  topics: ["professional-licensure"],
  audience: ["undergrad"],
  format: "either",
  mode: "online",
  availabilityText: "Weekday evenings",
  durationMin: 30,
  maxActive: 3,
};

const professional = {
  kind: "professional",
  acceptMission: true,
  firstName: "Layla",
  lastName: "Haddad",
  credentials: "PE",
  location: "Metairie, LA",
  bio: str(120, "b"),
  linkedinUrl: "https://www.linkedin.com/in/layla",
  websiteUrl: "https://layla.example.org",
  title: "Senior Coastal Engineer",
  organization: "Gulf Coast Engineering",
  disciplineId: "coastal",
  yearsExperience: 14,
  expertise: ["Hydraulic modeling", "Levee design"],
  interests: ["Wetland restoration"],
  education: [{ degree: "MS", field: "Civil Engineering", school: "LSU", year: 2010 }],
  participation: ["directory", "networking", "mentoring"],
  mentorship,
  visibility: "public",
  contact: {
    methods: ["mest", "email", "linkedin"],
    shareWithMembers: ["linkedin"],
  },
};

const request = {
  mentorId: "6f1c1f9e-6b1e-4b6a-9c11-2f1c0a1d2e3f",
  kind: "mentorship",
  topicId: "professional-licensure",
  why: str(30, "w"),
  format: "one-time",
  mode: "online",
};

/* --------------------------------------------------- limits match the spec */

describe("limits", () => {
  it("limits_match_the_architecture_doc_table", () => {
    const section = docs.slice(docs.indexOf("#### Limits"), docs.indexOf("#### users"));
    const rows = [...section.matchAll(/^\| `(\w+)` \| (\d+)\.\.(\d+)/gm)];
    expect(rows.length).toBe(20);
    for (const [, key, min, max] of rows) {
      const entry = (limits as unknown as Record<string, { min: number; max: number }>)[key];
      expect(entry, key).toBeDefined();
      expect([entry.min, entry.max], key).toEqual([Number(min), Number(max)]);
    }
    expect(section).toContain(`each ${limits.expertise.tag.min}..${limits.expertise.tag.max} characters`);
  });

  it("config_limits_match_the_architecture_doc_table", () => {
    const section = docs.slice(docs.indexOf("#### config"), docs.indexOf("#### profiles"));
    for (const [key, range] of Object.entries(configLimits)) {
      if (!("min" in range)) continue;
      expect(section).toContain(`| \`${key}\` | ${range.default} | ${range.min}..${range.max} |`);
    }
    expect(section).toContain(`| \`reminder_days\` | \`[${configLimits.reminder_days.default.join(", ")}]\``);
  });

  it("char_count_counts_code_points_like_postgres", () => {
    expect(charCount("é🙂a")).toBe(3);
  });
});

/* ------------------------------------------------------------- taxonomy */

describe("taxonomy", () => {
  it("topics_have_unique_slug_ids_and_labels", () => {
    expect(mentorshipTopics).toHaveLength(12);
    const ids = mentorshipTopics.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of mentorshipTopics) expect(t.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(topicById("professional-licensure")?.label).toBe("Professional licensure (PE, FE)");
  });

  it("vocabularies_keep_the_prototype_ids", () => {
    expect(audiences.map((a) => a.id)).toEqual(["high-school", "undergrad", "grad", "early-career", "mid-career"]);
    expect(contactMethods.map((c) => c.id)).toEqual(["mest", "email", "linkedin", "booking", "phone"]);
    expect(participationOptions.map((p) => p.id)).toEqual([
      "directory",
      "networking",
      "mentoring",
      "volunteering",
      "speaking",
      "collaborating",
    ]);
  });

  it("experience_bands_follow_the_directory_view", () => {
    expect([0, 2, 3, 9, 10, 19, 20, 60].map(experienceBandFor)).toEqual([
      "0-2",
      "0-2",
      "3-9",
      "3-9",
      "10-19",
      "10-19",
      "20+",
      "20+",
    ]);
  });
});

/* ------------------------------------------------------------- common */

describe("common", () => {
  it("page_query_defaults_and_bounds", () => {
    expect(ok(pageQuerySchema, {})).toEqual({ page: 1, size: 20 });
    expect(ok(pageQuerySchema, { page: "2", size: "50" })).toEqual({ page: 2, size: 50 });
    bad(pageQuerySchema, { size: "51" }, ["size"]);
    bad(pageQuerySchema, { page: "0" }, ["page"]);
  });

  it("phone_normalizes_to_e164", () => {
    expect(ok(phoneSchema, "(504) 555-0100")).toBe("+15045550100");
    expect(ok(phoneSchema, "+44 20 7946 0958")).toBe("+442079460958");
    expect(phoneSchema.safeParse("555-0100").success).toBe(false);
    expect(phoneSchema.safeParse("call me").success).toBe(false);
  });
});

/* ------------------------------------------------------ student onboarding */

describe("studentOnboardingSchema", () => {
  const s = studentOnboardingSchema;
  it("accepts_a_complete_student", () => {
    expect(ok(s, student).firstName).toBe("Amina");
  });
  it("mission_must_be_accepted", () => {
    bad(s, { ...student, acceptMission: false }, ["acceptMission"]);
    bad(s, { ...student, acceptMission: undefined }, ["acceptMission"]);
  });
  it("name_1_to_60_trimmed", () => {
    ok(s, { ...student, firstName: str(60) });
    expect(ok(s, { ...student, firstName: "  Amina  " }).firstName).toBe("Amina");
    bad(s, { ...student, firstName: str(61) }, ["firstName"]);
    bad(s, { ...student, lastName: "   " }, ["lastName"]);
  });
  it("location_1_to_80", () => {
    ok(s, { ...student, location: str(80) });
    bad(s, { ...student, location: str(81) }, ["location"]);
    bad(s, { ...student, location: "" }, ["location"]);
  });
  it("bio_optional_for_students_but_120_to_1200_when_given", () => {
    expect(ok(s, { ...student, bio: "" }).bio).toBeUndefined();
    ok(s, { ...student, bio: str(1200) });
    bad(s, { ...student, bio: str(119) }, ["bio"]);
    bad(s, { ...student, bio: str(1201) }, ["bio"]);
  });
  it("program_and_institution_1_to_120", () => {
    ok(s, { ...student, program: str(120), institution: str(120) });
    bad(s, { ...student, program: str(121) }, ["program"]);
    bad(s, { ...student, institution: "" }, ["institution"]);
  });
  it("level_is_an_audience", () => {
    ok(s, { ...student, level: "high-school" });
    bad(s, { ...student, level: "senior" }, ["level"]);
  });
  it("goals_20_to_600", () => {
    ok(s, { ...student, goals: str(20) });
    ok(s, { ...student, goals: str(600) });
    bad(s, { ...student, goals: str(19) }, ["goals"]);
    bad(s, { ...student, goals: str(601) }, ["goals"]);
  });
  it("goals_counts_code_points_not_utf16_units", () => {
    // 10 emoji are 20 UTF-16 units but only 10 characters to Postgres.
    bad(s, { ...student, goals: "🙂".repeat(10) }, ["goals"]);
    ok(s, { ...student, goals: "🙂".repeat(20) });
  });
  it("interests_0_to_10", () => {
    ok(s, { ...student, interests: list(10, (i) => `Interest ${i}`) });
    bad(s, { ...student, interests: list(11, (i) => `Interest ${i}`) }, ["interests"]);
    bad(s, { ...student, interests: [str(41)] }, ["interests", 0]);
  });
  it("topics_needed_1_to_5_unique_slugs", () => {
    ok(s, { ...student, topicsNeeded: list(5, (i) => `topic-${i}`) });
    bad(s, { ...student, topicsNeeded: [] }, ["topicsNeeded"]);
    bad(s, { ...student, topicsNeeded: list(6, (i) => `topic-${i}`) }, ["topicsNeeded"]);
    bad(s, { ...student, topicsNeeded: ["a-topic", "a-topic"] }, ["topicsNeeded"]);
    bad(s, { ...student, topicsNeeded: ["Not A Slug"] }, ["topicsNeeded", 0]);
  });
  it("credentials_0_to_20", () => {
    expect(ok(s, { ...student, credentials: "" }).credentials).toBeUndefined();
    ok(s, { ...student, credentials: str(20) });
    bad(s, { ...student, credentials: str(21) }, ["credentials"]);
  });
});

/* ------------------------------------------------- professional onboarding */

describe("professionalOnboardingSchema", () => {
  const s = professionalOnboardingSchema;
  it("accepts_a_complete_professional", () => {
    ok(s, professional);
  });
  it("mission_must_be_accepted", () => {
    bad(s, { ...professional, acceptMission: false }, ["acceptMission"]);
  });
  it("bio_required_120_to_1200", () => {
    ok(s, { ...professional, bio: str(1200) });
    bad(s, { ...professional, bio: str(119) }, ["bio"]);
    bad(s, { ...professional, bio: str(1201) }, ["bio"]);
    bad(s, { ...professional, bio: undefined }, ["bio"]);
  });
  it("title_and_organization_1_to_120", () => {
    ok(s, { ...professional, title: str(120), organization: "Self-employed" });
    bad(s, { ...professional, title: str(121) }, ["title"]);
    bad(s, { ...professional, organization: "" }, ["organization"]);
    bad(s, { ...professional, organization: str(121) }, ["organization"]);
  });
  it("discipline_is_a_slug", () => {
    bad(s, { ...professional, disciplineId: "Coastal Engineering" }, ["disciplineId"]);
  });
  it("years_experience_0_to_60_integer", () => {
    ok(s, { ...professional, yearsExperience: 0 });
    ok(s, { ...professional, yearsExperience: 60 });
    bad(s, { ...professional, yearsExperience: 61 }, ["yearsExperience"]);
    bad(s, { ...professional, yearsExperience: -1 }, ["yearsExperience"]);
    bad(s, { ...professional, yearsExperience: 2.5 }, ["yearsExperience"]);
  });
  it("expertise_2_to_12_tags_of_2_to_40_unique", () => {
    ok(s, { ...professional, expertise: tags(12) });
    bad(s, { ...professional, expertise: tags(1) }, ["expertise"]);
    bad(s, { ...professional, expertise: tags(13) }, ["expertise"]);
    ok(s, { ...professional, expertise: ["AI", str(40)] });
    bad(s, { ...professional, expertise: ["A", "Levee design"] }, ["expertise", 0]);
    bad(s, { ...professional, expertise: [str(41), "Levee design"] }, ["expertise", 0]);
    bad(s, { ...professional, expertise: ["Levee design", "levee DESIGN"] }, ["expertise"]);
  });
  it("education_0_to_6_with_sane_years", () => {
    const e = professional.education[0];
    ok(s, { ...professional, education: list(6, () => e) });
    bad(s, { ...professional, education: list(7, () => e) }, ["education"]);
    ok(s, { ...professional, education: [{ ...e, year: year + 8 }] });
    bad(s, { ...professional, education: [{ ...e, year: year + 9 }] }, ["education", 0, "year"]);
    bad(s, { ...professional, education: [{ ...e, year: 1949 }] }, ["education", 0, "year"]);
    bad(s, { ...professional, education: [{ ...e, school: "" }] }, ["education", 0, "school"]);
  });
  it("participation_is_unique_known_values", () => {
    ok(s, { ...professional, participation: ["directory"], mentorship: undefined });
    bad(s, { ...professional, participation: ["directory", "directory"] }, ["participation"]);
    bad(s, { ...professional, participation: ["dancing"] }, ["participation", 0]);
  });
  it("mentorship_required_when_mentoring_chosen", () => {
    bad(s, { ...professional, mentorship: undefined }, ["mentorship"]);
  });
  it("mentorship_rejected_when_mentoring_not_chosen", () => {
    bad(s, { ...professional, participation: ["directory"] }, ["mentorship"]);
  });
  it("mentorship_needs_a_topic_and_an_audience", () => {
    bad(s, { ...professional, mentorship: { ...mentorship, topics: [] } }, ["mentorship", "topics"]);
    bad(s, { ...professional, mentorship: { ...mentorship, audience: [] } }, ["mentorship", "audience"]);
  });
  it("mentorship_availability_0_to_160", () => {
    ok(s, { ...professional, mentorship: { ...mentorship, availabilityText: str(160) } });
    bad(s, { ...professional, mentorship: { ...mentorship, availabilityText: str(161) } }, [
      "mentorship",
      "availabilityText",
    ]);
  });
  it("mentorship_max_active_1_to_10", () => {
    ok(s, { ...professional, mentorship: { ...mentorship, maxActive: 10 } });
    ok(s, { ...professional, mentorship: { ...mentorship, maxActive: undefined } });
    bad(s, { ...professional, mentorship: { ...mentorship, maxActive: 0 } }, ["mentorship", "maxActive"]);
    bad(s, { ...professional, mentorship: { ...mentorship, maxActive: 11 } }, ["mentorship", "maxActive"]);
  });
  it("mentorship_duration_is_30_45_or_60", () => {
    ok(s, { ...professional, mentorship: { ...mentorship, durationMin: 60 } });
    bad(s, { ...professional, mentorship: { ...mentorship, durationMin: 50 } }, ["mentorship", "durationMin"]);
  });
  it("visibility_public_or_members_and_defaults_public", () => {
    expect(ok(s, { ...professional, visibility: undefined }).visibility).toBe("public");
    ok(s, { ...professional, visibility: "members" });
    bad(s, { ...professional, visibility: "hidden" }, ["visibility"]);
  });
  it("contact_methods_must_include_mest", () => {
    ok(s, { ...professional, contact: { methods: ["mest"], shareWithMembers: [] } });
    bad(s, { ...professional, contact: { methods: ["email"], shareWithMembers: [] } }, ["contact", "methods"]);
  });
  it("share_with_members_is_a_subset_of_methods_without_mest", () => {
    ok(s, { ...professional, contact: { methods: ["mest", "email"], shareWithMembers: ["email"] } });
    bad(s, { ...professional, contact: { methods: ["mest", "email"], shareWithMembers: ["mest"] } }, [
      "contact",
      "shareWithMembers",
    ]);
    bad(s, { ...professional, contact: { methods: ["mest", "email"], shareWithMembers: ["linkedin"] } }, [
      "contact",
      "shareWithMembers",
    ]);
  });
  it("methods_need_their_values", () => {
    bad(s, { ...professional, contact: { methods: ["mest", "phone"], shareWithMembers: [] } }, ["contact", "phone"]);
    ok(s, {
      ...professional,
      contact: { methods: ["mest", "phone"], shareWithMembers: [], phone: "504-555-0100" },
    });
    bad(s, { ...professional, contact: { methods: ["mest", "booking"], shareWithMembers: [] } }, [
      "contact",
      "bookingUrl",
    ]);
    bad(s, { ...professional, linkedinUrl: undefined }, ["linkedinUrl"]);
  });
  it("linkedin_url_must_be_on_linkedin", () => {
    ok(s, { ...professional, linkedinUrl: "https://linkedin.com/in/layla" });
    bad(s, { ...professional, linkedinUrl: "https://evil.example/linkedin.com" }, ["linkedinUrl"]);
    bad(s, { ...professional, linkedinUrl: "https://linkedin.com.evil.example/in/x" }, ["linkedinUrl"]);
    bad(s, { ...professional, linkedinUrl: "javascript:alert(1)//linkedin.com" }, ["linkedinUrl"]);
  });
  it("website_and_booking_must_be_https", () => {
    bad(s, { ...professional, websiteUrl: "http://layla.example.org" }, ["websiteUrl"]);
    ok(s, {
      ...professional,
      contact: { methods: ["mest", "booking"], shareWithMembers: [], bookingUrl: "https://cal.com/layla" },
    });
    bad(
      s,
      { ...professional, contact: { methods: ["mest", "booking"], shareWithMembers: [], bookingUrl: "http://x.org" } },
      ["contact", "bookingUrl"],
    );
  });
  it("contact_email_must_be_an_address", () => {
    ok(s, { ...professional, contact: { ...professional.contact, contactEmail: "layla@example.org" } });
    bad(s, { ...professional, contact: { ...professional.contact, contactEmail: "layla" } }, [
      "contact",
      "contactEmail",
    ]);
  });
});

describe("onboardingSchema", () => {
  it("dispatches_on_kind_and_keeps_professional_rules", () => {
    expect(ok(onboardingSchema, student).kind).toBe("student");
    expect(ok(onboardingSchema, professional).kind).toBe("professional");
    bad(onboardingSchema, { ...professional, mentorship: undefined }, ["mentorship"]);
    bad(onboardingSchema, { ...student, kind: "admin" }, ["kind"]);
  });
});

/* ---------------------------------------------------------- profile patch */

describe("profilePatchSchema", () => {
  const s = profilePatchSchema;
  it("accepts_partial_updates", () => {
    expect(ok(s, { title: "Principal Engineer" })).toEqual({ title: "Principal Engineer" });
  });
  it("rejects_an_empty_patch", () => {
    bad(s, {}, []);
  });
  it("rejects_protected_columns", () => {
    for (const key of ["approvalState", "kind", "verified", "adminHiddenAt", "missionAcceptedAt", "anonymizedAt"]) {
      bad(s, { title: "x", [key]: "approved" }, []);
    }
  });
  it("applies_the_same_limits", () => {
    bad(s, { firstName: str(61) }, ["firstName"]);
    bad(s, { bio: str(119) }, ["bio"]);
    bad(s, { expertise: tags(13) }, ["expertise"]);
    bad(s, { goals: str(19) }, ["goals"]);
    bad(s, { topicsNeeded: [] }, ["topicsNeeded"]);
    bad(s, { yearsExperience: 61 }, ["yearsExperience"]);
  });
  it("clears_optional_fields_with_empty_or_null", () => {
    expect(ok(s, { credentials: "", websiteUrl: null, linkedinUrl: "" })).toEqual({
      credentials: null,
      websiteUrl: null,
      linkedinUrl: null,
    });
    expect(ok(s, { bio: "" })).toEqual({ bio: null });
  });
});

/* --------------------------------------------------------- settings patch */

describe("settingsPatchSchema", () => {
  const s = settingsPatchSchema;
  it("accepts_each_section_alone", () => {
    ok(s, { visibility: "hidden" });
    ok(s, { contact: { shareWithMembers: ["email"] } });
    ok(s, { mentorship: { maxActive: 5 } });
    ok(s, { notifications: { requests: false, productUpdates: true } });
  });
  it("rejects_an_empty_patch_and_unknown_keys", () => {
    bad(s, {}, []);
    bad(s, { approvalState: "approved" }, []);
    bad(s, { mentorship: { previousStatus: "active" } }, ["mentorship"]);
  });
  it("visibility_allows_hidden_here", () => {
    bad(s, { visibility: "secret" }, ["visibility"]);
  });
  it("contact_rules_hold_in_a_patch", () => {
    bad(s, { contact: { methods: ["email"] } }, ["contact", "methods"]);
    bad(s, { contact: { shareWithMembers: ["mest"] } }, ["contact", "shareWithMembers"]);
    bad(s, { contact: { methods: ["mest", "email"], shareWithMembers: ["phone"] } }, ["contact", "shareWithMembers"]);
    bad(s, { contact: { methods: ["mest", "phone"], phone: null } }, ["contact", "phone"]);
    ok(s, { contact: { methods: ["mest", "phone"], phone: "+15045550100", shareWithMembers: [] } });
  });
  it("mentorship_limits_hold_in_a_patch", () => {
    ok(s, { mentorship: { maxActive: 1 } });
    bad(s, { mentorship: { maxActive: 11 } }, ["mentorship", "maxActive"]);
    bad(s, { mentorship: { availabilityText: str(161) } }, ["mentorship", "availabilityText"]);
    bad(s, { mentorship: { topics: [] } }, ["mentorship", "topics"]);
    bad(s, { mentorship: { audience: [] } }, ["mentorship", "audience"]);
  });
  it("resume_on_only_with_paused_and_a_real_date", () => {
    ok(s, { mentorship: { status: "paused", resumeOn: "2027-01-15" } });
    ok(s, { mentorship: { status: "paused" } });
    bad(s, { mentorship: { status: "active", resumeOn: "2027-01-15" } }, ["mentorship", "resumeOn"]);
    bad(s, { mentorship: { status: "paused", resumeOn: "2027-02-30" } }, ["mentorship", "resumeOn"]);
    bad(s, { mentorship: { status: "sleeping" } }, ["mentorship", "status"]);
  });
});

/* --------------------------------------------------------------- requests */

describe("createRequestSchema", () => {
  const s = createRequestSchema;
  it("accepts_a_mentorship_request", () => {
    ok(s, request);
  });
  it("accepts_an_introduction_without_topic", () => {
    ok(s, { ...request, kind: "introduction", topicId: undefined });
  });
  it("topic_required_for_mentorship_and_absent_for_introduction", () => {
    bad(s, { ...request, topicId: undefined }, ["topicId"]);
    bad(s, { ...request, kind: "introduction" }, ["topicId"]);
  });
  it("introduction_is_one_time", () => {
    bad(s, { ...request, kind: "introduction", topicId: undefined, format: "recurring" }, ["format"]);
  });
  it("mentor_id_is_a_uuid", () => {
    bad(s, { ...request, mentorId: "layla" }, ["mentorId"]);
  });
  it("why_30_to_800", () => {
    ok(s, { ...request, why: str(800) });
    bad(s, { ...request, why: str(29) }, ["why"]);
    bad(s, { ...request, why: str(801) }, ["why"]);
  });
  it("goals_0_to_400", () => {
    ok(s, { ...request, goals: "" });
    ok(s, { ...request, goals: str(400) });
    bad(s, { ...request, goals: str(401) }, ["goals"]);
  });
  it("scheduling_note_0_to_200", () => {
    ok(s, { ...request, schedulingNote: str(200) });
    bad(s, { ...request, schedulingNote: str(201) }, ["schedulingNote"]);
  });
  it("format_and_mode_enums", () => {
    bad(s, { ...request, format: "either" }, ["format"]);
    ok(s, { ...request, mode: "either" });
    bad(s, { ...request, mode: "phone" }, ["mode"]);
  });
});

describe("respondSchema", () => {
  const s = respondSchema;
  it("accept_shares_at_least_one_method_without_mest", () => {
    ok(s, { decision: "accept", shareMethods: ["email"], note: str(600) });
    bad(s, { decision: "accept", shareMethods: [] }, ["shareMethods"]);
    bad(s, { decision: "accept", shareMethods: ["mest"] }, ["shareMethods", 0]);
    bad(s, { decision: "accept", shareMethods: ["email", "email"] }, ["shareMethods"]);
  });
  it("note_0_to_600", () => {
    bad(s, { decision: "accept", shareMethods: ["email"], note: str(601) }, ["note"]);
  });
  it("decline_requires_a_reason_and_no_methods", () => {
    ok(s, { decision: "decline", declineReason: "no_capacity" });
    bad(s, { decision: "decline" }, ["declineReason"]);
    bad(s, { decision: "decline", declineReason: "member_left" }, ["declineReason"]);
    bad(s, { decision: "decline", declineReason: "other", shareMethods: ["email"] }, []);
  });
  it("unknown_decision_rejected", () => {
    bad(s, { decision: "maybe" }, ["decision"]);
  });
});

describe("reportSchema", () => {
  it("reason_enum_and_detail_0_to_1000", () => {
    ok(reportSchema, { reason: "spam" });
    ok(reportSchema, { reason: "other", detail: str(1000) });
    bad(reportSchema, { reason: "rude" }, ["reason"]);
    bad(reportSchema, { reason: "other", detail: str(1001) }, ["detail"]);
  });
});

/* ------------------------------------------------------------------ admin */

describe("adminReviewSchema", () => {
  it("approve_with_optional_notes", () => {
    ok(adminReviewSchema, { decision: "approved" });
    ok(adminReviewSchema, { decision: "approved", notes: str(1000) });
    bad(adminReviewSchema, { decision: "approved", notes: str(1001) }, ["notes"]);
  });
  it("decline_requires_notes", () => {
    ok(adminReviewSchema, { decision: "declined", notes: "Please add your organization." });
    bad(adminReviewSchema, { decision: "declined" }, ["notes"]);
    bad(adminReviewSchema, { decision: "declined", notes: "   " }, ["notes"]);
  });
  it("unknown_decision_rejected", () => {
    bad(adminReviewSchema, { decision: "pending" }, ["decision"]);
  });
});

describe("admin action schemas", () => {
  it("verified_method_or_null", () => {
    ok(adminVerifiedSchema, { method: "linkedin" });
    ok(adminVerifiedSchema, { method: null });
    bad(adminVerifiedSchema, { method: "vibes" }, ["method"]);
  });
  it("vocabulary_kind_slug_and_label", () => {
    ok(adminVocabularySchema, { kind: "topic", id: "careers-in-government", label: "Careers in government" });
    bad(adminVocabularySchema, { kind: "tag", id: "x", label: "X" }, ["kind"]);
    bad(adminVocabularySchema, { kind: "discipline", id: "Bad Id", label: "Bad" }, ["id"]);
  });
  it("resolve_report_status_and_action", () => {
    ok(adminResolveReportSchema, { status: "resolved", action: "hide_profile", note: "Hidden." });
    ok(adminResolveReportSchema, { status: "dismissed" });
    bad(adminResolveReportSchema, { status: "open" }, ["status"]);
    bad(adminResolveReportSchema, { status: "dismissed", action: "hide_profile" }, ["action"]);
  });
});

describe("configPatchSchema", () => {
  const s = configPatchSchema;
  it("each_numeric_key_accepts_its_bounds_and_rejects_beyond", () => {
    let checked = 0;
    for (const [key, r] of Object.entries(configLimits)) {
      if (!("min" in r)) continue;
      ok(s, { [key]: r.min });
      ok(s, { [key]: r.max });
      bad(s, { [key]: r.min - 1 }, [key]);
      bad(s, { [key]: r.max + 1 }, [key]);
      bad(s, { [key]: r.min + 0.5 }, [key]);
      checked++;
    }
    expect(checked).toBe(7);
  });
  it("platform_paused_is_boolean", () => {
    ok(s, { platform_paused: true });
    bad(s, { platform_paused: "yes" }, ["platform_paused"]);
  });
  it("reminder_days_ascending_and_below_expiry", () => {
    ok(s, { reminder_days: [5, 10] });
    ok(s, { reminder_days: [] });
    bad(s, { reminder_days: [10, 5] }, ["reminder_days"]);
    bad(s, { reminder_days: [5, 5] }, ["reminder_days"]);
    bad(s, { reminder_days: [0] }, ["reminder_days", 0]);
    bad(s, { reminder_days: [5, 14], request_expiry_days: 14 }, ["reminder_days"]);
    ok(s, { reminder_days: [5, 13], request_expiry_days: 14 });
    bad(s, { reminder_days: [60] }, ["reminder_days"]);
    // reminders_sent counts to 2, so a third day could never be sent.
    bad(s, { reminder_days: [3, 6, 9] }, ["reminder_days"]);
  });
  it("rejects_unknown_keys_and_empty_patch", () => {
    bad(s, {}, []);
    bad(s, { schema_version: 3 }, []);
  });
});
