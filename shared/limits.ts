/**
 * Every length and count limit in the network, in one place.
 *
 * The first block is the "Limits" table of
 * docs/professional-network/02-technical-architecture.md section 4.3, copied
 * exactly; shared/schemas.test.ts fails if the two drift. The zod schemas, the
 * SQL CHECK constraints and the screens' character counters all read these
 * numbers. Ranges are inclusive and count characters (Unicode code points, as
 * Postgres char_length does). A lower bound of 0 means optional.
 */

export interface Range {
  readonly min: number;
  readonly max: number;
}

export const limits = {
  /** profiles.first_name, profiles.last_name */
  name: { min: 1, max: 60 },
  /** profiles.credentials (PE, PhD, MD) */
  credentials: { min: 0, max: 20 },
  /** profiles.bio; required for professionals, optional for students */
  bio: { min: 120, max: 1200 },
  /** profiles.location */
  location: { min: 1, max: 80 },
  /** professional_details.title */
  title: { min: 1, max: 120 },
  /** professional_details.organization */
  organization: { min: 1, max: 120 },
  /** professional_details.years_experience (a number, not a length) */
  yearsExperience: { min: 0, max: 60 },
  /** profile_expertise rows per profile; `tag` is expertise_tags.label */
  expertise: { min: 2, max: 12, tag: { min: 2, max: 40 } },
  /** items in professional_details.interests and student_details.interests */
  interests: { min: 0, max: 10, item: { min: 1, max: 40 } },
  /** education rows per profile */
  education: { min: 0, max: 6 },
  /** student_details.program and student_details.institution */
  program: { min: 1, max: 120 },
  /** student_details.goals */
  goals: { min: 20, max: 600 },
  /** student_details.topics_needed (count) */
  topicsNeeded: { min: 1, max: 5 },
  /** mentorship_settings.availability */
  availabilityText: { min: 0, max: 160 },
  /** mentorship_settings.max_active (a number) */
  maxActive: { min: 1, max: 10 },
  /** mentorship_requests.why */
  why: { min: 30, max: 800 },
  /** mentorship_requests.goals */
  requestGoals: { min: 0, max: 400 },
  /** mentorship_requests.scheduling_note */
  schedulingNote: { min: 0, max: 200 },
  /** mentorship_requests.mentor_note */
  note: { min: 0, max: 600 },
  /** reports.detail, reports.resolution_note, profile_reviews.notes */
  reportDetail: { min: 0, max: 1000 },
} as const;

/**
 * Limits the architecture doc implies without a row in its table (column notes,
 * enum-like choices, value formats). Kept here so they also live in one place.
 */
export const fieldLimits = {
  /** education.degree, education.field, education.school */
  educationText: { min: 1, max: 120 },
  /** education.year: 1950 to the current year plus 8 */
  educationYear: { min: 1950, yearsAhead: 8 },
  /** mentorship_settings.duration_min */
  durationMin: [30, 45, 60] as const,
  /** mentor_topics rows when mentoring (at least one; at most every topic) */
  mentorTopics: { min: 1 },
  /** mentorship_settings.audience when mentoring */
  mentorAudience: { min: 1 },
  /** profiles.linkedin_url, profiles.website_url, contact_preferences.booking_url */
  url: { max: 300 },
  /** contact_preferences.contact_email (RFC 5321 path limit) */
  email: { max: 254 },
  /** profiles.region and every vocabulary id (slugs) */
  slug: { min: 1, max: 60 },
  /** disciplines.label, mentorship_topics.label */
  vocabularyLabel: { min: 2, max: 80 },
  /** availability_slots per proposal (`propose_times`) */
  slotsPerProposal: { min: 1, max: 3 },
  /** availability_slots.ends_at - starts_at, and meetings.duration_min, in minutes */
  slotMinutes: { min: 15, max: 180 },
  /** how far ahead a time may be proposed, in days */
  slotDaysAhead: { max: 365 },
  /** meetings.place */
  meetingPlace: { min: 0, max: 200 },
  /** meetings.agenda (02 section 4.3: max 400) */
  meetingAgenda: { min: 0, max: 400 },
} as const;

/** List endpoints: `?page` (1-based) and `&size`. */
export const paging = { defaultSize: 20, maxSize: 50 } as const;

/**
 * The `config` table: seeded defaults and the ranges `admin_update_config`
 * enforces (02 section 4.3, "config"). `reminder_days` is a list of ascending
 * integers, each below `request_expiry_days`.
 */
export const configLimits = {
  request_expiry_days: { default: 14, min: 3, max: 60 },
  // At most 2: mentorship_requests.reminders_sent counts to 2.
  reminder_days: { default: [5, 10] as readonly number[], maxCount: 2 },
  pending_cap: { default: 3, min: 1, max: 10 },
  default_max_active: { default: 3, min: 1, max: 10 },
  daily_request_limit: { default: 5, min: 1, max: 50 },
  daily_report_limit: { default: 3, min: 1, max: 20 },
  magic_links_per_hour: { default: 5, min: 1, max: 20 },
  platform_paused: { default: false },
  retention_months: { default: 24, min: 6, max: 60 },
} as const;

export type ConfigKey = keyof typeof configLimits;
