/**
 * Shapes of the profile layer (migration 0004), shared by the profile and
 * directory services and the screens. Field names are the API's camelCase;
 * the database columns they come from are named in the comments where they
 * differ. Nothing here carries an account email: contact values arrive only
 * as `ContactValue` rows from `release_contact`.
 */

import type { AudienceId, ContactMethodId, DisciplineGroup, ParticipationId } from "../taxonomy";
import type {
  ApprovalState,
  ExperienceBandId,
  MeetingMode,
  MentoringFormat,
  MentorStatus,
  ProfileKind,
  ReviewDecision,
  TagStatus,
  VerifiedMethod,
  Visibility,
} from "./common";

/** What `profile_access(id)` answers for the caller. */
export type ProfileAccess = "visible" | "members_only" | "none";

export interface Education {
  degree: string;
  field: string;
  school: string;
  year: number;
}

export interface ExpertiseTag {
  id: string;
  label: string;
  slug: string;
  /** `proposed` tags are seen only by their proposer and administrators. */
  status: TagStatus;
}

/** `professional_details`, without the search document. */
export interface ProfessionalDetails {
  title: string;
  organization: string;
  disciplineId: string;
  yearsExperience: number;
  participation: ParticipationId[];
  interests: string[];
  verified: boolean;
  /** Administrators only; others see `verified`. */
  verifiedMethod?: VerifiedMethod | null;
}

/** `student_details`: the owner, administrators and (Task 19) a requested mentor. */
export interface StudentDetails {
  program: string;
  level: AudienceId;
  institution: string;
  goals: string;
  interests: string[];
  topicsNeeded: string[];
}

/**
 * The mentorship offer as anyone who can see the profile reads it:
 * `max_active` is withheld and `hasCapacity` stands in for it.
 */
export interface MentorshipOffer {
  status: MentorStatus;
  topics: string[];
  audience: AudienceId[];
  format: MentoringFormat;
  mode: MeetingMode;
  availability: string | null;
  durationMin: 30 | 45 | 60;
  /** Only while paused: the day the `resume-paused` job turns it back on (YYYY-MM-DD). */
  pausedUntil: string | null;
  hasCapacity: boolean;
}

/** The owner's own settings (`my_mentorship_settings()`), with the cap. */
export interface OwnMentorshipSettings extends Omit<MentorshipOffer, "hasCapacity"> {
  maxActive: number;
  /** What an administrator's hide or a canceled deletion restores. */
  previousStatus: MentorStatus | null;
}

/** `contact_preferences`, readable by the owner only. */
export interface ContactPreferences {
  /** Always includes `mest`. */
  methods: ContactMethodId[];
  /** The subset signed-in members see; never `mest`. */
  shareWithMembers: Exclude<ContactMethodId, "mest">[];
  contactEmail: string | null;
  /** E.164 */
  phone: string | null;
  bookingUrl: string | null;
}

/** One row of `release_contact(profile_id)`. */
export interface ContactValue {
  method: Exclude<ContactMethodId, "mest">;
  value: string;
}

/** `notification_preferences` with the `email_` prefix dropped. */
export interface NotificationPreferences {
  requests: boolean;
  responses: boolean;
  reminders: boolean;
  profile: boolean;
  reports: boolean;
  adminDigest: boolean;
  /** The opt-in weekly member digest; off by default. */
  memberDigest: boolean;
  productUpdates: boolean;
}

/** The latest `profile_reviews` row as its subject reads it (no reviewer). */
export interface ProfileReviewSummary {
  id: string;
  /** null while waiting */
  decision: ReviewDecision | null;
  notes: string | null;
  submittedAt: string;
  decidedAt: string | null;
}

/**
 * A row of the `profile_entries` / `directory_entries` views in camelCase.
 * The views carry no contact column, LinkedIn link or `max_active`.
 */
export interface ProfileEntry {
  id: string;
  kind: ProfileKind | null;
  approvalState: ApprovalState;
  visibility: Visibility;
  firstName: string | null;
  lastName: string | null;
  credentials: string | null;
  region: string;
  location: string | null;
  bio: string | null;
  websiteUrl: string | null;
  lastActiveAt: string | null;
  title: string | null;
  organization: string | null;
  disciplineId: string | null;
  disciplineLabel: string | null;
  disciplineGroup: DisciplineGroup | null;
  experienceBand: ExperienceBandId | null;
  participation: ParticipationId[];
  interests: string[];
  verified: boolean;
  /** Approved labels, plus the caller's own proposed ones on their own profile. */
  tags: string[];
  mentorStatus: MentorStatus | null;
  mentorTopics: string[];
  audience: AudienceId[];
  format: MentoringFormat | null;
  mode: MeetingMode | null;
  availability: string | null;
  durationMin: number | null;
  hasCapacity: boolean;
}

/** One row of `admin_list_members(page, size, q)`: never the address, only its domain. */
export interface AdminMemberRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  kind: ProfileKind | null;
  approvalState: ApprovalState;
  mentorStatus: MentorStatus | null;
  emailDomain: string;
  joinedAt: string;
}

/** The `admin_dashboard` view (Tasks 24 and 25 add report and request measures). */
export interface AdminDashboardCounts {
  approvedProfessionals: number;
  pendingProfessionals: number;
  students: number;
  activeMentors: number;
}
