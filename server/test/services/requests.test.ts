import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MentorAvailability, MyMentorship, RequestDetail, RequestsResponse } from "@shared/types/requests";
import { SEED, runSeed } from "../../seed/seed";
import { SEED_REQUESTS, seedRequestId, seedRequests } from "../../seed/requests";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { meRoutes } from "../../src/routes/me";
import { meMentorshipRoutes, mentorRoutes, requestRoutes } from "../../src/routes/requests";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { newAccount, runAs, studentPayload } from "../policies/fixtures";
import {
  MENTOR_PHONE,
  WHY,
  acceptRequest,
  makeMentor,
  makeStudent,
  requestStatus,
  resetRequestConfig,
  sendRequest,
  setConfig,
} from "../policies/request-fixtures";

/**
 * `/api/requests/*`, `/api/mentors/:id/availability`, `/api/me/mentorship`
 * and `/api/me/suggested-mentors` (Task 19), through the real guards and
 * `withUser`, so the SQL functions and the row policies decide; plus the
 * lifecycle functions the jobs will call.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await truncateAll(db.pool);
  await resetRequestConfig(db.pool);
});

const ORIGIN = "http://127.0.0.1:8787";
const app = testApp(
  new Hono()
    .route("/requests", requestRoutes)
    .route("/mentors", mentorRoutes)
    .route("/me", meRoutes)
    .route("/me", meMentorshipRoutes),
);

async function cookieFor(userId: string): Promise<string> {
  return asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
}

interface Call {
  status: number;
  body: any;
}

async function call(cookie: string | null, method: string, path: string, body?: unknown): Promise<Call> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (cookie) headers.cookie = `mest_session=${cookie}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function requestBody(mentorId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mentorId,
    kind: "mentorship",
    topicId: "internships-and-first-jobs",
    why: WHY,
    goals: "A resume that reads well to a hiring manager.",
    format: "one-time",
    mode: "online",
    schedulingNote: "Evenings after 6 PM.",
    ...overrides,
  };
}

async function notificationsOf(recipient: string) {
  return (
    await db.pool.query<{ template: string; category: string; email_status: string; title: string; payload: Record<string, unknown> }>(
      `SELECT template, category::text AS category, email_status, title, payload
         FROM notifications WHERE recipient_id = $1 ORDER BY created_at, id`,
      [recipient],
    )
  ).rows;
}

async function outboxTemplatesFor(userId: string): Promise<string[]> {
  return (
    await db.pool.query<{ template: string }>(
      `SELECT o.template FROM email_outbox o JOIN users u ON u.email = o.to_email WHERE u.id = $1 ORDER BY o.created_at`,
      [userId],
    )
  ).rows.map((r) => r.template);
}

describe("creating a request", () => {
  it("creates_and_notifies_the_mentor_by_email", async () => {
    const mentor = await makeMentor(db.pool, { firstName: "Layla" });
    const student = await makeStudent(db.pool, { firstName: "Amina" });
    const cookie = await cookieFor(student);

    const res = await call(cookie, "POST", "/requests", requestBody(mentor));
    expect(res.status).toBe(201);
    const detail = res.body as RequestDetail;
    expect(detail).toMatchObject({
      role: "mentee",
      kind: "mentorship",
      status: "pending",
      topicId: "internships-and-first-jobs",
      topicLabel: "Internships and first jobs",
      why: WHY,
      counterparty: { id: mentor, firstName: "Layla" },
      relationship: null,
      mentee: null,
    });
    expect(detail.handoff).toBeUndefined();
    // Expires after config.request_expiry_days.
    const days = (Date.parse(detail.expiresAt) - Date.parse(detail.createdAt)) / 86_400_000;
    expect(days).toBeCloseTo(14, 3);

    const [note] = await notificationsOf(mentor);
    expect(note).toMatchObject({ template: "request-received", category: "request", email_status: "queued" });
    // The notification carries names and the topic, never the request's text.
    expect(note.payload).toMatchObject({ menteeFirstName: "Amina", topicLabel: "Internships and first jobs" });
    expect(JSON.stringify(note)).not.toContain("summer internships");
    expect(await outboxTemplatesFor(mentor)).toEqual(["request-received"]);
  });

  it("validates_the_body", async () => {
    const mentor = await makeMentor(db.pool);
    const cookie = await cookieFor(await makeStudent(db.pool));
    const short = await call(cookie, "POST", "/requests", requestBody(mentor, { why: "Too short" }));
    expect(short.status).toBe(400);
    expect(short.body.code).toBe("validation");
    const noTopic = await call(cookie, "POST", "/requests", requestBody(mentor, { topicId: undefined }));
    expect(noTopic.status).toBe(400);
    const visitor = await call(null, "POST", "/requests", requestBody(mentor));
    expect(visitor.status).toBe(401);
  });
});

describe("refusals, one per code", () => {
  it("platform_paused", async () => {
    const mentor = await makeMentor(db.pool);
    const cookie = await cookieFor(await makeStudent(db.pool));
    await setConfig(db.pool, "platform_paused", true);
    const res = await call(cookie, "POST", "/requests", requestBody(mentor));
    expect(res).toEqual({ status: 409, body: { code: "platform_paused" } });
  });

  it("mentor_unavailable", async () => {
    const cookie = await cookieFor(await makeStudent(db.pool));
    const paused = await makeMentor(db.pool, { status: "paused" });
    const off = await makeMentor(db.pool, { status: "off" });
    const hidden = await makeMentor(db.pool, { visibility: "hidden" });
    const suspended = await makeMentor(db.pool, { suspended: true });
    const noNetworking = await makeMentor(db.pool, { participation: ["directory", "mentoring"] });
    const student = await makeStudent(db.pool);

    for (const mentor of [paused, off, hidden, suspended, student]) {
      const res = await call(cookie, "POST", "/requests", requestBody(mentor));
      expect(res.body.code).toBe("mentor_unavailable");
    }
    const intro = await call(
      cookie,
      "POST",
      "/requests",
      requestBody(noNetworking, { kind: "introduction", topicId: undefined }),
    );
    expect(intro).toEqual({ status: 409, body: { code: "mentor_unavailable" } });
  });

  it("topic_not_offered", async () => {
    const mentor = await makeMentor(db.pool, { topics: ["graduate-school"] });
    const cookie = await cookieFor(await makeStudent(db.pool));
    const res = await call(cookie, "POST", "/requests", requestBody(mentor, { topicId: "negotiating-offers" }));
    expect(res).toEqual({ status: 409, body: { code: "topic_not_offered" } });
  });

  it("mentor_full", async () => {
    const mentor = await makeMentor(db.pool, { maxActive: 1 });
    const first = await makeStudent(db.pool);
    await acceptRequest(db.pool, mentor, await sendRequest(db.pool, first, mentor));
    const cookie = await cookieFor(await makeStudent(db.pool));
    const res = await call(cookie, "POST", "/requests", requestBody(mentor));
    expect(res).toEqual({ status: 409, body: { code: "mentor_full" } });
    // An introduction is not mentoring and takes no slot.
    const intro = await call(cookie, "POST", "/requests", requestBody(mentor, { kind: "introduction", topicId: undefined }));
    expect(intro.status).toBe(201);
  });

  it("pending_cap", async () => {
    await setConfig(db.pool, "pending_cap", 2);
    const cookie = await cookieFor(await makeStudent(db.pool));
    const mentors = [await makeMentor(db.pool), await makeMentor(db.pool), await makeMentor(db.pool)];
    expect((await call(cookie, "POST", "/requests", requestBody(mentors[0]))).status).toBe(201);
    expect((await call(cookie, "POST", "/requests", requestBody(mentors[1]))).status).toBe(201);
    const third = await call(cookie, "POST", "/requests", requestBody(mentors[2]));
    expect(third).toEqual({ status: 409, body: { code: "pending_cap" } });
  });

  it("duplicate", async () => {
    const mentor = await makeMentor(db.pool);
    const student = await makeStudent(db.pool);
    const cookie = await cookieFor(student);
    const first = await call(cookie, "POST", "/requests", requestBody(mentor));
    expect(first.status).toBe(201);
    expect(await call(cookie, "POST", "/requests", requestBody(mentor))).toEqual({ status: 409, body: { code: "duplicate" } });
    // Accepted blocks a new pair too; a closed one does not.
    await acceptRequest(db.pool, mentor, first.body.id);
    expect((await call(cookie, "POST", "/requests", requestBody(mentor))).body.code).toBe("duplicate");
    await runAs(db.pool, student, "SELECT complete_relationship($1)", [first.body.id]);
    expect((await call(cookie, "POST", "/requests", requestBody(mentor))).status).toBe(201);
  });

  it("rate_limited", async () => {
    await setConfig(db.pool, "daily_request_limit", 2);
    const cookie = await cookieFor(await makeStudent(db.pool));
    const mentors = [await makeMentor(db.pool), await makeMentor(db.pool), await makeMentor(db.pool)];
    for (const mentor of mentors.slice(0, 2)) {
      const sent = await call(cookie, "POST", "/requests", requestBody(mentor));
      // Canceled requests still count against the day.
      expect((await call(cookie, "POST", `/requests/${sent.body.id}/cancel`)).status).toBe(200);
    }
    expect(await call(cookie, "POST", "/requests", requestBody(mentors[2]))).toEqual({
      status: 409,
      body: { code: "rate_limited" },
    });
  });
});

describe("answering a request", () => {
  it("accept_creates_relationship_and_shares_methods", async () => {
    const mentor = await makeMentor(db.pool, { firstName: "Layla", methods: ["mest", "email", "phone"], share: [] });
    const student = await makeStudent(db.pool, { firstName: "Amina" });
    const menteeCookie = await cookieFor(student);
    const mentorCookie = await cookieFor(mentor);
    const created = await call(menteeCookie, "POST", "/requests", requestBody(mentor));
    const id = created.body.id as string;

    // The mentor sees the student's details while the request is open.
    const incoming = await call(mentorCookie, "GET", `/requests/${id}`);
    expect(incoming.body).toMatchObject({ role: "mentor", counterparty: { id: student, firstName: "Amina" } });
    expect(incoming.body.mentee).toMatchObject({ program: "BS Civil Engineering, junior", level: "undergrad" });
    expect(incoming.body.handoff).toBeUndefined();

    // A method without a value, or "mest", cannot be handed over.
    const booking = await call(mentorCookie, "POST", `/requests/${id}/respond`, { decision: "accept", shareMethods: ["booking"] });
    expect(booking).toEqual({ status: 409, body: { code: "invalid_share_methods" } });
    const mest = await call(mentorCookie, "POST", `/requests/${id}/respond`, { decision: "accept", shareMethods: ["mest"] });
    expect(mest.status).toBe(400);
    // The mentee cannot answer their own request.
    const self = await call(menteeCookie, "POST", `/requests/${id}/respond`, { decision: "accept", shareMethods: ["phone"] });
    expect(self.status).toBe(403);

    const accepted = await call(mentorCookie, "POST", `/requests/${id}/respond`, {
      decision: "accept",
      note: "Happy to help. Send your resume ahead of time.",
      shareMethods: ["phone"],
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      status: "accepted",
      mentorNote: "Happy to help. Send your resume ahead of time.",
      relationship: { completedAt: null, completedBy: null, sharedMethods: ["phone"] },
    });
    expect(accepted.body.respondedAt).not.toBeNull();

    const rows = await db.pool.query(
      "SELECT mentee_id, mentor_id, topic_id, shared_methods::text[] AS shared FROM mentorship_relationships WHERE request_id = $1",
      [id],
    );
    expect(rows.rows).toEqual([{ mentee_id: student, mentor_id: mentor, topic_id: "internships-and-first-jobs", shared: ["phone"] }]);

    // The mentee reads the phone number in the handoff; the email (not shared) is absent.
    const mine = await call(menteeCookie, "GET", `/requests/${id}`);
    expect(mine.body.handoff).toEqual({ methods: [{ method: "phone", value: MENTOR_PHONE }] });

    const notes = await notificationsOf(student);
    expect(notes.map((n) => [n.template, n.email_status])).toEqual([["request-accepted", "queued"]]);
    expect(JSON.stringify(notes)).not.toContain("Send your resume");

    // A second answer is refused.
    const again = await call(mentorCookie, "POST", `/requests/${id}/respond`, { decision: "decline", declineReason: "other" });
    expect(again).toEqual({ status: 409, body: { code: "not_pending" } });
  });

  it("decline_records_reason_and_notifies_by_email", async () => {
    const mentor = await makeMentor(db.pool);
    const student = await makeStudent(db.pool);
    const id = await sendRequest(db.pool, student, mentor);
    const res = await call(await cookieFor(mentor), "POST", `/requests/${id}/respond`, {
      decision: "decline",
      declineReason: "outside_experience",
      note: "Rania would be a better fit.",
    });
    expect(res.body).toMatchObject({ status: "declined", declineReason: "outside_experience", relationship: null });
    const [note] = await notificationsOf(student);
    expect(note).toMatchObject({ template: "request-declined", category: "response", email_status: "queued" });
    expect(note.payload).toMatchObject({ reason: "outside_experience" });
    expect(JSON.stringify(note)).not.toContain("Rania");
  });

  it("concurrent_accept_respects_cap", async () => {
    // Two accepts race for a mentor's last free slot. The second must wait
    // for the first (the settings row lock) and then see it.
    const mentor = await makeMentor(db.pool, { maxActive: 1 });
    const a = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    const b = await sendRequest(db.pool, await makeStudent(db.pool), mentor);

    const first = await db.requestPool.connect();
    const second = await db.requestPool.connect();
    const begin = async (client: typeof first) => {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_user");
      await client.query("SELECT set_config('app.user_id', $1, true)", [mentor]);
    };
    try {
      await begin(first);
      await begin(second);
      await first.query("SELECT respond_to_request($1, 'accept', NULL, NULL, '{email}')", [a]);

      let settled = false;
      const racing = second
        .query("SELECT respond_to_request($1, 'accept', NULL, NULL, '{email}')", [b])
        .then(
          () => "accepted",
          (error: Error) => error.message,
        )
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);

      await first.query("COMMIT");
      expect(await racing).toBe("mest.mentor_full");
      await second.query("ROLLBACK");
    } finally {
      first.release();
      second.release();
    }

    expect(await requestStatus(db.pool, a)).toBe("accepted");
    expect(await requestStatus(db.pool, b)).toBe("pending");
    const active = await db.pool.query("SELECT count(*)::int AS n FROM mentorship_relationships WHERE mentor_id = $1", [mentor]);
    expect(active.rows[0].n).toBe(1);
  });

  it("concurrent_creation_respects_pending_cap", async () => {
    // Two requests from one mentee to two mentors at once: the mentee's
    // lock keeps the pending cap.
    await setConfig(db.pool, "pending_cap", 1);
    const student = await makeStudent(db.pool);
    const mentors = [await makeMentor(db.pool), await makeMentor(db.pool)];
    const results = await Promise.allSettled(mentors.map((mentor) => sendRequest(db.pool, student, mentor)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(String(refused?.reason)).toContain("mest.pending_cap");
  });
});

describe("the handoff", () => {
  it("handoff_only_for_accepted_mentee", async () => {
    const mentor = await makeMentor(db.pool, { methods: ["mest", "email", "phone"], share: ["email"] });
    const student = await makeStudent(db.pool);
    const other = await makeStudent(db.pool);
    const menteeCookie = await cookieFor(student);
    const mentorCookie = await cookieFor(mentor);
    const otherCookie = await cookieFor(other);
    const id = await sendRequest(db.pool, student, mentor);

    // Pending: no handoff, and the function refuses.
    expect((await call(menteeCookie, "GET", `/requests/${id}`)).body.handoff).toBeUndefined();
    await expect(runAs(db.pool, student, "SELECT * FROM get_request_handoff($1)", [id])).rejects.toThrow(/mest.no_handoff/);

    await acceptRequest(db.pool, mentor, id, ["phone", "email"]);

    // The mentee gets it.
    const mine = await call(menteeCookie, "GET", `/requests/${id}`);
    expect(mine.body.handoff.methods.map((m: { method: string }) => m.method)).toEqual(["email", "phone"]);
    // The mentor does not get their own handoff back; another member cannot see the request at all.
    expect((await call(mentorCookie, "GET", `/requests/${id}`)).body.handoff).toBeUndefined();
    await expect(runAs(db.pool, mentor, "SELECT * FROM get_request_handoff($1)", [id])).rejects.toThrow(/mest.no_handoff/);
    expect(await call(otherCookie, "GET", `/requests/${id}`)).toEqual({ status: 404, body: { code: "not_found" } });
    await expect(runAs(db.pool, other, "SELECT * FROM get_request_handoff($1)", [id])).rejects.toThrow(/mest.not_found/);
    expect((await call(null, "GET", `/requests/${id}`)).status).toBe(401);

    // Reading it twice writes one audit entry naming the methods, not the values.
    await call(menteeCookie, "GET", `/requests/${id}`);
    const audits = await db.pool.query<{ actor_id: string; detail: unknown }>(
      "SELECT actor_id, detail FROM audit_log WHERE action = 'contact.viewed' AND subject_id = $1",
      [mentor],
    );
    expect(audits.rows).toEqual([{ actor_id: student, detail: { methods: ["email", "phone"], request: id } }]);
    expect(JSON.stringify(audits.rows)).not.toContain(MENTOR_PHONE);

    // Completed: the handoff is gone.
    await call(menteeCookie, "POST", `/requests/${id}/complete`);
    expect((await call(menteeCookie, "GET", `/requests/${id}`)).body.handoff).toBeUndefined();
  });
});

describe("a member who is no longer in good standing", () => {
  it("suspended_mentee_reads_history_without_handoff", async () => {
    const mentor = await makeMentor(db.pool);
    const student = await makeStudent(db.pool);
    const id = await sendRequest(db.pool, student, mentor);
    await acceptRequest(db.pool, mentor, id, ["phone"]);
    await asSystem(db.pool, (client) => client.query("UPDATE users SET suspended_at = now() WHERE id = $1", [student]));
    const res = await call(await cookieFor(student), "GET", `/requests/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");
    expect(res.body.handoff).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(MENTOR_PHONE);
    // And cannot act.
    expect((await call(await cookieFor(student), "POST", `/requests/${id}/complete`)).status).toBe(403);
  });
});

describe("canceling and completing", () => {
  it("cancel_notifies_in_app_only_and_complete_invites_feedback", async () => {
    const mentor = await makeMentor(db.pool, { firstName: "Layla" });
    const student = await makeStudent(db.pool, { firstName: "Amina" });
    const menteeCookie = await cookieFor(student);
    const mentorCookie = await cookieFor(mentor);

    const pending = await sendRequest(db.pool, student, mentor);
    // Only the mentee cancels.
    expect((await call(mentorCookie, "POST", `/requests/${pending}/cancel`)).status).toBe(403);
    const canceled = await call(menteeCookie, "POST", `/requests/${pending}/cancel`);
    expect(canceled.body.status).toBe("canceled");
    expect(await call(menteeCookie, "POST", `/requests/${pending}/cancel`)).toEqual({ status: 409, body: { code: "not_pending" } });

    const active = await sendRequest(db.pool, student, mentor);
    await acceptRequest(db.pool, mentor, active);
    const before = await outboxTemplatesFor(mentor);
    const done = await call(mentorCookie, "POST", `/requests/${active}/complete`);
    expect(done.body).toMatchObject({ status: "completed", relationship: { completedBy: "me" } });
    expect(done.body.relationship.completedAt).not.toBeNull();
    // The mentee's view says the other party marked it.
    expect((await call(menteeCookie, "GET", `/requests/${active}`)).body.relationship.completedBy).toBe("them");
    expect(await call(menteeCookie, "POST", `/requests/${active}/complete`)).toEqual({ status: 409, body: { code: "not_active" } });

    // The mentor heard about the new request and the cancellation; only the new requests were emailed.
    const mentorNotes = await notificationsOf(mentor);
    expect(mentorNotes.map((n) => [n.template, n.email_status])).toEqual([
      ["request-received", "queued"],
      ["default", "skipped"],
      ["request-received", "queued"],
    ]);
    expect(mentorNotes[1].title).toContain("canceled");
    expect(await outboxTemplatesFor(mentor)).toEqual(before);
    // The mentee heard about the acceptance and the completion, which now
    // (Task 32) invites their feedback, both by email.
    const menteeNotes = await notificationsOf(student);
    expect(menteeNotes.map((n) => [n.template, n.email_status])).toEqual([
      ["request-accepted", "queued"],
      ["feedback-invite", "queued"],
    ]);
    expect(menteeNotes[1].title).toContain("completed");
    expect(await outboxTemplatesFor(student)).toEqual(["request-accepted", "feedback-invite"]);
  });

  it("set_kind_keeps_requests", async () => {
    // A student who switches to professional keeps the requests they sent,
    // and the mentor keeps seeing them.
    const mentor = await makeMentor(db.pool);
    const other = await makeMentor(db.pool);
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);
    expect((await call(cookie, "POST", "/me/onboarding", studentPayload())).status).toBe(200);
    const pending = await sendRequest(db.pool, id, mentor);
    const accepted = await sendRequest(db.pool, id, other);
    await acceptRequest(db.pool, other, accepted);

    const switched = await call(cookie, "POST", "/me/kind", { kind: "professional" });
    expect(switched.status).toBe(200);
    expect(switched.body.kind).toBe("professional");

    const mine = await call(cookie, "GET", "/requests?role=mentee");
    expect(mine.body.items.map((r: { id: string; status: string }) => [r.id, r.status]).sort()).toEqual(
      [
        [pending, "pending"],
        [accepted, "accepted"],
      ].sort(),
    );
    expect((await call(await cookieFor(mentor), "GET", `/requests/${pending}`)).body.counterparty.id).toBe(id);
    expect((await call(cookie, "GET", `/requests/${accepted}`)).body.handoff.methods).toHaveLength(1);
  });
});

describe("lists and counts", () => {
  it("list_filters_by_role_and_status", async () => {
    const mentor = await makeMentor(db.pool);
    const students = [await makeStudent(db.pool), await makeStudent(db.pool), await makeStudent(db.pool)];
    const ids = [];
    for (const student of students) ids.push(await sendRequest(db.pool, student, mentor));
    await acceptRequest(db.pool, mentor, ids[1]);
    const someoneElse = await makeMentor(db.pool);
    await sendRequest(db.pool, mentor, someoneElse);
    const cookie = await cookieFor(mentor);

    const incoming = (await call(cookie, "GET", "/requests?role=mentor")).body as RequestsResponse;
    expect(incoming.total).toBe(3);
    const pending = (await call(cookie, "GET", "/requests?role=mentor&status=pending")).body as RequestsResponse;
    // The mentor's pending inbox reads oldest first.
    expect(pending.items.map((r) => r.id)).toEqual([ids[0], ids[2]]);
    const open = (await call(cookie, "GET", "/requests?status=pending,accepted&size=1")).body as RequestsResponse;
    expect(open.total).toBe(4);
    expect(open.items).toHaveLength(1);
    const outgoing = (await call(cookie, "GET", "/requests?role=mentee")).body as RequestsResponse;
    expect(outgoing.items.map((r) => r.counterparty.id)).toEqual([someoneElse]);
    // The list carries no free text.
    expect(JSON.stringify(incoming)).not.toContain("summer internships");

    expect((await call(cookie, "GET", "/requests?status=lost")).status).toBe(400);
    expect((await call(cookie, "GET", "/requests?role=admin")).status).toBe(400);
  });

  it("me_mentorship_counts", async () => {
    const mentor = await makeMentor(db.pool, { maxActive: 2 });
    const students = [await makeStudent(db.pool), await makeStudent(db.pool)];
    await acceptRequest(db.pool, mentor, await sendRequest(db.pool, students[0], mentor));
    await sendRequest(db.pool, students[1], mentor);
    await sendRequest(db.pool, mentor, await makeMentor(db.pool));

    const res = await call(await cookieFor(mentor), "GET", "/me/mentorship");
    expect(res.body as MyMentorship).toEqual({
      status: "active",
      maxActive: 2,
      activeCount: 1,
      pendingIncoming: 1,
      pendingOutgoing: 1,
      pendingCap: 3,
    });
    const student = await call(await cookieFor(students[1]), "GET", "/me/mentorship");
    expect(student.body).toEqual({ status: null, maxActive: null, activeCount: 0, pendingIncoming: 0, pendingOutgoing: 1, pendingCap: 3 });
    expect((await call(null, "GET", "/me/mentorship")).status).toBe(401);
  });

  it("suggested_mentors_rank_overlap_and_skip_open_pairs", async () => {
    const student = await makeStudent(db.pool, { topicsNeeded: ["graduate-school", "technical-interviews"], level: "grad" });
    const best = await makeMentor(db.pool, { topics: ["graduate-school", "technical-interviews"], audience: ["grad"] });
    const good = await makeMentor(db.pool, { topics: ["graduate-school"], audience: ["grad"] });
    const fair = await makeMentor(db.pool, { topics: ["technical-interviews"], audience: ["undergrad"] });
    const asked = await makeMentor(db.pool, { topics: ["graduate-school", "technical-interviews"], audience: ["grad"] });
    await sendRequest(db.pool, student, asked, { topic: "graduate-school" });
    await makeMentor(db.pool, { status: "paused", topics: ["graduate-school", "technical-interviews"], audience: ["grad"] });
    const full = await makeMentor(db.pool, { maxActive: 1, topics: ["graduate-school"], audience: ["grad"] });
    await acceptRequest(db.pool, full, await sendRequest(db.pool, await makeStudent(db.pool), full, { topic: "graduate-school" }));

    const cookie = await cookieFor(student);
    const res = await call(cookie, "GET", "/me/suggested-mentors");
    expect(res.status).toBe(200);
    expect(res.body.items.map((m: { id: string }) => m.id)).toEqual([best, good, fair]);
    // A topic asked about moves its mentors up.
    const byTopic = await call(cookie, "GET", "/me/suggested-mentors?topic=technical-interviews");
    expect(byTopic.body.items[1].id).toBe(fair);
    expect((await call(cookie, "GET", "/me/suggested-mentors?topic=Not%20A%20Slug")).status).toBe(400);
  });
});

describe("availability", () => {
  it("availability_precedence", async () => {
    const off = await makeMentor(db.pool, { status: "off", participation: ["directory", "mentoring"] });
    const networking = await makeMentor(db.pool, { status: "off", participation: ["directory", "networking"] });
    const paused = await makeMentor(db.pool, { status: "paused", pausedUntil: "2099-01-15" });
    const pausedNoDate = await makeMentor(db.pool, { status: "paused" });
    const full = await makeMentor(db.pool, { maxActive: 1 });
    await acceptRequest(db.pool, full, await sendRequest(db.pool, await makeStudent(db.pool), full));
    const taking = await makeMentor(db.pool);
    const suspended = await makeMentor(db.pool, { suspended: true });
    const membersOnly = await makeMentor(db.pool, { visibility: "members" });
    const hidden = await makeMentor(db.pool, { visibility: "hidden" });

    const stateOf = async (id: string, cookie: string | null = null) => (await call(cookie, "GET", `/mentors/${id}/availability`)).body as MentorAvailability;
    expect(await stateOf(off)).toEqual({ state: "off" });
    expect(await stateOf(networking)).toEqual({ state: "networking_only" });
    expect(await stateOf(paused)).toEqual({ state: "paused", resumeOn: "2099-01-15" });
    expect(await stateOf(pausedNoDate)).toEqual({ state: "paused" });
    expect(await stateOf(full)).toEqual({ state: "full" });
    expect(await stateOf(taking)).toEqual({ state: "taking" });
    // A suspended mentor takes no requests at all.
    expect(await stateOf(suspended)).toEqual({ state: "off" });

    // Only for a profile the caller may see.
    expect((await call(null, "GET", `/mentors/${membersOnly}/availability`)).status).toBe(404);
    const member = await cookieFor(await makeStudent(db.pool));
    expect(await stateOf(membersOnly, member)).toEqual({ state: "taking" });
    expect((await call(member, "GET", `/mentors/${hidden}/availability`)).status).toBe(404);
    expect((await call(null, "GET", "/mentors/not-a-uuid/availability")).status).toBe(404);
  });
});

describe("lifecycle functions for the jobs", () => {
  const system = <T>(sql: string, params: unknown[] = []) =>
    asSystem(db.pool, async (client) => (await client.query<{ value: T }>(sql, params)).rows[0].value);

  it("lifecycle_functions_transition_once", async () => {
    const mentor = await makeMentor(db.pool);
    const student = await makeStudent(db.pool);
    const id = await sendRequest(db.pool, student, mentor);
    const created = (await db.pool.query<{ created_at: Date }>("SELECT created_at FROM mentorship_requests WHERE id = $1", [id])).rows[0]
      .created_at;
    const day = (n: number) => new Date(created.getTime() + n * 86_400_000 + 60_000);

    // Reminders: not before day 5; once at day 5; the second at day 10, once.
    expect(await system<boolean>("SELECT send_request_reminder($1, 0, $2) AS value", [id, day(4)])).toBe(false);
    expect(await system<boolean>("SELECT send_request_reminder($1, 0, $2) AS value", [id, day(5)])).toBe(true);
    expect(await system<boolean>("SELECT send_request_reminder($1, 0, $2) AS value", [id, day(6)])).toBe(false);
    expect(await system<boolean>("SELECT send_request_reminder($1, 1, $2) AS value", [id, day(9)])).toBe(false);
    expect(await system<boolean>("SELECT send_request_reminder($1, 1, $2) AS value", [id, day(10)])).toBe(true);
    expect(await system<boolean>("SELECT send_request_reminder($1, 1, $2) AS value", [id, day(11)])).toBe(false);
    expect(await system<boolean>("SELECT send_request_reminder($1, 2, $2) AS value", [id, day(12)])).toBe(false);
    const reminders = (await notificationsOf(mentor)).filter((n) => n.template === "request-reminder");
    expect(reminders.map((n) => [n.category, n.email_status])).toEqual([
      ["reminder", "queued"],
      ["reminder", "queued"],
    ]);

    // Expiry: not before day 14; once at day 14.
    expect(await system<boolean>("SELECT expire_request($1, $2) AS value", [id, day(13)])).toBe(false);
    expect(await system<boolean>("SELECT expire_request($1, $2) AS value", [id, day(14)])).toBe(true);
    expect(await system<boolean>("SELECT expire_request($1, $2) AS value", [id, day(15)])).toBe(false);
    expect(await requestStatus(db.pool, id)).toBe("expired");
    const expired = (await notificationsOf(student)).filter((n) => n.template === "request-expired");
    expect(expired.map((n) => [n.category, n.email_status])).toEqual([["response", "queued"]]);
    const expiredAudits = await db.pool.query("SELECT 1 FROM audit_log WHERE action = 'request.expired' AND subject_id = $1", [id]);
    expect(expiredAudits.rowCount).toBe(1);
    // An expired request gets no more reminders.
    await db.pool.query("UPDATE mentorship_requests SET reminders_sent = 0 WHERE id = $1", [id]);
    expect(await system<boolean>("SELECT send_request_reminder($1, 0, $2) AS value", [id, day(20)])).toBe(false);

    // Resume: a paused mentor comes back on the date, once.
    const paused = await makeMentor(db.pool, { status: "paused", pausedUntil: "2030-03-01" });
    expect(await system<boolean>("SELECT resume_mentor($1, '2030-02-28') AS value", [paused])).toBe(false);
    expect(await system<boolean>("SELECT resume_mentor($1, '2030-03-01') AS value", [paused])).toBe(true);
    expect(await system<boolean>("SELECT resume_mentor($1, '2030-03-02') AS value", [paused])).toBe(false);
    const resumed = await db.pool.query("SELECT status::text AS status, paused_until FROM mentorship_settings WHERE profile_id = $1", [
      paused,
    ]);
    expect(resumed.rows).toEqual([{ status: "active", paused_until: null }]);

    // Retention: expired and declined requests older than the cut-off lose their text, once.
    const kept = await sendRequest(db.pool, await makeStudent(db.pool), mentor);
    expect(await system<number>("SELECT purge_request_text($1) AS value", [new Date(Date.now() - 86_400_000)])).toBe(0);
    expect(await system<number>("SELECT purge_request_text($1) AS value", [new Date(Date.now() + 86_400_000)])).toBe(1);
    expect(await system<number>("SELECT purge_request_text($1) AS value", [new Date(Date.now() + 86_400_000)])).toBe(0);
    const text = await db.pool.query(
      "SELECT id, why, goals, scheduling_note, text_purged_at IS NOT NULL AS purged FROM mentorship_requests WHERE id = ANY ($1) ORDER BY id = $2",
      [[id, kept], kept],
    );
    expect(text.rows[0]).toEqual({ id, why: "", goals: null, scheduling_note: null, purged: true });
    // A pending request keeps its text.
    expect(text.rows[1]).toMatchObject({ id: kept, why: WHY, purged: false });
    const detail = await call(await cookieFor(student), "GET", `/requests/${id}`);
    expect(detail.body).toMatchObject({ why: "", textPurged: true });

    // None of them runs with an acting user, even one the function would otherwise allow.
    await expect(
      asSystem(db.pool, async (client) => {
        await client.query("SELECT set_config('app.user_id', $1, true)", [student]);
        await client.query("SELECT expire_request($1)", [kept]);
      }),
    ).rejects.toThrow(/mest.forbidden/);
  });
});

describe("seed", () => {
  it("seed_requests_writes_the_prototype_requests_and_resets_on_rerun", async () => {
    const seed = () => asSystem(db.pool, (client) => seedRequests(wrapClient(client)));
    await runSeed();
    await seed();

    const counts = async () =>
      (
        await db.pool.query<{ requests: number; relationships: number; active: number }>(
          `SELECT (SELECT count(*)::int FROM mentorship_requests) AS requests,
                  (SELECT count(*)::int FROM mentorship_relationships) AS relationships,
                  (SELECT count(*)::int FROM mentorship_relationships WHERE completed_at IS NULL) AS active`,
        )
      ).rows[0];
    expect(await counts()).toEqual({ requests: SEED_REQUESTS.length, relationships: 4, active: 3 });

    const layla = SEED["layla-haddad"].id;
    const amina = SEED["amina-rahman"].id;
    const laylaCookie = await cookieFor(layla);
    expect((await call(laylaCookie, "GET", "/me/mentorship")).body).toEqual({
      status: "active",
      maxActive: 3,
      activeCount: 1,
      pendingIncoming: 2,
      pendingOutgoing: 0,
      pendingCap: 3,
    });
    const amina_ = (await call(await cookieFor(amina), "GET", "/requests?role=mentee")).body as RequestsResponse;
    expect(amina_.items.map((r) => [r.counterparty.firstName, r.status])).toEqual([
      ["Zainab", "accepted"],
      ["Fatima", "declined"],
      ["Layla", "expired"],
    ]);
    // The accepted request hands over what the mentor chose.
    const zainab = await call(await cookieFor(amina), "GET", `/requests/${seedRequestId("req-1001")}`);
    expect(zainab.body.handoff.methods.map((m: { method: string }) => m.method)).toEqual(["email"]);

    // The expired Amina to Layla request does not block a new one; a re-run removes the new one.
    await sendRequest(db.pool, amina, layla, { topic: "professional-licensure" });
    expect((await counts()).requests).toBe(SEED_REQUESTS.length + 1);
    await seed();
    expect(await counts()).toEqual({ requests: SEED_REQUESTS.length, relationships: 4, active: 3 });
  });
});
