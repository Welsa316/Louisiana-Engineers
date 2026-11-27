import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asSystem, asUser, createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson, rowsAs, runAs, scalarAs } from "./fixtures";
import {
  MENTOR_PHONE,
  STUDENT_GOALS,
  WHY,
  acceptRequest,
  declineRequest,
  makeMentor,
  makeStudent,
  resetRequestConfig,
  sendRequest,
} from "./request-fixtures";

/**
 * Who can read requests, relationships and the people on either side of
 * them (02 sections 5.3 and 5.4, Task 19). Every read runs as `app_user`
 * with the relevant `app.user_id`.
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

const releaseAs = (userId: string | null, profileId: string) =>
  rowsAs<{ method: string; value: string }>(db.pool, userId, "SELECT method::text AS method, value FROM release_contact($1)", [
    profileId,
  ]);

describe("the counterparty rule", () => {
  it("student_visible_to_mentor_of_pending_request", async () => {
    const mentor = await makeMentor(db.pool);
    const student = await makeStudent(db.pool, { firstName: "Amina" });
    const bystander = await makeMentor(db.pool);

    const studentAs = (viewer: string) =>
      rowsAs(db.pool, viewer, "SELECT p.first_name, s.goals FROM profiles p JOIN student_details s ON s.profile_id = p.id WHERE p.id = $1", [
        student,
      ]);
    const accessAs = (viewer: string | null) => scalarAs<string>(db.pool, viewer, "SELECT profile_access($1) AS value", [student]);

    // Before any request the student is invisible to the mentor.
    expect(await studentAs(mentor)).toEqual([]);
    expect(await accessAs(mentor)).toBe("none");

    const requestId = await sendRequest(db.pool, student, mentor);

    // While it is pending the mentor sees the student and their details.
    expect(await studentAs(mentor)).toEqual([{ first_name: "Amina", goals: STUDENT_GOALS }]);
    expect(await accessAs(mentor)).toBe("visible");
    // Nobody else does.
    expect(await studentAs(bystander)).toEqual([]);
    expect(await accessAs(bystander)).toBe("none");
    expect(await accessAs(null)).toBe("none");

    // A declined request ends it.
    await declineRequest(db.pool, mentor, requestId);
    expect(await studentAs(mentor)).toEqual([]);
    expect(await accessAs(mentor)).toBe("none");
  });

  it("counterparty_profile_access_visible_while_accepted", async () => {
    // A hidden professional mentee is visible to their mentor while the
    // relationship lasts, and only then.
    const mentor = await makeMentor(db.pool);
    const mentee = await makePerson(db.pool, { visibility: "hidden", firstName: "Hidden" });
    const access = () => scalarAs<string>(db.pool, mentor, "SELECT profile_access($1) AS value", [mentee]);
    expect(await access()).toBe("none");

    const requestId = await sendRequest(db.pool, mentee, mentor);
    await acceptRequest(db.pool, mentor, requestId);
    expect(await access()).toBe("visible");
    expect(await rowsAs(db.pool, mentor, "SELECT first_name FROM profile_entries WHERE id = $1", [mentee])).toEqual([
      { first_name: "Hidden" },
    ]);

    await runAs(db.pool, mentee, "SELECT complete_relationship($1)", [requestId]);
    expect(await access()).toBe("none");
  });

  it("suspended_member_loses_counterparty_reads", async () => {
    const mentor = await makeMentor(db.pool);
    const student = await makeStudent(db.pool);
    await sendRequest(db.pool, student, mentor);
    await asSystem(db.pool, (client) => client.query("UPDATE users SET suspended_at = now() WHERE id = $1", [mentor]));
    expect(await rowsAs(db.pool, mentor, "SELECT profile_id FROM student_details")).toEqual([]);
  });
});

describe("requests and relationships", () => {
  it("requests_readable_by_parties_only", async () => {
    const mentor = await makeMentor(db.pool);
    const student = await makeStudent(db.pool);
    const other = await makeStudent(db.pool);
    const admin = await makePerson(db.pool, { admin: true });
    const requestId = await sendRequest(db.pool, student, mentor);
    await acceptRequest(db.pool, mentor, requestId);

    const requestsAs = (viewer: string | null) => rowsAs(db.pool, viewer, "SELECT id FROM mentorship_requests");
    expect(await requestsAs(student)).toEqual([{ id: requestId }]);
    expect(await requestsAs(mentor)).toEqual([{ id: requestId }]);
    expect(await requestsAs(other)).toEqual([]);
    expect(await requestsAs(null)).toEqual([]);
    // Administrators read requests only through the masked view (Task 24).
    expect(await requestsAs(admin)).toEqual([]);

    const relationshipsAs = (viewer: string | null) =>
      rowsAs(db.pool, viewer, "SELECT request_id, shared_methods::text[] AS shared FROM mentorship_relationships");
    expect(await relationshipsAs(student)).toEqual([{ request_id: requestId, shared: ["email"] }]);
    expect(await relationshipsAs(other)).toEqual([]);
    expect(await relationshipsAs(admin)).toEqual([{ request_id: requestId, shared: ["email"] }]);

    // my_requests is the caller's own, in both directions.
    expect(await rowsAs(db.pool, other, "SELECT id FROM my_requests")).toEqual([]);
    expect(await rowsAs(db.pool, admin, "SELECT id FROM my_requests")).toEqual([]);
    expect(await rowsAs(db.pool, null, "SELECT id FROM my_requests")).toEqual([]);
  });

  it("a_declined_request_always_has_a_real_reason", async () => {
    const mentor = await makeMentor(db.pool);
    const student = await makeStudent(db.pool);
    const id = await sendRequest(db.pool, student, mentor);
    await expect(
      asSystem(db.pool, (client) =>
        client.query("UPDATE mentorship_requests SET status = 'declined', decline_reason = '', responded_at = now() WHERE id = $1", [id]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("app_user_cannot_write_requests_directly", async () => {
    const mentor = await makeMentor(db.pool);
    const student = await makeStudent(db.pool);
    const requestId = await sendRequest(db.pool, student, mentor);

    await expect(runAs(db.pool, mentor, "UPDATE mentorship_requests SET status = 'accepted' WHERE id = $1", [requestId])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      runAs(
        db.pool,
        student,
        `INSERT INTO mentorship_requests (mentee_id, mentor_id, kind, topic_id, why, format, mode, expires_at)
         VALUES ($1, $2, 'mentorship', 'graduate-school', $3, 'one-time', 'online', now())`,
        [student, mentor, WHY],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runAs(db.pool, student, "INSERT INTO mentorship_relationships (request_id, mentee_id, mentor_id) VALUES ($1, $2, $3)", [
        requestId,
        student,
        mentor,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(runAs(db.pool, student, "DELETE FROM mentorship_requests WHERE id = $1", [requestId])).rejects.toThrow(
      /permission denied/,
    );
    // The jobs' functions are not the member's to call.
    await expect(runAs(db.pool, student, "SELECT expire_request($1)", [requestId])).rejects.toThrow(/permission denied/);
    await expect(runAs(db.pool, student, "SELECT purge_request_text(now())")).rejects.toThrow(/permission denied/);
  });

  it("my_requests_shows_counterparty_public_fields_only", async () => {
    const mentor = await makeMentor(db.pool, {
      firstName: "Layla",
      lastName: "Haddad",
      title: "Senior Coastal Engineer",
      organization: "Crescent Coastal",
      methods: ["mest", "email", "phone"],
      share: [],
      contactEmail: "layla.private@example.test",
    });
    const student = await makeStudent(db.pool, { firstName: "Amina", lastName: "Rahman" });
    const requestId = await sendRequest(db.pool, student, mentor);
    await declineRequest(db.pool, mentor, requestId, "not_fit");

    // The mentee still sees who the closed request was with.
    const [asMentee] = await rowsAs<Record<string, unknown>>(db.pool, student, "SELECT * FROM my_requests");
    expect(asMentee).toMatchObject({
      id: requestId,
      role: "mentee",
      status: "declined",
      counterparty_id: mentor,
      counterparty_first_name: "Layla",
      counterparty_last_name: "Haddad",
      counterparty_title: "Senior Coastal Engineer",
      counterparty_organization: "Crescent Coastal",
      decline_reason: "not_fit",
    });
    // Nothing in the row carries an address or a phone number.
    const text = JSON.stringify(asMentee);
    expect(text).not.toContain("@example.test");
    expect(text).not.toContain(MENTOR_PHONE);

    const [asMentor] = await rowsAs<Record<string, unknown>>(db.pool, mentor, "SELECT * FROM my_requests");
    expect(asMentor).toMatchObject({ role: "mentor", counterparty_first_name: "Amina", counterparty_title: null });
    expect(JSON.stringify(asMentor)).not.toContain("@example.test");
  });
});

describe("contact release with a relationship", () => {
  it("release_contact_adds_the_relationship_shared_methods", async () => {
    const mentor = await makeMentor(db.pool, { methods: ["mest", "email", "phone"], share: ["email"] });
    const mentee = await makeStudent(db.pool);
    const member = await makeStudent(db.pool);

    // Before: any member gets the methods shared with members.
    expect((await releaseAs(mentee, mentor)).map((r) => r.method)).toEqual(["email"]);

    const requestId = await sendRequest(db.pool, mentee, mentor);
    // A pending request releases nothing more.
    expect((await releaseAs(mentee, mentor)).map((r) => r.method)).toEqual(["email"]);

    await acceptRequest(db.pool, mentor, requestId, ["phone"]);
    expect(await releaseAs(mentee, mentor)).toEqual([
      { method: "email", value: expect.stringContaining("@example.test") },
      { method: "phone", value: MENTOR_PHONE },
    ]);
    // Only to that mentee.
    expect((await releaseAs(member, mentor)).map((r) => r.method)).toEqual(["email"]);
    // The handoff never goes the other way.
    expect(await releaseAs(mentor, mentee)).toEqual([]);

    // A method the mentor stops using is no longer handed over.
    await asUser(db.pool, mentor, (client) =>
      client.query("UPDATE contact_preferences SET methods = '{mest,email}', phone = NULL WHERE profile_id = $1", [mentor]),
    );
    expect((await releaseAs(mentee, mentor)).map((r) => r.method)).toEqual(["email"]);
    await asUser(db.pool, mentor, (client) =>
      client.query("UPDATE contact_preferences SET methods = '{mest,email,phone}', phone = $2 WHERE profile_id = $1", [
        mentor,
        MENTOR_PHONE,
      ]),
    );
    expect((await releaseAs(mentee, mentor)).map((r) => r.method)).toEqual(["email", "phone"]);

    // Completing the relationship ends the handoff.
    await runAs(db.pool, mentee, "SELECT complete_relationship($1)", [requestId]);
    expect((await releaseAs(mentee, mentor)).map((r) => r.method)).toEqual(["email"]);
  });

  it("handoff_reaches_a_mentor_who_is_not_listed", async () => {
    // A members-only or later-hidden mentor still hands over what they chose.
    const mentor = await makeMentor(db.pool, { methods: ["mest", "phone"], share: [] });
    const mentee = await makeStudent(db.pool);
    const requestId = await sendRequest(db.pool, mentee, mentor);
    await acceptRequest(db.pool, mentor, requestId, ["phone"]);
    await asUser(db.pool, mentor, (client) => client.query("UPDATE profiles SET visibility = 'hidden' WHERE id = $1", [mentor]));
    expect(await releaseAs(mentee, mentor)).toEqual([{ method: "phone", value: MENTOR_PHONE }]);
  });
});

describe("the owner's preview matches what another member gets", () => {
  it("preview_matches_second_member_for_every_state", async () => {
    const states: { name: string; options: Parameters<typeof makeMentor>[1] }[] = [
      { name: "public", options: {} },
      { name: "members", options: { visibility: "members" } },
      { name: "hidden", options: { visibility: "hidden" } },
      { name: "pending", options: { approval: "pending" } },
      { name: "admin-hidden", options: { adminHidden: true } },
    ];
    const member = await makeStudent(db.pool);

    for (const state of states) {
      const owner = await makeMentor(db.pool, { methods: ["mest", "email", "phone"], share: ["email", "phone"], ...state.options });

      const previewMember = await scalarAs<string>(db.pool, owner, "SELECT preview_my_access('member') AS value");
      const previewVisitor = await scalarAs<string>(db.pool, owner, "SELECT preview_my_access('visitor') AS value");
      const actualMember = await scalarAs<string>(db.pool, member, "SELECT profile_access($1) AS value", [owner]);
      const actualVisitor = await scalarAs<string>(db.pool, null, "SELECT profile_access($1) AS value", [owner]);
      expect({ state: state.name, member: previewMember, visitor: previewVisitor }).toEqual({
        state: state.name,
        member: actualMember,
        visitor: actualVisitor,
      });

      const previewContact = await rowsAs(db.pool, owner, "SELECT method::text AS method, value FROM preview_my_contact()");
      const actualContact = await releaseAs(member, owner);
      expect({ state: state.name, contact: previewContact }).toEqual({ state: state.name, contact: actualContact });
    }

    // The two states that list the profile release something; the rest nothing.
    const listed = await makeMentor(db.pool, { methods: ["mest", "email"], share: ["email"] });
    expect((await rowsAs(db.pool, listed, "SELECT method::text AS method FROM preview_my_contact()")).length).toBe(1);
  });
});

describe("capacity", () => {
  it("has_capacity_counts_active_mentorships_only", async () => {
    const mentor = await makeMentor(db.pool, { maxActive: 1 });
    const visitorSees = () =>
      scalarAs<boolean>(db.pool, null, "SELECT has_capacity AS value FROM directory_entries WHERE id = $1", [mentor]);
    expect(await visitorSees()).toBe(true);

    // An accepted introduction takes no slot.
    const friend = await makePerson(db.pool);
    const intro = await sendRequest(db.pool, friend, mentor, { kind: "introduction", topic: null });
    await acceptRequest(db.pool, mentor, intro);
    expect(await visitorSees()).toBe(true);

    const student = await makeStudent(db.pool);
    const requestId = await sendRequest(db.pool, student, mentor);
    await acceptRequest(db.pool, mentor, requestId);
    expect(await visitorSees()).toBe(false);

    await runAs(db.pool, mentor, "SELECT complete_relationship($1)", [requestId]);
    expect(await visitorSees()).toBe(true);

    // A suspended mentor takes nobody, whatever the numbers.
    await asSystem(db.pool, (client) => client.query("UPDATE users SET suspended_at = now() WHERE id = $1", [mentor]));
    expect(await visitorSees()).toBe(false);
  });
});
