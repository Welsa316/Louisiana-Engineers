import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminDashboard } from "@shared/types/admin";
import type { DataExport } from "@shared/types/export";
import type { AdminFeedbackResponse } from "@shared/types/feedback";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import "../../src/email/templates/all";
import { renderTemplate, type TemplateData } from "../../src/email/templates/registry";
import { adminRoutes } from "../../src/routes/admin";
import { exportRoutes } from "../../src/routes/export";
import { adminFeedbackRoutes, requestFeedbackRoutes } from "../../src/routes/feedback";
import { requestRoutes } from "../../src/routes/requests";
import { asSystem, asUser, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, runAs } from "../policies/fixtures";
import { makePair, type Pair } from "../policies/meeting-fixtures";
import { MENTOR_PHONE, WHY, resetRequestConfig } from "../policies/request-fixtures";

/**
 * Post-completion feedback (Task 32): one answer per party per relationship,
 * written through `leave_feedback` once the relationship is completed. The
 * other party never reads it; administrators see the average and the count
 * on the dashboard, and the comments only through `admin_feedback`, with no
 * author. The sweep empties a leaver's comments and keeps their ratings.
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
    .route("/requests", requestFeedbackRoutes)
    .route("/admin", adminRoutes)
    .route("/admin", adminFeedbackRoutes)
    .route("/me", exportRoutes),
);

const MENTEE_COMMENT = "Layla walked me through the FE exam plan and it finally made sense.";
const MENTOR_COMMENT = "Amina came prepared with questions; I would gladly mentor again.";

async function cookieFor(userId: string): Promise<string> {
  return asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
}

interface Call {
  status: number;
  body: any;
  text: string;
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
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
}

/** A completed mentorship between Layla (mentor) and Amina (mentee), completed by `by`. */
async function completedPair(by: "mentor" | "mentee" = "mentor"): Promise<Pair & { menteeCookie: string; mentorCookie: string }> {
  const pair = await makePair(db.pool);
  const mentorCookie = await cookieFor(pair.mentor);
  const menteeCookie = await cookieFor(pair.mentee);
  const done = await call(by === "mentor" ? mentorCookie : menteeCookie, "POST", `/requests/${pair.requestId}/complete`);
  expect(done.status).toBe(200);
  return { ...pair, mentorCookie, menteeCookie };
}

async function feedbackRows(): Promise<{ author_id: string; helpful: number; comment: string | null; comment_purged_at: Date | null }[]> {
  return (
    await db.pool.query(
      "SELECT author_id, helpful, comment, comment_purged_at FROM relationship_feedback ORDER BY created_at, id",
    )
  ).rows;
}

describe("leaving feedback", () => {
  it("feedback_only_after_completion_and_once_per_party", async () => {
    const pair = await makePair(db.pool);
    const menteeCookie = await cookieFor(pair.mentee);
    const mentorCookie = await cookieFor(pair.mentor);

    // While the mentorship is active there is nothing to answer yet.
    expect((await call(menteeCookie, "GET", `/requests/${pair.requestId}/feedback`)).body).toEqual({
      state: "unavailable",
      mine: null,
    });
    expect(await call(menteeCookie, "POST", `/requests/${pair.requestId}/feedback`, { helpful: 5 })).toMatchObject({
      status: 409,
      body: { code: "not_completed" },
    });

    expect((await call(mentorCookie, "POST", `/requests/${pair.requestId}/complete`)).status).toBe(200);
    expect((await call(menteeCookie, "GET", `/requests/${pair.requestId}/feedback`)).body).toEqual({ state: "open", mine: null });

    // Out-of-range answers are refused by the schema and by the function.
    for (const bad of [{ helpful: 0 }, { helpful: 6 }, { helpful: 2.5 }, { helpful: 4, comment: "x".repeat(601) }, {}]) {
      expect((await call(menteeCookie, "POST", `/requests/${pair.requestId}/feedback`, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    await expect(
      runAs(db.pool, pair.mentee, "SELECT leave_feedback($1, 9, NULL)", [pair.requestId]),
    ).rejects.toThrow(/mest\.invalid_feedback/);

    const left = await call(menteeCookie, "POST", `/requests/${pair.requestId}/feedback`, {
      helpful: 5,
      comment: `  ${MENTEE_COMMENT}  `,
    });
    expect(left.status).toBe(201);
    expect(left.body).toMatchObject({ state: "left", mine: { helpful: 5, comment: MENTEE_COMMENT } });
    expect((await call(menteeCookie, "GET", `/requests/${pair.requestId}/feedback`)).body).toMatchObject({
      state: "left",
      mine: { helpful: 5, comment: MENTEE_COMMENT },
    });

    // One answer per party: the second is refused and the first stands.
    expect(await call(menteeCookie, "POST", `/requests/${pair.requestId}/feedback`, { helpful: 1 })).toMatchObject({
      status: 409,
      body: { code: "feedback_exists" },
    });
    // The mentor answers for their own side; an empty comment is no comment.
    const mentor = await call(mentorCookie, "POST", `/requests/${pair.requestId}/feedback`, { helpful: 3, comment: "   " });
    expect(mentor).toMatchObject({ status: 201, body: { state: "left", mine: { helpful: 3, comment: null } } });
    expect((await feedbackRows()).map((r) => [r.author_id, r.helpful, r.comment])).toEqual([
      [pair.mentee, 5, MENTEE_COMMENT],
      [pair.mentor, 3, null],
    ]);
  });

  it("only_the_two_parties_reach_it", async () => {
    const pair = await completedPair();
    const stranger = await makePerson(db.pool, { firstName: "Hamza" });
    const admin = await makePerson(db.pool, { admin: true });
    for (const who of [stranger, admin]) {
      const cookie = await cookieFor(who);
      expect((await call(cookie, "GET", `/requests/${pair.requestId}/feedback`)).status).toBe(404);
      expect((await call(cookie, "POST", `/requests/${pair.requestId}/feedback`, { helpful: 4 })).status).toBe(404);
      await expect(runAs(db.pool, who, "SELECT leave_feedback($1, 4, NULL)", [pair.requestId])).rejects.toThrow(
        /mest\.not_found/,
      );
    }
    expect((await call(null, "GET", `/requests/${pair.requestId}/feedback`)).status).toBe(401);
    expect((await call(pair.menteeCookie, "GET", "/requests/not-a-uuid/feedback")).status).toBe(404);
    expect(await feedbackRows()).toEqual([]);
  });

  it("other_party_never_reads_the_comment", async () => {
    const pair = await completedPair();
    expect(
      (await call(pair.menteeCookie, "POST", `/requests/${pair.requestId}/feedback`, { helpful: 2, comment: MENTEE_COMMENT })).status,
    ).toBe(201);

    // The mentor's own state says nothing about the mentee's answer.
    const mentorView = await call(pair.mentorCookie, "GET", `/requests/${pair.requestId}/feedback`);
    expect(mentorView.body).toEqual({ state: "open", mine: null });
    // Not through the request either.
    const detail = await call(pair.mentorCookie, "GET", `/requests/${pair.requestId}`);
    expect(detail.text).not.toContain(MENTEE_COMMENT);

    // Under row-level security the table shows each member only their own
    // answers, and an administrator none at all.
    const admin = await makePerson(db.pool, { admin: true });
    for (const who of [pair.mentor, admin]) {
      const rows = await asUser(db.pool, who, (client) => client.query("SELECT * FROM relationship_feedback"));
      expect(rows.rows).toEqual([]);
    }
    const own = await asUser(db.pool, pair.mentee, (client) => client.query("SELECT comment FROM relationship_feedback"));
    expect(own.rows).toEqual([{ comment: MENTEE_COMMENT }]);
    // And nobody writes it directly.
    await expect(
      asUser(db.pool, pair.mentor, (client) =>
        client.query("UPDATE relationship_feedback SET comment = 'changed'"),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("completion_invites_the_other_party", async () => {
    const pair = await completedPair("mentor");
    const notes = await db.pool.query<{ recipient_id: string; template: string; email_status: string; link: string; read_at: Date | null }>(
      "SELECT recipient_id, template, email_status, link, read_at FROM notifications WHERE template = 'feedback-invite'",
    );
    // Only the mentee, who did not mark it, is invited, by email too.
    expect(notes.rows.map((n) => [n.recipient_id, n.email_status, n.link])).toEqual([
      [pair.mentee, "queued", `/network/me/requests/${pair.requestId}`],
    ]);

    // The email carries names and a link only.
    const outbox = await db.pool.query<{ payload: TemplateData }>(
      `SELECT o.payload FROM email_outbox o JOIN notifications n ON n.id = o.notification_id WHERE n.template = 'feedback-invite'`,
    );
    expect(outbox.rows).toHaveLength(1);
    const email = renderTemplate("feedback-invite", outbox.rows[0].payload, { appOrigin: "https://network.example.test" });
    expect(email.subject).toContain("Layla");
    expect(email.text).toContain(`https://network.example.test/network/me/requests/${pair.requestId}`);
    const addresses = (
      await db.pool.query<{ email: string }>("SELECT email::text AS email FROM users WHERE id IN ($1, $2)", [pair.mentee, pair.mentor])
    ).rows.map((r) => r.email);
    for (const secret of [WHY, MENTOR_PHONE, ...addresses]) {
      for (const part of [email.subject, email.text, email.html]) expect(part).not.toContain(secret);
    }

    // Answering marks the invitation read.
    expect((await call(pair.menteeCookie, "POST", `/requests/${pair.requestId}/feedback`, { helpful: 4 })).status).toBe(201);
    const after = await db.pool.query<{ read: boolean }>(
      "SELECT read_at IS NOT NULL AS read FROM notifications WHERE template = 'feedback-invite'",
    );
    expect(after.rows).toEqual([{ read: true }]);

    // Completed by the mentee instead, the mentor is the one invited, to their own page.
    const second = await completedPair("mentee");
    const mentorInvite = await db.pool.query<{ link: string }>(
      "SELECT link FROM notifications WHERE template = 'feedback-invite' AND recipient_id = $1",
      [second.mentor],
    );
    expect(mentorInvite.rows).toEqual([{ link: `/network/mentor/mentees/${second.requestId}` }]);
  });
});

describe("what administrators see", () => {
  it("admin_sees_aggregates_and_comments_without_authors", async () => {
    const admin = await makePerson(db.pool, { admin: true });
    const adminCookie = await cookieFor(admin);
    const empty = (await call(adminCookie, "GET", "/admin/dashboard")).body as AdminDashboard;
    expect(empty).toMatchObject({ feedbackResponses: 0, feedbackAverageHelpful: null });

    const first = await completedPair();
    const second = await makePair(db.pool, { mentor: "Yusuf", mentee: "Hamza" });
    await runAs(db.pool, second.mentee, "SELECT complete_relationship($1)", [second.requestId]);
    await runAs(db.pool, first.mentee, "SELECT leave_feedback($1, 5, $2)", [first.requestId, MENTEE_COMMENT]);
    await runAs(db.pool, first.mentor, "SELECT leave_feedback($1, 4, $2)", [first.requestId, MENTOR_COMMENT]);
    await runAs(db.pool, second.mentee, "SELECT leave_feedback($1, 2, NULL)", [second.requestId]);

    const dashboard = (await call(adminCookie, "GET", "/admin/dashboard")).body as AdminDashboard;
    // (5 + 4 + 2) / 3, one decimal.
    expect(dashboard).toMatchObject({ feedbackResponses: 3, feedbackAverageHelpful: 3.7 });

    const list = await call(adminCookie, "GET", "/admin/feedback");
    expect(list.status).toBe(200);
    const body = list.body as AdminFeedbackResponse;
    // Comments only (the answer without one is counted, not listed), newest first.
    expect(body.total).toBe(2);
    expect(body.items.map((i) => [i.authorRole, i.helpful, i.comment])).toEqual([
      ["mentor", 4, MENTOR_COMMENT],
      ["mentee", 5, MENTEE_COMMENT],
    ]);
    expect(Object.keys(body.items[0]).sort()).toEqual(["authorRole", "comment", "helpful", "id", "kind", "month"]);
    expect(body.items[0].month).toMatch(/^\d{4}-\d{2}$/);
    // Nothing in it points back at a person or the relationship.
    for (const leak of [first.mentee, first.mentor, first.requestId, first.relationshipId, "Rahman", "Haddad"]) {
      expect(list.text).not.toContain(leak);
    }

    // Paged like every list.
    const page = (await call(adminCookie, "GET", "/admin/feedback?size=1&page=2")).body as AdminFeedbackResponse;
    expect(page).toMatchObject({ total: 2, items: [{ comment: MENTEE_COMMENT }] });
    expect((await call(adminCookie, "GET", "/admin/feedback?size=99")).status).toBe(400);

    // Members get neither.
    expect((await call(first.menteeCookie, "GET", "/admin/feedback")).status).toBe(403);
    await expect(runAs(db.pool, first.mentee, "SELECT * FROM admin_feedback(1, 20)")).rejects.toThrow(/mest\.forbidden/);
    const memberDashboard = await asUser(db.pool, first.mentee, (client) =>
      client.query("SELECT feedback_responses FROM admin_dashboard"),
    );
    expect(memberDashboard.rows).toEqual([]);
  });
});

describe("deletion and export", () => {
  async function sweep(profileId: string): Promise<void> {
    const done = await asSystem(db.pool, async (client) => {
      const d = await client.query<{ id: string }>(
        `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility, immediate)
         VALUES ($1, now() - interval '1 minute', 'public', true) RETURNING id`,
        [profileId],
      );
      return (await client.query<{ done: boolean }>("SELECT execute_account_deletion($1, now()) AS done", [d.rows[0].id]))
        .rows[0].done;
    });
    expect(done).toBe(true);
  }

  it("sweep_empties_the_comment_and_keeps_the_rating", async () => {
    const pair = await completedPair();
    await runAs(db.pool, pair.mentee, "SELECT leave_feedback($1, 5, $2)", [pair.requestId, MENTEE_COMMENT]);
    // Layla's own comment names Amina, who is about to leave.
    await runAs(db.pool, pair.mentor, "SELECT leave_feedback($1, 4, $2)", [pair.requestId, MENTOR_COMMENT]);

    await sweep(pair.mentee);

    const rows = await feedbackRows();
    expect(rows.map((r) => [r.author_id, r.helpful, r.comment])).toEqual([
      [pair.mentee, 5, null],
      // The other party's comment stays, with the leaver's name taken out.
      [pair.mentor, 4, "Former member came prepared with questions; I would gladly mentor again."],
    ]);
    expect(rows[0].comment_purged_at).not.toBeNull();
    expect(rows[1].comment_purged_at).toBeNull();

    // No trace of the comment or the leaver's names anywhere in the table.
    const dump = (await db.pool.query<{ row: string }>("SELECT t::text AS row FROM relationship_feedback t")).rows
      .map((r) => r.row)
      .join("\n");
    for (const value of [MENTEE_COMMENT, "Amina", "Rahman"]) expect(dump).not.toContain(value);

    // The rating still counts.
    const admin = await makePerson(db.pool, { admin: true });
    const dashboard = (await call(await cookieFor(admin), "GET", "/admin/dashboard")).body as AdminDashboard;
    expect(dashboard).toMatchObject({ feedbackResponses: 2, feedbackAverageHelpful: 4.5 });
  });

  it("no_comment_once_the_other_party_has_left", async () => {
    const pair = await completedPair();
    await sweep(pair.mentee);

    // A comment now would name the leaver after the sweep took their names out.
    const comment = await call(pair.mentorCookie, "POST", `/requests/${pair.requestId}/feedback`, {
      helpful: 4,
      comment: MENTOR_COMMENT,
    });
    expect(comment.status).toBe(409);
    expect(comment.body).toMatchObject({ code: "comment_closed" });
    expect(await feedbackRows()).toEqual([]);

    // The rating alone still goes through.
    expect((await call(pair.mentorCookie, "POST", `/requests/${pair.requestId}/feedback`, { helpful: 4 })).status).toBe(201);
    expect((await feedbackRows()).map((r) => [r.author_id, r.helpful, r.comment])).toEqual([[pair.mentor, 4, null]]);
  });

  it("export_holds_only_own_feedback", async () => {
    const pair = await completedPair();
    await runAs(db.pool, pair.mentee, "SELECT leave_feedback($1, 5, $2)", [pair.requestId, MENTEE_COMMENT]);
    await runAs(db.pool, pair.mentor, "SELECT leave_feedback($1, 3, $2)", [pair.requestId, MENTOR_COMMENT]);

    const res = await call(pair.menteeCookie, "GET", "/me/export");
    expect(res.status).toBe(200);
    const data = res.body as DataExport;
    expect(data.feedback).toHaveLength(1);
    expect(data.feedback[0]).toMatchObject({
      requestId: pair.requestId,
      role: "mentee",
      counterparty: "Layla Haddad",
      helpful: 5,
      comment: MENTEE_COMMENT,
    });
    expect(res.text).not.toContain(MENTOR_COMMENT);

    const mentor = (await call(pair.mentorCookie, "GET", "/me/export")).body as DataExport;
    expect(mentor.feedback.map((f) => [f.role, f.counterparty, f.helpful, f.comment])).toEqual([
      ["mentor", "Amina Rahman", 3, MENTOR_COMMENT],
    ]);
  });
});
