/**
 * Shapes of the directory and profile reads (`/api/directory`,
 * `/api/profiles/:id`, `/api/profiles/:id/contact`, `/api/profiles/:id/save`).
 * None of these carries an account email, a LinkedIn link, an exact number
 * of years or a mentor's `max_active`: contact values arrive only from the
 * contact endpoint, and only for signed-in members.
 */

import type { AudienceId, DisciplineGroup, ParticipationId } from "../taxonomy";
import type {
  ApprovalState,
  ExperienceBandId,
  MeetingMode,
  MentoringFormat,
  MentorStatus,
  Paged,
  Visibility,
} from "./common";
import type { ContactValue, Education } from "./profiles";

/**
 * The mentoring filter: `any` applies none; `available` keeps active mentors
 * with a free slot; `all` keeps everyone who offers mentoring (active or
 * paused, full or not).
 */
export const mentoringFilters = ["any", "available", "all"] as const;
export type MentoringFilter = (typeof mentoringFilters)[number];

/**
 * `relevance`: the search rank when `q` is set, otherwise mentors with a
 * free slot first, then the most recently active. `name`: last name.
 * `experience`: most years first. `recent`: most recently active first.
 */
export const directorySorts = ["relevance", "name", "experience", "recent"] as const;
export type DirectorySort = (typeof directorySorts)[number];

/**
 * The query `GET /api/directory` accepts, as the screens hold it. List
 * filters match any of their values (`discipline=civil&discipline=coastal`
 * is civil or coastal; `discipline[]=` works too); different filters
 * narrow each other.
 */
export interface DirectoryQuery {
  q?: string;
  discipline?: string[];
  /** Expertise tag slugs. */
  tag?: string[];
  /** Mentorship topic ids; only mentors who offer one of them. */
  topic?: string[];
  experience?: ExperienceBandId[];
  /** Case-insensitive substring of the city. */
  location?: string;
  verified?: boolean;
  mentoring?: MentoringFilter;
  /** Only mentors who take this audience. */
  audience?: AudienceId;
  participation?: ParticipationId[];
  sort?: DirectorySort;
  page?: number;
  size?: number;
}

/** One directory card. */
export interface DirectoryEntry {
  id: string;
  firstName: string;
  lastName: string;
  credentials: string | null;
  title: string;
  organization: string;
  disciplineId: string;
  disciplineLabel: string | null;
  disciplineGroup: DisciplineGroup | null;
  location: string | null;
  /** The band only; the exact number of years stays private. */
  experienceBand: ExperienceBandId | null;
  verified: boolean;
  /** Approved expertise tag labels. */
  tags: string[];
  participation: ParticipationId[];
  /** `public`, or `members` (seen only by signed-in members). */
  visibility: Extract<Visibility, "public" | "members">;
  mentorStatus: MentorStatus | null;
  mentorTopics: string[];
  audience: AudienceId[];
  /** Active mentor with a free slot: "Taking requests". */
  hasCapacity: boolean;
  lastActiveAt: string | null;
  /** The approved profile photo (`/api/photos/:id?v=`), or null for initials. */
  photoUrl: string | null;
}

export interface DisciplineFacet {
  id: string;
  count: number;
}

/**
 * `GET /api/directory`. The discipline counts apply every filter except the
 * discipline filter itself, so each option says how many it would show.
 * `paused` is present (and the list empty) while the platform is paused.
 */
export interface DirectoryResponse extends Paged<DirectoryEntry> {
  facets: { disciplines: DisciplineFacet[] };
  paused?: true;
}

/** The mentorship offer on a profile page (no `max_active`). */
export interface ProfileMentorship {
  status: MentorStatus;
  topics: string[];
  audience: AudienceId[];
  format: MentoringFormat;
  mode: MeetingMode;
  availability: string | null;
  durationMin: number;
  /** Only while paused: the day it resumes (YYYY-MM-DD). */
  pausedUntil: string | null;
  hasCapacity: boolean;
}

/**
 * `GET /api/profiles/:id`: the profile as the caller may see it, without
 * contact columns or the LinkedIn link. `approvalState` is present only on
 * the caller's own profile (so a pending owner can show "Waiting for
 * review"); a visitor asking for a members-only profile gets
 * `403 { code: 'members_only' }`, and an unknown, pending, hidden or
 * student profile `404`.
 */
export interface ProfileView {
  id: string;
  isOwner: boolean;
  approvalState?: ApprovalState;
  visibility: Visibility;
  firstName: string | null;
  lastName: string | null;
  credentials: string | null;
  region: string;
  location: string | null;
  bio: string | null;
  websiteUrl: string | null;
  title: string | null;
  organization: string | null;
  disciplineId: string | null;
  disciplineLabel: string | null;
  disciplineGroup: DisciplineGroup | null;
  experienceBand: ExperienceBandId | null;
  verified: boolean;
  tags: string[];
  interests: string[];
  participation: ParticipationId[];
  education: Education[];
  /** null when the profile has no mentorship row (students). */
  mentorship: ProfileMentorship | null;
  /** Whether the caller has saved it; always false for a visitor. */
  saved: boolean;
  lastActiveAt: string | null;
  /** The approved profile photo (`/api/photos/:id?v=`), or null for initials. */
  photoUrl: string | null;
}

/** `GET /api/profiles/:id/contact` (signed-in members only). */
export interface ProfileContactResponse {
  methods: ContactValue[];
}

/** `POST` and `DELETE /api/profiles/:id/save`. */
export interface SaveResponse {
  saved: boolean;
}
