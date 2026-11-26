import type { Onboarding } from "@shared/schemas/onboarding";
import type { ProfilePatch } from "@shared/schemas/profile";
import type { ContactPatch, MentorshipPatch, NotificationPatch, SettingsPatch } from "@shared/schemas/settings";
import type { AudienceId, ContactMethodId, ParticipationId } from "@shared/taxonomy";
import type {
  ApprovalState,
  MeetingMode,
  MentoringFormat,
  MentorStatus,
  ProfileKind,
  ReviewDecision,
  TagStatus,
  Visibility,
} from "@shared/types/common";
import type { OwnProfile, OwnSettings, PreviewProfile, PreviewResponse } from "@shared/types/me";
import type {
  ContactValue,
  Education,
  ExpertiseTag,
  NotificationPreferences,
  ProfileAccess,
  ProfileEntry,
  StudentDetails,
} from "@shared/types/profiles";
import type { Db } from "../db/tx";
import { AppError } from "../http/errors";

/**
 * The owner's own profile, settings, kind and preview (Task 12). Every
 * function takes the `Db` of a `withUser` transaction for the signed-in
 * member: reads go through Row Level Security as that member, owner columns
 * are written directly (the policies and guard triggers decide), and every
 * state change (onboarding, kind, mentorship status, expertise) is a SQL
 * function. Nothing here selects `profiles.linkedin_url` (not granted; the
 * owner reads it through `my_profile_private()`) or `users.email`.
 *
 * Enum arrays are cast to `text[]` in every select so the driver returns
 * string arrays rather than `'{a,b}'` literals.
 */

/* --------------------------------------------------------------- helpers */

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

const conflict = (code: string, message: string) => new AppError(409, code, message);

/**
 * `UPDATE <table> SET ... WHERE <where>` for the entries of `columns` that
 * are not `undefined` (a `null` clears the column). Column names come from
 * this module, never from the request. Returns the affected row count, or
 * null when there was nothing to set.
 */
async function updateColumns(
  db: Db,
  table: string,
  where: string,
  columns: Record<string, { value: unknown; cast?: string }>,
): Promise<number | null> {
  const entries = Object.entries(columns).filter(([, c]) => c.value !== undefined);
  if (entries.length === 0) return null;
  const sets = entries.map(([column, c], i) => `${column} = $${i + 1}${c.cast ? `::${c.cast}` : ""}`);
  const result = await db.client.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE ${where}`, entries.map(([, c]) => c.value));
  return result.rowCount ?? 0;
}

const col = (value: unknown, cast?: string) => ({ value, cast });

/* ------------------------------------------------------------------ reads */

interface ProfileRow {
  id: string;
  kind: ProfileKind | null;
  approval_state: ApprovalState;
  visibility: Visibility;
  first_name: string | null;
  last_name: string | null;
  credentials: string | null;
  region: string;
  location: string | null;
  bio: string | null;
  website_url: string | null;
  mission_accepted_at: Date | null;
  admin_hidden: boolean;
  last_active_at: Date | null;
}

async function ownProfileRow(db: Db): Promise<ProfileRow> {
  const row = await db.maybeOne<ProfileRow>(
    `SELECT p.id, p.kind, p.approval_state, p.visibility, p.first_name, p.last_name, p.credentials,
            p.region, p.location, p.bio, p.website_url, p.mission_accepted_at,
            p.admin_hidden_at IS NOT NULL AS admin_hidden, p.last_active_at
       FROM profiles p WHERE p.id = app_uid()`,
  );
  if (!row) throw new AppError(404, "not_found", "no profile for the signed-in user");
  return row;
}

async function ownLinkedin(db: Db): Promise<string | null> {
  const row = await db.maybeOne<{ linkedin_url: string | null }>("SELECT linkedin_url FROM my_profile_private()");
  return row?.linkedin_url ?? null;
}

function education(db: Db, profileId: string): Promise<Education[]> {
  return db.query<Education>(
    `SELECT e.degree, e.field, e.school, e.year
       FROM education e WHERE e.profile_id = $1
      ORDER BY e.year DESC, e.degree, e.id`,
    [profileId],
  );
}

interface MentorshipRow {
  status: MentorStatus;
  previous_status: MentorStatus | null;
  paused_until: string | null;
  audience: AudienceId[];
  format: MentoringFormat;
  mode: MeetingMode;
  availability: string | null;
  duration_min: 30 | 45 | 60;
  max_active: number;
  topics: string[];
}

async function readSettings(db: Db, visibility: Visibility): Promise<OwnSettings> {
  const mentorship = await db.maybeOne<MentorshipRow>(
    `SELECT s.status, s.previous_status, s.paused_until::text AS paused_until, s.audience::text[] AS audience,
            s.format, s.mode, s.availability, s.duration_min, s.max_active,
            coalesce((
              SELECT array_agg(mt.topic_id ORDER BY t.sort_order, mt.topic_id)
                FROM mentor_topics mt JOIN mentorship_topics t ON t.id = mt.topic_id
               WHERE mt.profile_id = s.profile_id
            ), '{}') AS topics
       FROM my_mentorship_settings() s`,
  );

  const contact = await db.maybeOne<{
    methods: ContactMethodId[];
    share_with_members: Exclude<ContactMethodId, "mest">[];
    contact_email: string | null;
    phone: string | null;
    booking_url: string | null;
  }>(
    `SELECT c.methods::text[] AS methods, c.share_with_members::text[] AS share_with_members,
            c.contact_email::text AS contact_email, c.phone, c.booking_url
       FROM contact_preferences c WHERE c.profile_id = app_uid()`,
  );

  const notifications = await db.maybeOne<NotificationPreferences>(
    `SELECT n.email_requests AS requests, n.email_responses AS responses, n.email_reminders AS reminders,
            n.email_profile AS profile, n.email_reports AS reports, n.email_admin_digest AS "adminDigest",
            n.email_product_updates AS "productUpdates"
       FROM notification_preferences n WHERE n.profile_id = app_uid()`,
  );

  return {
    visibility,
    mentorship: mentorship && {
      status: mentorship.status,
      previousStatus: mentorship.previous_status,
      pausedUntil: mentorship.paused_until,
      topics: mentorship.topics,
      audience: mentorship.audience,
      format: mentorship.format,
      mode: mentorship.mode,
      availability: mentorship.availability,
      durationMin: mentorship.duration_min,
      maxActive: mentorship.max_active,
    },
    contact: contact && {
      methods: contact.methods,
      shareWithMembers: contact.share_with_members,
      contactEmail: contact.contact_email,
      phone: contact.phone,
      bookingUrl: contact.booking_url,
    },
    notifications,
  };
}

/** `GET /api/me/settings` */
export async function getOwnSettings(db: Db): Promise<OwnSettings> {
  return readSettings(db, (await ownProfileRow(db)).visibility);
}

/** `GET /api/me/profile`: the owner's profile in any approval state, with the latest review and the settings. */
export async function getOwnProfile(db: Db): Promise<OwnProfile> {
  const profile = await ownProfileRow(db);

  const professional = await db.maybeOne<{
    title: string;
    organization: string;
    discipline_id: string;
    years_experience: number;
    participation: ParticipationId[];
    interests: string[];
    verified: boolean;
  }>(
    `SELECT d.title, d.organization, d.discipline_id, d.years_experience,
            d.participation::text[] AS participation, d.interests, d.verified
       FROM professional_details d WHERE d.profile_id = $1`,
    [profile.id],
  );

  // Approved tags and the owner's own proposed ones; the policies hide the rest.
  const expertise = professional
    ? await db.query<{ id: string; label: string; slug: string; status: TagStatus }>(
        `SELECT t.id, t.label, t.slug, t.status::text AS status
           FROM profile_expertise pe JOIN expertise_tags t ON t.id = pe.tag_id
          WHERE pe.profile_id = $1
          ORDER BY lower(t.label)`,
        [profile.id],
      )
    : [];

  const student = await db.maybeOne<StudentDetails>(
    `SELECT s.program, s.level::text AS level, s.institution, s.goals, s.interests, s.topics_needed AS "topicsNeeded"
       FROM student_details s WHERE s.profile_id = $1`,
    [profile.id],
  );

  const review = await db.maybeOne<{
    id: string;
    decision: ReviewDecision | null;
    notes: string | null;
    submitted_at: Date;
    decided_at: Date | null;
  }>(
    `SELECT r.id, r.decision::text AS decision, r.notes, r.submitted_at, r.decided_at
       FROM profile_reviews r WHERE r.profile_id = $1
      ORDER BY r.submitted_at DESC, r.id DESC
      LIMIT 1`,
    [profile.id],
  );

  return {
    id: profile.id,
    kind: profile.kind,
    approvalState: profile.approval_state,
    visibility: profile.visibility,
    firstName: profile.first_name,
    lastName: profile.last_name,
    credentials: profile.credentials,
    region: profile.region,
    location: profile.location,
    bio: profile.bio,
    linkedinUrl: await ownLinkedin(db),
    websiteUrl: profile.website_url,
    missionAcceptedAt: iso(profile.mission_accepted_at),
    adminHidden: profile.admin_hidden,
    lastActiveAt: iso(profile.last_active_at),
    professional: professional && {
      title: professional.title,
      organization: professional.organization,
      disciplineId: professional.discipline_id,
      yearsExperience: professional.years_experience,
      participation: professional.participation,
      interests: professional.interests,
      verified: professional.verified,
      expertise: expertise satisfies ExpertiseTag[],
    },
    student,
    education: await education(db, profile.id),
    review: review && {
      id: review.id,
      decision: review.decision,
      notes: review.notes,
      submittedAt: iso(review.submitted_at) ?? "",
      decidedAt: iso(review.decided_at),
    },
    settings: await readSettings(db, profile.visibility),
  };
}

/* ------------------------------------------------------------ onboarding */

/** `POST /api/me/onboarding`: the validated payload goes to `complete_onboarding` as is. */
export async function completeOnboarding(db: Db, payload: Onboarding): Promise<OwnProfile> {
  await db.query("SELECT complete_onboarding($1::jsonb)", [JSON.stringify(payload)]);
  return getOwnProfile(db);
}

/** `POST /api/me/kind`: `set_kind` keeps saved profiles (and, from Task 19, requests). */
export async function setKind(db: Db, kind: ProfileKind): Promise<OwnProfile> {
  await db.query("SELECT set_kind($1::profile_kind)", [kind]);
  return getOwnProfile(db);
}

/** `POST /api/me/touch`: records activity at most once a day. */
export async function touch(db: Db): Promise<{ touched: boolean }> {
  return db.one<{ touched: boolean }>("SELECT touch_last_active() AS touched");
}

/* --------------------------------------------------------- profile patch */

const PROFESSIONAL_KEYS = [
  "title",
  "organization",
  "disciplineId",
  "yearsExperience",
  "expertise",
  "education",
  "participation",
] as const satisfies readonly (keyof ProfilePatch)[];

const STUDENT_KEYS = [
  "program",
  "level",
  "institution",
  "goals",
  "topicsNeeded",
] as const satisfies readonly (keyof ProfilePatch)[];

const has = (patch: ProfilePatch, keys: readonly (keyof ProfilePatch)[]) => keys.some((k) => patch[k] !== undefined);

/**
 * `PATCH /api/me/profile`: the owner's columns through Row Level Security.
 * Professional fields need a professional and student fields a student; a
 * member who switched kind with `set_kind` creates the missing details row
 * by sending all of its required fields at once.
 */
export async function patchProfile(db: Db, patch: ProfilePatch): Promise<OwnProfile> {
  const profile = await ownProfileRow(db);
  if (profile.kind === null) throw conflict("not_onboarded", "complete onboarding first");
  if (profile.kind !== "professional" && has(patch, PROFESSIONAL_KEYS)) {
    throw conflict("not_professional", "professional fields on a student profile");
  }
  if (profile.kind !== "student" && has(patch, STUDENT_KEYS)) {
    throw conflict("not_student", "student fields on a professional profile");
  }

  // A LinkedIn contact method is listed only with its link.
  if (patch.linkedinUrl === null) {
    const shared = await db.maybeOne<{ uses: boolean }>(
      "SELECT 'linkedin' = ANY (c.methods) AS uses FROM contact_preferences c WHERE c.profile_id = app_uid()",
    );
    if (shared?.uses) throw conflict("invalid_contact", "turn off the LinkedIn contact method before removing the link");
  }

  const updated = await updateColumns(db, "profiles", "id = app_uid()", {
    first_name: col(patch.firstName),
    last_name: col(patch.lastName),
    credentials: col(patch.credentials),
    location: col(patch.location),
    region: col(patch.region),
    bio: col(patch.bio),
    linkedin_url: col(patch.linkedinUrl),
    website_url: col(patch.websiteUrl),
  });
  if (updated === 0) throw new AppError(403, "not_member", "profile update refused");

  if (profile.kind === "professional") await patchProfessional(db, profile.id, patch);
  else await patchStudent(db, profile.id, patch);

  return getOwnProfile(db);
}

async function patchProfessional(db: Db, profileId: string, patch: ProfilePatch): Promise<void> {
  const columns = {
    title: col(patch.title),
    organization: col(patch.organization),
    discipline_id: col(patch.disciplineId),
    years_experience: col(patch.yearsExperience),
    participation: col(patch.participation, "participation[]"),
    interests: col(patch.interests),
  };

  if (patch.disciplineId !== undefined) {
    const known = await db.maybeOne("SELECT 1 FROM disciplines d WHERE d.id = $1 AND d.active", [patch.disciplineId]);
    if (!known) throw conflict("invalid_discipline", "unknown discipline");
  }

  const exists = await db.maybeOne("SELECT 1 FROM professional_details d WHERE d.profile_id = $1", [profileId]);
  if (exists) {
    await updateColumns(db, "professional_details", "profile_id = app_uid()", columns);
  } else if (has(patch, PROFESSIONAL_KEYS) || patch.interests !== undefined) {
    // After a switch to professional: the details row starts here.
    if (
      patch.title === undefined ||
      patch.organization === undefined ||
      patch.disciplineId === undefined ||
      patch.yearsExperience === undefined
    ) {
      throw conflict("professional_details_required", "title, organization, discipline and years of experience come together");
    }
    await db.query(
      `INSERT INTO professional_details (profile_id, title, organization, discipline_id, years_experience, participation, interests)
       VALUES (app_uid(), $1, $2, $3, $4, $5::participation[], $6)`,
      [patch.title, patch.organization, patch.disciplineId, patch.yearsExperience, patch.participation ?? [], patch.interests ?? []],
    );
  }

  if (patch.expertise !== undefined) {
    await db.query("SELECT set_my_expertise($1::text[])", [patch.expertise]);
  }
  if (patch.education !== undefined) {
    await db.query("DELETE FROM education WHERE profile_id = app_uid()");
    for (const e of patch.education) {
      await db.query("INSERT INTO education (profile_id, degree, field, school, year) VALUES (app_uid(), $1, $2, $3, $4)", [
        e.degree,
        e.field,
        e.school,
        e.year,
      ]);
    }
  }
}

async function patchStudent(db: Db, profileId: string, patch: ProfilePatch): Promise<void> {
  const columns = {
    program: col(patch.program),
    level: col(patch.level, "audience"),
    institution: col(patch.institution),
    goals: col(patch.goals),
    interests: col(patch.interests),
    topics_needed: col(patch.topicsNeeded),
  };
  const exists = await db.maybeOne("SELECT 1 FROM student_details s WHERE s.profile_id = $1", [profileId]);
  if (exists) {
    await updateColumns(db, "student_details", "profile_id = app_uid()", columns);
    return;
  }
  if (!has(patch, STUDENT_KEYS) && patch.interests === undefined) return;
  // After a switch to student: the details row starts here.
  if (
    patch.program === undefined ||
    patch.level === undefined ||
    patch.institution === undefined ||
    patch.goals === undefined ||
    patch.topicsNeeded === undefined
  ) {
    throw conflict("student_details_required", "program, level, institution, goals and topics come together");
  }
  await db.query(
    `INSERT INTO student_details (profile_id, program, level, institution, goals, interests, topics_needed)
     VALUES (app_uid(), $1, $2::audience, $3, $4, $5, $6)`,
    [patch.program, patch.level, patch.institution, patch.goals, patch.interests ?? [], patch.topicsNeeded],
  );
}

/* -------------------------------------------------------- settings patch */

/**
 * `PATCH /api/me/settings`: visibility, contact preferences, the mentorship
 * offer and notification preferences, in one transaction. A mentorship
 * status change goes through `set_mentorship_status` after the offer fields
 * are written, so turning mentoring on and choosing its topics can be one
 * request. Lowering `maxActive` keeps existing relationships; it only stops
 * new accepts.
 */
export async function patchSettings(db: Db, patch: SettingsPatch): Promise<OwnSettings> {
  const profile = await ownProfileRow(db);
  if (profile.kind === null) throw conflict("not_onboarded", "complete onboarding first");

  if (patch.visibility !== undefined && patch.visibility !== profile.visibility) {
    if (profile.kind !== "professional") throw conflict("not_professional", "students are never listed");
    const updated = await updateColumns(db, "profiles", "id = app_uid()", { visibility: col(patch.visibility, "visibility") });
    if (updated === 0) throw new AppError(403, "not_member", "profile update refused");
  }
  if (patch.contact) await patchContact(db, profile.kind, patch.contact);
  if (patch.mentorship) await patchMentorship(db, patch.mentorship);
  if (patch.notifications) await patchNotifications(db, patch.notifications);

  return getOwnSettings(db);
}

async function patchContact(db: Db, kind: ProfileKind, patch: ContactPatch): Promise<void> {
  if (kind !== "professional") throw conflict("not_professional", "contact preferences belong to professionals");
  const stored = await db.maybeOne<{
    methods: ContactMethodId[];
    share_with_members: ContactMethodId[];
    contact_email: string | null;
    phone: string | null;
    booking_url: string | null;
  }>(
    `SELECT c.methods::text[] AS methods, c.share_with_members::text[] AS share_with_members,
            c.contact_email::text AS contact_email, c.phone, c.booking_url
       FROM contact_preferences c WHERE c.profile_id = app_uid()`,
  );
  const current = stored ?? { methods: ["mest"], share_with_members: [], contact_email: null, phone: null, booking_url: null };

  const methods = patch.methods ?? current.methods;
  // Turning a method off also stops sharing it, unless the patch says what to share.
  const share = patch.shareWithMembers ?? current.share_with_members.filter((m) => methods.includes(m));
  const next = {
    methods,
    share,
    contactEmail: patch.contactEmail === undefined ? current.contact_email : patch.contactEmail,
    phone: patch.phone === undefined ? current.phone : patch.phone,
    bookingUrl: patch.bookingUrl === undefined ? current.booking_url : patch.bookingUrl,
  };

  const invalid =
    !next.methods.includes("mest") ||
    next.share.includes("mest") ||
    next.share.some((m) => !next.methods.includes(m)) ||
    (next.methods.includes("phone") && !next.phone) ||
    (next.methods.includes("booking") && !next.bookingUrl) ||
    (next.methods.includes("linkedin") && !(await ownLinkedin(db)));
  if (invalid) throw conflict("invalid_contact", "a chosen contact method needs its value, and only chosen methods can be shared");

  const values = [next.methods, next.share, next.contactEmail, next.phone, next.bookingUrl];
  if (stored) {
    await db.query(
      `UPDATE contact_preferences
          SET methods = $1::contact_method[], share_with_members = $2::contact_method[],
              contact_email = $3, phone = $4, booking_url = $5
        WHERE profile_id = app_uid()`,
      values,
    );
  } else {
    await db.query(
      `INSERT INTO contact_preferences (profile_id, methods, share_with_members, contact_email, phone, booking_url)
       VALUES (app_uid(), $1::contact_method[], $2::contact_method[], $3, $4, $5)`,
      values,
    );
  }
}

async function patchMentorship(db: Db, patch: MentorshipPatch): Promise<void> {
  const settings = await db.maybeOne("SELECT 1 FROM my_mentorship_settings()");
  if (!settings) throw conflict("not_professional", "mentorship settings belong to professionals");

  await updateColumns(db, "mentorship_settings", "profile_id = app_uid()", {
    audience: col(patch.audience, "audience[]"),
    format: col(patch.format, "mentoring_format"),
    mode: col(patch.mode, "meeting_mode"),
    availability: col(patch.availabilityText),
    duration_min: col(patch.durationMin),
    max_active: col(patch.maxActive),
  });

  if (patch.topics !== undefined) {
    const known = await db.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM mentorship_topics t WHERE t.active AND t.id = ANY ($1::text[])",
      [patch.topics],
    );
    if (known.n !== patch.topics.length) throw conflict("invalid_topic", "unknown mentorship topic");
    await db.query("DELETE FROM mentor_topics WHERE profile_id = app_uid()");
    await db.query("INSERT INTO mentor_topics (profile_id, topic_id) SELECT app_uid(), t FROM unnest($1::text[]) AS t", [
      patch.topics,
    ]);
  }

  if (patch.status !== undefined) {
    await db.query("SELECT set_mentorship_status($1::mentor_status, $2::date)", [patch.status, patch.resumeOn ?? null]);
  }
}

async function patchNotifications(db: Db, patch: NotificationPatch): Promise<void> {
  const updated = await updateColumns(db, "notification_preferences", "profile_id = app_uid()", {
    email_requests: col(patch.requests),
    email_responses: col(patch.responses),
    email_reminders: col(patch.reminders),
    email_profile: col(patch.profile),
    email_reports: col(patch.reports),
    email_admin_digest: col(patch.adminDigest),
    email_product_updates: col(patch.productUpdates),
  });
  if (updated === 0) throw conflict("not_onboarded", "notification preferences start with onboarding");
}

/* ---------------------------------------------------------------- preview */

interface EntryRow {
  id: string;
  kind: ProfileKind | null;
  approval_state: ApprovalState;
  visibility: Visibility;
  first_name: string | null;
  last_name: string | null;
  credentials: string | null;
  region: string;
  location: string | null;
  bio: string | null;
  website_url: string | null;
  last_active_at: Date | null;
  title: string | null;
  organization: string | null;
  discipline_id: string | null;
  discipline_label: string | null;
  discipline_group: ProfileEntry["disciplineGroup"];
  experience_band: ProfileEntry["experienceBand"];
  participation: ParticipationId[];
  interests: string[];
  verified: boolean;
  tags: string[];
  mentor_status: MentorStatus | null;
  mentor_topics: string[];
  audience: AudienceId[];
  format: MentoringFormat | null;
  mode: MeetingMode | null;
  availability: string | null;
  duration_min: number | null;
  has_capacity: boolean;
}

/**
 * `GET /api/me/preview?as=visitor|member` (PRO-13): what someone else would
 * get. Access mirrors `profile_access` for that viewer
 * (`preview_my_access`); the profile is the owner's own `profile_entries`
 * row with approved tags only (the owner's proposed tags are theirs alone);
 * a member's contact list is what `release_contact` would hand them
 * (`preview_my_contact`, which writes no audit entry). A visitor never gets
 * contact values.
 */
export async function previewProfile(db: Db, viewer: "visitor" | "member"): Promise<PreviewResponse> {
  const { access } = await db.one<{ access: ProfileAccess }>("SELECT preview_my_access($1) AS access", [viewer]);
  if (access !== "visible") return { as: viewer, access };

  const row = await db.one<EntryRow>(
    `SELECT e.id, e.kind, e.approval_state, e.visibility, e.first_name, e.last_name, e.credentials, e.region,
            e.location, e.bio, e.website_url, e.last_active_at, e.title, e.organization, e.discipline_id,
            e.discipline_label, e.discipline_group, e.experience_band, e.participation, e.interests, e.verified,
            coalesce((
              SELECT array_agg(t.label ORDER BY t.label)
                FROM profile_expertise pe JOIN expertise_tags t ON t.id = pe.tag_id
               WHERE pe.profile_id = e.id AND t.status = 'approved'
            ), '{}') AS tags,
            e.mentor_status, e.mentor_topics, e.audience, e.format, e.mode, e.availability, e.duration_min,
            e.has_capacity
       FROM profile_entries e WHERE e.id = app_uid()`,
  );
  const profile: PreviewProfile = {
    id: row.id,
    kind: row.kind,
    approvalState: row.approval_state,
    visibility: row.visibility,
    firstName: row.first_name,
    lastName: row.last_name,
    credentials: row.credentials,
    region: row.region,
    location: row.location,
    bio: row.bio,
    websiteUrl: row.website_url,
    lastActiveAt: iso(row.last_active_at),
    title: row.title,
    organization: row.organization,
    disciplineId: row.discipline_id,
    disciplineLabel: row.discipline_label,
    disciplineGroup: row.discipline_group,
    experienceBand: row.experience_band,
    participation: row.participation,
    interests: row.interests,
    verified: row.verified,
    tags: row.tags,
    mentorStatus: row.mentor_status,
    mentorTopics: row.mentor_topics,
    audience: row.audience,
    format: row.format,
    mode: row.mode,
    availability: row.availability,
    durationMin: row.duration_min,
    hasCapacity: row.has_capacity,
    education: await education(db, row.id),
  };

  if (viewer === "visitor") return { as: viewer, access, profile };
  const contact = await db.query<ContactValue>("SELECT method::text AS method, value FROM preview_my_contact()");
  return { as: viewer, access, profile, contact };
}
