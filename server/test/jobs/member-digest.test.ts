import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wrapClient } from "../../src/db/tx";
import "../../src/email/templates/all";
import { renderTemplate, type TemplateData } from "../../src/email/templates/registry";
import { memberDigestJob } from "../../src/jobs/member-digest";
import { clearJobs, registerJob, runJobOnce } from "../../src/jobs/scheduler";
import { exportMyData } from "../../src/services/export";
import { getOwnSettings, patchSettings } from "../../src/services/profiles";
import { asSystem, asUser, createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson, runAs } from "../policies/fixtures";
import {
  MENTOR_PHONE,
  STUDENT_GOALS,
  WHY,
  acceptRequest,
  makeMentor,
  makeStudent,
  resetRequestConfig,
  sendRequest,
  setConfig,
} from "../policies/request-fixtures";

/**
 * The opt-in member digest (Task 35): `member_digest(as_of)`, run daily by
 * the `member-digest` job, sends each member who turned
 * `email_member_digest` on at most one digest a week, and only when there
 * is something new: professionals newly listed in the member's discipline
 * (professionals) and mentors who started taking requests for the member's
 * topics (students). Names and titles only.
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
  clearJobs();
  registerJob(memberDigestJob);
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const start = new Date();
const at = (ms: number) => new Date(start.getTime() + ms);

async function run(now: Date): Promise<{ sent: number }> {
  const outcome = await runJobOnce("member-digest", { now });
  expect(outcome.status).toBe("ran");
  return outcome.status === "ran" ? (outcome.result as { sent: number }) : { sent: -1 };
}

/** Turns the digest on (or off) for a member, creating the preference row onboarding would. */
async function optIn(profileId: string, on = true): Promise<void> {
  await asSystem(db.pool, (client) =>
    client.query(
      `INSERT INTO notification_preferences (profile_id, email_member_digest) VALUES ($1, $2)
       ON CONFLICT (profile_id) DO UPDATE SET email_member_digest = EXCLUDED.email_member_digest`,
      [profileId, on],
    ),
  );
}

/** Records the profile's first approval at `when` (what admin_review_profile writes). */
async function listedAt(profileId: string, when: Date): Promise<void> {
  await asSystem(db.pool, (client) =>
    client.query(
      `INSERT INTO profile_reviews (profile_id, decision, submitted_at, decided_at)
       VALUES ($1, 'approved', $2::timestamptz - interval '1 day', $2)`,
      [profileId, when],
    ),
  );
}

/** When the mentor's offer last switched to active. */
async function activeSince(profileId: string, when: Date): Promise<void> {
  await asSystem(db.pool, (client) =>
    client.query("UPDATE mentorship_settings SET active_since = $2 WHERE profile_id = $1", [profileId, when]),
  );
}

interface Digest {
  id: string;
  category: string;
  title: string;
  body: string;
  link: string;
  email_status: string;
  payload: TemplateData & {
    professionals?: { id: string; name: string; title: string }[];
    mentors?: { id: string; name: string; title: string }[];
  };
}

async function digests(recipient: string): Promise<Digest[]> {
  return (
    await db.pool.query<Digest>(
      `SELECT id, category::text AS category, title, body, link, email_status, payload
         FROM notifications WHERE recipient_id = $1 AND template = 'member-digest' ORDER BY created_at, id`,
      [recipient],
    )
  ).rows;
}

const names = (items: { name: string }[] | undefined) => (items ?? []).map((i) => i.name).sort();

describe("member-digest job", () => {
  it("member_digest_job_is_daily_and_system_only", async () => {
    expect(memberDigestJob.name).toBe("member-digest");
    expect(memberDigestJob.everyMs).toBe(86_400_000);
    const member = await makePerson(db.pool);
    await expect(runAs(db.pool, member, "SELECT member_digest()")).rejects.toThrow(/permission denied/);
    await expect(
      asSystem(db.pool, async (client) => {
        await client.query("SELECT set_config('app.user_id', $1, true)", [member]);
        await client.query("SELECT member_digest()");
      }),
    ).rejects.toThrow(/mest\.forbidden/);
  });

  it("member_digest_is_off_by_default", async () => {
    const reader = await makePerson(db.pool, { disciplineId: "civil" });
    // The row onboarding creates, with the column defaults.
    await asSystem(db.pool, (client) => client.query("INSERT INTO notification_preferences (profile_id) VALUES ($1)", [reader]));
    await makePerson(db.pool, { disciplineId: "civil", firstName: "Nadia" });
    expect(await run(at(HOUR))).toEqual({ sent: 0 });
    expect(await digests(reader)).toEqual([]);

    await optIn(reader);
    expect(await run(at(2 * HOUR))).toEqual({ sent: 1 });
    await optIn(reader, false);
    expect(await run(at(8 * DAY))).toEqual({ sent: 0 });
  });

  it("professional_gets_professionals_newly_listed_in_their_discipline", async () => {
    const reader = await makePerson(db.pool, { disciplineId: "civil", firstName: "Reader" });
    await optIn(reader);
    const fresh = await makePerson(db.pool, { disciplineId: "civil", firstName: "Nadia", lastName: "Fresh", title: "Bridge Engineer" });
    await listedAt(fresh, at(-2 * DAY));
    const membersOnly = await makePerson(db.pool, { disciplineId: "civil", firstName: "Omar", lastName: "Members", visibility: "members" });
    await listedAt(membersOnly, at(-DAY));
    // Not news: listed a month ago, re-approved this week after an edit.
    const old = await makePerson(db.pool, { disciplineId: "civil", firstName: "Olga", lastName: "Old" });
    await listedAt(old, at(-30 * DAY));
    await listedAt(old, at(-DAY));
    // Not for this reader: another discipline, not listed, or not in good standing.
    await makePerson(db.pool, { disciplineId: "coastal", firstName: "Cora", lastName: "Coastal" });
    await makePerson(db.pool, { disciplineId: "civil", firstName: "Pia", lastName: "Pending", approval: "pending" });
    await makePerson(db.pool, { disciplineId: "civil", firstName: "Hana", lastName: "Hidden", visibility: "hidden" });
    await makePerson(db.pool, { disciplineId: "civil", firstName: "Ari", lastName: "Adminhidden", adminHidden: true });
    await makePerson(db.pool, { disciplineId: "civil", firstName: "Sol", lastName: "Suspended", suspended: true });
    await makePerson(db.pool, { disciplineId: "civil", firstName: "Nora", lastName: "Notlisted", participation: ["networking"] });

    expect(await run(at(HOUR))).toEqual({ sent: 1 });
    const [digest] = await digests(reader);
    expect(digest.category).toBe("member_digest");
    expect(digest.link).toBe("/network/directory");
    expect(digest.email_status).toBe("queued");
    expect(names(digest.payload.professionals)).toEqual(["Nadia Fresh", "Omar Members"]);
    expect(digest.payload.professionals?.find((p) => p.name === "Nadia Fresh")?.title).toBe("Bridge Engineer");
    expect(digest.payload.disciplineLabel).toBe("Civil & structural");
    expect(digest.payload.mentors ?? []).toEqual([]);
    // The reader is never listed in their own digest.
    expect(digest.payload.professionals?.some((p) => p.id === reader)).toBe(false);

    const email = await db.pool.query<{ to_email: string; template: string }>(
      "SELECT to_email::text AS to_email, template FROM email_outbox WHERE notification_id = $1",
      [digest.id],
    );
    expect(email.rows).toHaveLength(1);
    expect(email.rows[0].template).toBe("member-digest");
  });

  it("student_gets_mentors_who_started_taking_requests_for_their_topics", async () => {
    const student = await makeStudent(db.pool, { topicsNeeded: ["internships-and-first-jobs", "graduate-school"] });
    await optIn(student);
    // New: switched to active this week, listed long ago.
    const resumed = await makeMentor(db.pool, { firstName: "Rami", lastName: "Resumed", title: "Process Engineer", topics: ["graduate-school"] });
    await listedAt(resumed, at(-60 * DAY));
    await activeSince(resumed, at(-DAY));
    // New: listed this week, active since before approval.
    const approved = await makeMentor(db.pool, { firstName: "Lina", lastName: "Listed", topics: ["internships-and-first-jobs"] });
    await listedAt(approved, at(-3 * DAY));
    await activeSince(approved, at(-20 * DAY));
    // Not news: active and listed for a month.
    const steady = await makeMentor(db.pool, { firstName: "Sara", lastName: "Steady" });
    await listedAt(steady, at(-30 * DAY));
    await activeSince(steady, at(-30 * DAY));
    // Not taking requests, or not for these topics.
    const paused = await makeMentor(db.pool, { firstName: "Paul", lastName: "Paused", status: "paused" });
    await listedAt(paused, at(-DAY));
    const other = await makeMentor(db.pool, { firstName: "Tom", lastName: "Othertopic", topics: ["starting-a-company"] });
    await listedAt(other, at(-DAY));
    const full = await makeMentor(db.pool, { firstName: "Fay", lastName: "Full", maxActive: 1 });
    await listedAt(full, at(-DAY));
    const mentee = await makeStudent(db.pool);
    await acceptRequest(db.pool, full, await sendRequest(db.pool, mentee, full));

    expect(await run(at(HOUR))).toEqual({ sent: 1 });
    const [digest] = await digests(student);
    expect(names(digest.payload.mentors)).toEqual(["Lina Listed", "Rami Resumed"]);
    expect(digest.payload.mentors?.find((m) => m.name === "Rami Resumed")?.title).toBe("Process Engineer");
    expect(digest.payload.professionals ?? []).toEqual([]);

    // A paused network takes no requests, so it lists no mentors.
    await setConfig(db.pool, "platform_paused", true);
    const second = await makeStudent(db.pool);
    await optIn(second);
    expect(await run(at(2 * HOUR))).toEqual({ sent: 0 });
  });

  it("member_digest_at_most_weekly_and_only_what_is_new_since_the_last", async () => {
    const reader = await makePerson(db.pool, { disciplineId: "civil" });
    await optIn(reader);
    const first = await makePerson(db.pool, { disciplineId: "civil", firstName: "First", lastName: "One" });
    await listedAt(first, at(-2 * DAY));

    expect(await run(at(HOUR))).toEqual({ sent: 1 });
    const second = await makePerson(db.pool, { disciplineId: "civil", firstName: "Second", lastName: "Two" });
    await listedAt(second, at(2 * DAY));

    // Daily runs inside the week send nothing more.
    for (const day of [1, 3, 6]) expect(await run(at(day * DAY + HOUR)), `day ${day}`).toEqual({ sent: 0 });
    expect(await run(at(7 * DAY + HOUR))).toEqual({ sent: 1 });
    expect(await run(at(7 * DAY + 2 * HOUR))).toEqual({ sent: 0 });

    const sent = await digests(reader);
    expect(sent.map((d) => names(d.payload.professionals))).toEqual([["First One"], ["Second Two"]]);
  });

  it("member_digest_sends_nothing_when_nothing_is_new", async () => {
    const reader = await makePerson(db.pool, { disciplineId: "civil" });
    await optIn(reader);
    const old = await makePerson(db.pool, { disciplineId: "civil" });
    await listedAt(old, at(-30 * DAY));
    expect(await run(at(HOUR))).toEqual({ sent: 0 });
    expect(await digests(reader)).toEqual([]);

    // An empty run does not start the week: something new the next day goes out then.
    const fresh = await makePerson(db.pool, { disciplineId: "civil", firstName: "Next", lastName: "Day" });
    await listedAt(fresh, at(DAY));
    expect(await run(at(DAY + HOUR))).toEqual({ sent: 1 });
    expect(names((await digests(reader))[0].payload.professionals)).toEqual(["Next Day"]);
  });

  it("member_digest_caps_each_list_and_counts_the_rest", async () => {
    const reader = await makePerson(db.pool, { disciplineId: "civil" });
    await optIn(reader);
    for (let i = 0; i < 12; i += 1) {
      const id = await makePerson(db.pool, { disciplineId: "civil", firstName: `P${String(i).padStart(2, "0")}`, lastName: "Civil" });
      await listedAt(id, at(-DAY - i * HOUR));
    }
    expect(await run(at(HOUR))).toEqual({ sent: 1 });
    const [digest] = await digests(reader);
    expect(digest.payload.professionals).toHaveLength(10);
    expect(digest.payload.professionalsMore).toBe(2);
    // Newest first.
    expect(digest.payload.professionals?.[0].name).toBe("P00 Civil");
    const email = renderTemplate("member-digest", digest.payload, { appOrigin: "https://network.example.test" });
    expect(email.text).toContain("And 2 more.");
  });

  it("member_digest_skips_members_not_in_good_standing", async () => {
    const suspended = await makePerson(db.pool, { disciplineId: "civil", suspended: true });
    const unverified = await makePerson(db.pool, { disciplineId: "civil", verified: false });
    for (const id of [suspended, unverified]) await optIn(id);
    const fresh = await makePerson(db.pool, { disciplineId: "civil" });
    await listedAt(fresh, at(-DAY));
    expect(await run(at(HOUR))).toEqual({ sent: 0 });
  });
});

describe("member digest privacy", () => {
  it("member_digest_privacy_no_contact_value_no_request_text", async () => {
    const student = await makeStudent(db.pool, { email: "student.reader@example.test", firstName: "Amira" });
    await optIn(student);
    const mentor = await makeMentor(db.pool, {
      email: "mentor.account@example.test",
      firstName: "Layla",
      lastName: "Haddad",
      title: "Senior Coastal Engineer",
      methods: ["mest", "email", "phone", "booking", "linkedin"],
      share: ["email", "phone", "booking", "linkedin"],
      contactEmail: "layla.contact@example.test",
      bookingUrl: "https://example.test/book/layla-private",
    });
    await asSystem(db.pool, (client) =>
      client.query("UPDATE profiles SET linkedin_url = 'https://www.linkedin.com/in/layla-private' WHERE id = $1", [mentor]),
    );
    await listedAt(mentor, at(-DAY));
    // The reader has a request waiting with this mentor, with all its free text.
    const note = "Weeknights after 7, call me on my cell.";
    await sendRequest(db.pool, student, mentor, { why: WHY, goals: "Land a summer internship on the coast.", schedulingNote: note });

    expect(await run(at(HOUR))).toEqual({ sent: 1 });
    const [digest] = await digests(student);
    expect(names(digest.payload.mentors)).toEqual(["Layla Haddad"]);
    // Each listed person is an id, a name and a title; nothing else.
    for (const item of digest.payload.mentors ?? []) expect(Object.keys(item).sort()).toEqual(["id", "name", "title"]);
    expect(Object.keys(digest.payload).sort()).toEqual(["firstName", "link", "mentors"]);

    const outbox = await db.pool.query<{ payload: TemplateData }>("SELECT payload FROM email_outbox WHERE notification_id = $1", [
      digest.id,
    ]);
    const email = renderTemplate("member-digest", outbox.rows[0].payload, { appOrigin: "https://network.example.test" });
    expect(email.text).toContain("Layla Haddad");
    expect(email.text).toContain("Senior Coastal Engineer");

    const secrets = [
      WHY,
      "Land a summer internship on the coast.",
      note,
      STUDENT_GOALS,
      MENTOR_PHONE,
      "layla.contact@example.test",
      "mentor.account@example.test",
      "student.reader@example.test",
      "https://example.test/book/layla-private",
      "linkedin.com/in/layla-private",
    ];
    const stored = JSON.stringify([digest.title, digest.body, digest.payload, outbox.rows[0].payload]).toLowerCase();
    const rendered = [email.subject, email.text, email.html].join("\n").toLowerCase();
    for (const secret of secrets) {
      expect(stored, `stored digest carries ${secret}`).not.toContain(secret.toLowerCase());
      expect(rendered, `rendered digest carries ${secret}`).not.toContain(secret.toLowerCase());
    }
  });
});

describe("member digest settings, deletion and export", () => {
  it("member_digest_preference_is_the_owners_switch", async () => {
    const reader = await makeStudent(db.pool);
    await asSystem(db.pool, (client) => client.query("INSERT INTO notification_preferences (profile_id) VALUES ($1)", [reader]));
    const before = await asUser(db.pool, reader, (client) => getOwnSettings(wrapClient(client)));
    expect(before.notifications?.memberDigest).toBe(false);
    const after = await asUser(db.pool, reader, (client) =>
      patchSettings(wrapClient(client), { notifications: { memberDigest: true } }),
    );
    expect(after.notifications?.memberDigest).toBe(true);
    // The weekly stamp is the job's, never the owner's.
    await expect(
      runAs(db.pool, reader, "UPDATE notification_preferences SET member_digest_sent_at = now() WHERE profile_id = app_uid()"),
    ).rejects.toThrow(/permission denied/);
    // Nor can a mentor make themselves look new every week.
    const mentor = await makeMentor(db.pool);
    await expect(
      runAs(db.pool, mentor, "UPDATE mentorship_settings SET active_since = now() WHERE profile_id = app_uid()"),
    ).rejects.toThrow(/permission denied/);
  });

  it("member_digest_active_since_follows_the_offer_switching_on", async () => {
    const mentor = await makeMentor(db.pool);
    const read = async () =>
      (await db.pool.query<{ a: Date | null }>("SELECT active_since AS a FROM mentorship_settings WHERE profile_id = $1", [mentor]))
        .rows[0].a;
    const first = await read();
    expect(first).not.toBeNull();
    // An edit to the offer is not news.
    await runAs(db.pool, mentor, "UPDATE mentorship_settings SET availability = 'Mornings' WHERE profile_id = app_uid()");
    expect(await read()).toEqual(first);
    await runAs(db.pool, mentor, "SELECT set_mentorship_status('paused', NULL)");
    expect(await read()).toBeNull();
    await runAs(db.pool, mentor, "SELECT set_mentorship_status('active', NULL)");
    const resumed = await read();
    expect(resumed).not.toBeNull();
    expect(resumed!.getTime()).toBeGreaterThan(first!.getTime());
  });

  it("member_digest_category_follows_its_own_switch", async () => {
    const reader = await makePerson(db.pool);
    const notify = () =>
      asSystem(db.pool, async (client) => {
        const r = await client.query<{ id: string }>(
          `SELECT create_notification($1, 'member_digest', 'Digest', '', '/network/directory', 'member-digest', '{}'::jsonb, true) AS id`,
          [reader],
        );
        return (await client.query<{ s: string }>("SELECT email_status AS s FROM notifications WHERE id = $1", [r.rows[0].id])).rows[0].s;
      });
    // No preference row: the column default (off) applies, unlike the other categories.
    expect(await notify()).toBe("skipped");
    await optIn(reader);
    expect(await notify()).toBe("queued");
    await asSystem(db.pool, (client) =>
      client.query("UPDATE notification_preferences SET email_reminders = false, email_admin_digest = false WHERE profile_id = $1", [reader]),
    );
    expect(await notify()).toBe("queued");
    await optIn(reader, false);
    expect(await notify()).toBe("skipped");
  });

  it("member_digest_sweep_removes_the_leaver_from_other_members_digests", async () => {
    const reader = await makePerson(db.pool, { disciplineId: "civil" });
    await optIn(reader);
    const leaver = await makePerson(db.pool, { disciplineId: "civil", firstName: "Leah", lastName: "Leaving", title: "Leaving Title" });
    const stays = await makePerson(db.pool, { disciplineId: "civil", firstName: "Sam", lastName: "Staying" });
    await listedAt(leaver, at(-DAY));
    await listedAt(stays, at(-DAY));
    // The leaver also gets digests of their own.
    await optIn(leaver);
    expect(await run(at(HOUR))).toEqual({ sent: 2 });
    expect(names((await digests(reader))[0].payload.professionals)).toEqual(["Leah Leaving", "Sam Staying"]);

    const done = await asSystem(db.pool, async (client) => {
      const d = await client.query<{ id: string }>(
        `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility, immediate)
         VALUES ($1, now() - interval '1 minute', 'public', true) RETURNING id`,
        [leaver],
      );
      return (await client.query<{ done: boolean }>("SELECT execute_account_deletion($1, now()) AS done", [d.rows[0].id])).rows[0]
        .done;
    });
    expect(done).toBe(true);

    // The other member's digest and its email no longer name the leaver.
    const [digest] = await digests(reader);
    expect(names(digest.payload.professionals)).toEqual(["Sam Staying"]);
    const outbox = await db.pool.query<{ payload: TemplateData }>("SELECT payload FROM email_outbox WHERE notification_id = $1", [
      digest.id,
    ]);
    for (const stored of [digest, outbox.rows[0].payload]) {
      const text = JSON.stringify(stored);
      for (const value of ["Leah", "Leaving", leaver]) expect(text, `still carries ${value}`).not.toContain(value);
    }
    // The leaver's own preference row, its weekly stamp and their digests are gone.
    expect((await db.pool.query("SELECT 1 FROM notification_preferences WHERE profile_id = $1", [leaver])).rowCount).toBe(0);
    expect(await digests(leaver)).toEqual([]);
  });

  it("member_digest_export_holds_only_the_callers_switch", async () => {
    const reader = await makeStudent(db.pool);
    const other = await makeStudent(db.pool);
    await optIn(reader);
    await optIn(other, false);
    const data = await asUser(db.pool, reader, (client) => exportMyData(wrapClient(client)));
    expect(data.settings?.notifications?.memberDigest).toBe(true);
    expect(JSON.stringify(data)).not.toContain(other);
  });
});
