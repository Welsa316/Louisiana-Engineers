import type { Db } from "../src/db/tx";
import { seedUserId } from "./users";

/**
 * The prototype's mentorship requests and relationships, written after the
 * profile seeds (the mentors' settings and contact methods must exist).
 * Dates are relative to when the seed runs, as in the prototype, so a
 * pending request is always a day or two old and far from expiry.
 *
 * Besides the prototype's eight requests there is one more: an expired
 * request from Amina Rahman to Layla Haddad, so the pair the demo and the
 * email privacy test use has stored free text to look for, while Amina can
 * still send Layla a new request (only pending and accepted pairs block).
 *
 * Re-running resets requests between seeded people: requests the seed did
 * not write (made by hand or by an end-to-end run) are removed with their
 * relationships, and the seeded ones are put back as listed here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeedRequest {
  /** The prototype id (`req-1001`); the row id is derived from it. */
  key: string;
  mentee: string;
  mentor: string;
  kind: "mentorship" | "introduction";
  topic: string | null;
  why: string;
  goals: string;
  format: "one-time" | "recurring";
  mode: "online" | "in-person" | "either";
  schedulingNote: string;
  status: "pending" | "accepted" | "declined" | "completed" | "canceled" | "expired";
  /** Days from the seed run (negative is the past). */
  createdDays: number;
  respondedDays?: number;
  mentorNote?: string;
  declineReason?: "not_fit" | "no_capacity" | "outside_experience" | "other";
  /** Accepted and completed requests: the methods the mentor handed over. */
  shared?: string[];
  /** Completed requests: days from the seed run, and who marked it. */
  completedDays?: number;
  completedBy?: "mentee" | "mentor";
}

export const SEED_REQUESTS: SeedRequest[] = [
  {
    key: "req-1001",
    mentee: "amina-rahman",
    mentor: "zainab-qureshi",
    kind: "mentorship",
    topic: "resume-and-portfolio",
    why: "I am applying for summer internships and would love a second pair of eyes on my resume from someone who has reviewed engineering applications.",
    goals: "A resume that reads well to a hiring manager, and advice on what projects to highlight.",
    format: "one-time",
    mode: "online",
    schedulingNote: "Any evening after 6 PM works for me.",
    status: "accepted",
    createdDays: -9,
    respondedDays: -7,
    mentorNote: "Happy to help, Amina. Send your resume ahead of time and we will go through it together.",
    shared: ["email"],
  },
  {
    key: "req-1002",
    mentee: "amina-rahman",
    mentor: "fatima-noor",
    kind: "mentorship",
    topic: "choosing-a-major",
    why: "I was considering a public-health minor and wanted to understand how it pairs with engineering.",
    goals: "Decide whether to add the minor before registration closes.",
    format: "one-time",
    mode: "either",
    schedulingNote: "",
    status: "declined",
    createdDays: -20,
    respondedDays: -18,
    // The prototype said "Mentorship paused", which is not a reason a mentor picks.
    declineReason: "no_capacity",
    mentorNote: "I am paused through January for the surveillance season. Rania Khalil or Yahya Abdullah would be a great fit for this question.",
  },
  {
    key: "req-1003",
    mentee: "hamza-ali",
    mentor: "layla-haddad",
    kind: "mentorship",
    topic: "leadership-and-management",
    why: "I am leading a student project team for the first time and keep running into conflict I do not know how to handle.",
    goals: "Practical ways to run a small team and give feedback without souring relationships.",
    format: "one-time",
    mode: "online",
    schedulingNote: "Evenings or weekends.",
    status: "pending",
    createdDays: -2,
  },
  {
    key: "req-1004",
    mentee: "leen-saleh",
    mentor: "layla-haddad",
    kind: "mentorship",
    topic: "negotiating-offers",
    why: "I have an offer from a larger firm and want to negotiate without losing it.",
    goals: "Understand what is reasonable to ask for and how to ask.",
    format: "one-time",
    mode: "online",
    schedulingNote: "This week if at all possible, the offer expires Friday.",
    status: "pending",
    createdDays: -1,
  },
  {
    key: "req-1005",
    mentee: "sumaya-osman",
    mentor: "layla-haddad",
    kind: "mentorship",
    topic: "internships-and-first-jobs",
    why: "I want to understand how engineering consulting firms hire and whether a biology background has any way in.",
    goals: "A realistic view of environmental consulting roles.",
    format: "recurring",
    mode: "in-person",
    schedulingNote: "",
    status: "accepted",
    createdDays: -30,
    respondedDays: -28,
    mentorNote: "Let's start with one conversation and see where it goes.",
    shared: ["booking"],
  },
  {
    key: "req-1006",
    mentee: "idris-fofana",
    mentor: "layla-haddad",
    kind: "mentorship",
    topic: "internships-and-first-jobs",
    why: "I want to know what coastal engineers do.",
    goals: "Pick a major.",
    format: "one-time",
    mode: "in-person",
    schedulingNote: "",
    status: "completed",
    createdDays: -60,
    respondedDays: -58,
    mentorNote: "Come by the office and I will show you a model run.",
    shared: ["booking"],
    completedDays: -45,
    completedBy: "mentor",
  },
  {
    key: "req-1007",
    mentee: "hamza-ali",
    mentor: "yusuf-hassan",
    kind: "mentorship",
    topic: "research-and-publishing",
    why: "Deciding whether to pursue a thesis option.",
    goals: "Understand what a thesis buys me in industry.",
    format: "recurring",
    mode: "online",
    schedulingNote: "",
    status: "accepted",
    createdDays: -15,
    respondedDays: -13,
    shared: ["email"],
  },
  {
    key: "req-1008",
    mentee: "leen-saleh",
    mentor: "nadia-el-amin",
    kind: "mentorship",
    topic: "resume-and-portfolio",
    why: "Moving toward product engineering and want my portfolio to show it.",
    goals: "A portfolio that speaks to product teams.",
    format: "one-time",
    mode: "online",
    schedulingNote: "",
    status: "expired",
    createdDays: -24,
  },
  {
    key: "req-1009",
    mentee: "amina-rahman",
    mentor: "layla-haddad",
    kind: "mentorship",
    topic: "professional-licensure",
    why: "I want to plan my coursework around the FE exam and would like to hear how a practicing coastal engineer prepared for it.",
    goals: "A study plan for the FE exam that fits around my junior-year classes.",
    format: "one-time",
    mode: "online",
    schedulingNote: "Weekday afternoons between classes, ideally Tuesdays.",
    status: "expired",
    createdDays: -40,
  },
];

/** A stable id for a seeded request or relationship. */
export function seedRequestId(key: string): string {
  return seedUserId(`request:${key}`);
}

function at(base: number, days: number): Date {
  return new Date(base + days * DAY_MS);
}

/** Writes the seeded requests and relationships. Call after `seedProfilesDetails`. */
export async function seedRequests(db: Db): Promise<void> {
  const base = Date.now();
  const people = [...new Set(SEED_REQUESTS.flatMap((r) => [r.mentee, r.mentor]))].map(seedUserId);
  const ids = SEED_REQUESTS.map((r) => seedRequestId(r.key));

  // Meetings and proposed times between seeded people go first: they hang
  // off the relationships below, and the seeded schedule (seed/meetings.ts,
  // which runs after this) is written fresh each time.
  await db.query(
    `DELETE FROM meetings m
      USING mentorship_relationships rel
      WHERE m.relationship_id = rel.id AND (rel.mentee_id = ANY ($1::uuid[]) OR rel.mentor_id = ANY ($1::uuid[]))`,
    [people],
  );
  await db.query(
    `DELETE FROM availability_slots s
      USING mentorship_relationships rel
      WHERE s.relationship_id = rel.id AND (rel.mentee_id = ANY ($1::uuid[]) OR rel.mentor_id = ANY ($1::uuid[]))`,
    [people],
  );
  // Feedback hangs off relationships too (seed/feedback.ts writes the seeded rows afresh).
  await db.query(
    `DELETE FROM relationship_feedback f
      USING mentorship_relationships rel
      WHERE f.relationship_id = rel.id AND (rel.mentee_id = ANY ($1::uuid[]) OR rel.mentor_id = ANY ($1::uuid[]))`,
    [people],
  );

  // Requests between seeded people that the seed did not write go, so a
  // re-run starts from the listed state (an open pair left by an earlier
  // run would otherwise block a listed one).
  await db.query(
    `DELETE FROM mentorship_relationships rel
      USING mentorship_requests r
      WHERE rel.request_id = r.id AND NOT (r.id = ANY ($2::uuid[]))
        AND (r.mentee_id = ANY ($1::uuid[]) OR r.mentor_id = ANY ($1::uuid[]))`,
    [people, ids],
  );
  await db.query(
    `DELETE FROM mentorship_requests r
      WHERE NOT (r.id = ANY ($2::uuid[]))
        AND (r.mentee_id = ANY ($1::uuid[]) OR r.mentor_id = ANY ($1::uuid[]))`,
    [people, ids],
  );

  for (const request of SEED_REQUESTS) {
    const id = seedRequestId(request.key);
    const created = at(base, request.createdDays);
    const responded = request.respondedDays === undefined ? null : at(base, request.respondedDays);
    await db.query(
      `INSERT INTO mentorship_requests
         (id, mentee_id, mentor_id, kind, topic_id, why, goals, format, mode, scheduling_note, status,
          created_at, expires_at, responded_at, mentor_note, decline_reason, reminders_sent, text_purged_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12::timestamptz + interval '14 days', $13, $14, $15, 0, NULL)
       ON CONFLICT (id) DO UPDATE
         SET mentee_id = EXCLUDED.mentee_id,
             mentor_id = EXCLUDED.mentor_id,
             kind = EXCLUDED.kind,
             topic_id = EXCLUDED.topic_id,
             why = EXCLUDED.why,
             goals = EXCLUDED.goals,
             format = EXCLUDED.format,
             mode = EXCLUDED.mode,
             scheduling_note = EXCLUDED.scheduling_note,
             status = EXCLUDED.status,
             created_at = EXCLUDED.created_at,
             expires_at = EXCLUDED.expires_at,
             responded_at = EXCLUDED.responded_at,
             mentor_note = EXCLUDED.mentor_note,
             decline_reason = EXCLUDED.decline_reason,
             reminders_sent = 0,
             text_purged_at = NULL`,
      [
        id,
        seedUserId(request.mentee),
        seedUserId(request.mentor),
        request.kind,
        request.topic,
        request.why,
        request.goals || null,
        request.format,
        request.mode,
        request.schedulingNote || null,
        request.status,
        created,
        responded,
        request.mentorNote ?? null,
        request.declineReason ?? null,
      ],
    );

    if (request.status === "accepted" || request.status === "completed") {
      const completed = request.completedDays === undefined ? null : at(base, request.completedDays);
      const completedBy =
        request.completedBy === undefined ? null : seedUserId(request.completedBy === "mentee" ? request.mentee : request.mentor);
      await db.query(
        `INSERT INTO mentorship_relationships
           (id, request_id, mentee_id, mentor_id, topic_id, shared_methods, started_at, completed_at, completed_by)
         VALUES ($1, $2, $3, $4, $5, $6::contact_method[], $7, $8, $9)
         ON CONFLICT (request_id) DO UPDATE
           SET mentee_id = EXCLUDED.mentee_id,
               mentor_id = EXCLUDED.mentor_id,
               topic_id = EXCLUDED.topic_id,
               shared_methods = EXCLUDED.shared_methods,
               started_at = EXCLUDED.started_at,
               completed_at = EXCLUDED.completed_at,
               completed_by = EXCLUDED.completed_by`,
        [
          seedRequestId(`${request.key}:relationship`),
          id,
          seedUserId(request.mentee),
          seedUserId(request.mentor),
          request.topic,
          request.shared ?? [],
          responded ?? created,
          completed,
          completedBy,
        ],
      );
    } else {
      await db.query("DELETE FROM mentorship_relationships WHERE request_id = $1", [id]);
    }
  }
}
