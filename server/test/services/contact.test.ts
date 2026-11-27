import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProfileContactResponse, ProfileView, SaveResponse } from "@shared/types/directory";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { createProfileRoutes } from "../../src/routes/profiles";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, type PersonOptions } from "../policies/fixtures";

/**
 * `GET /api/profiles/:id/contact` and the save toggle (Task 13): contact
 * values reach signed-in members only, and only the methods the
 * professional shares with members, through release_contact.
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
});

const ORIGIN = "http://127.0.0.1:8787";
const app = testApp(new Hono().route("/profiles", createProfileRoutes()));

async function cookieFor(userId: string): Promise<string> {
  const session = await asSystem(db.pool, (client) => createSession(wrapClient(client), userId, null));
  return `mest_session=${session.value}`;
}

async function call(method: string, path: string, viewer: string | null, origin: string | null = ORIGIN): Promise<Response> {
  const headers: Record<string, string> = {};
  if (viewer) headers.cookie = await cookieFor(viewer);
  if (origin) headers.origin = origin;
  return app.request(path, { method, headers });
}

interface ContactOptions {
  methods: string[];
  share: string[];
  contactEmail?: string | null;
  phone?: string | null;
  booking?: string | null;
  linkedin?: string | null;
}

async function professionalWith(options: ContactOptions, person: PersonOptions = {}): Promise<string> {
  const email = `account.${Math.random().toString(36).slice(2)}@example.test`;
  const id = await makePerson(db.pool, { email, ...person });
  await asSystem(db.pool, async (client) => {
    if (options.linkedin) await client.query("UPDATE profiles SET linkedin_url = $2 WHERE id = $1", [id, options.linkedin]);
    await client.query(
      `INSERT INTO contact_preferences (profile_id, methods, share_with_members, contact_email, phone, booking_url)
       VALUES ($1, $2::contact_method[], $3::contact_method[], $4, $5, $6)`,
      [id, options.methods, options.share, options.contactEmail ?? null, options.phone ?? null, options.booking ?? null],
    );
  });
  return id;
}

const member = (options: PersonOptions = {}) => makePerson(db.pool, { kind: "student", visibility: "hidden", ...options });

describe("GET /api/profiles/:id/contact", () => {
  it("contact_empty_for_visitor_and_shared_only_for_member", async () => {
    const layla = await professionalWith({
      methods: ["mest", "email", "linkedin", "booking", "phone"],
      share: ["email", "booking"],
      contactEmail: "layla.work@example.test",
      phone: "+15045550100",
      booking: "https://cal.example.test/layla",
      linkedin: "https://www.linkedin.com/in/layla",
    });

    // A visitor gets no contact at all.
    const visitor = await call("GET", `/api/profiles/${layla}/contact`, null);
    expect(visitor.status).toBe(401);
    const visitorText = await visitor.text();
    expect(JSON.parse(visitorText)).toEqual({ code: "unauthenticated" });
    expect(visitorText).not.toMatch(/layla\.work|cal\.example|5045550100|linkedin/);

    // A signed-in account that is not a member (unverified) gets none either.
    const unverified = await member({ verified: false });
    expect((await call("GET", `/api/profiles/${layla}/contact`, unverified)).status).toBe(403);

    // A member gets exactly the shared methods: not the LinkedIn link or the
    // phone the professional uses but did not share, and the contact
    // address rather than the account address.
    const viewer = await member();
    const res = await call("GET", `/api/profiles/${layla}/contact`, viewer);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProfileContactResponse;
    expect(body).toEqual({
      methods: [
        { method: "email", value: "layla.work@example.test" },
        { method: "booking", value: "https://cal.example.test/layla" },
      ],
    });

    // Members-only profiles release to members the same way.
    const tariq = await professionalWith({ methods: ["mest", "email"], share: ["email"] }, { visibility: "members", email: "tariq.account@example.test" });
    const tariqContact = (await (await call("GET", `/api/profiles/${tariq}/contact`, viewer)).json()) as ProfileContactResponse;
    expect(tariqContact.methods).toEqual([{ method: "email", value: "tariq.account@example.test" }]);

    // The release is audited once per member and profile, naming methods only.
    await call("GET", `/api/profiles/${layla}/contact`, viewer);
    const audit = await db.pool.query<{ detail: unknown }>(
      "SELECT detail FROM audit_log WHERE action = 'contact.viewed' AND actor_id = $1 AND subject_id = $2",
      [viewer, layla],
    );
    expect(audit.rows).toEqual([{ detail: { methods: ["email", "booking"] } }]);
  });

  it("phone is released only when the professional shares it with members", async () => {
    const withPhone = await professionalWith({ methods: ["mest", "phone"], share: ["phone"], phone: "+15045550111" });
    const withoutShare = await professionalWith({ methods: ["mest", "phone"], share: [], phone: "+15045550122" });
    const viewer = await member();

    const shared = (await (await call("GET", `/api/profiles/${withPhone}/contact`, viewer)).json()) as ProfileContactResponse;
    expect(shared.methods).toEqual([{ method: "phone", value: "+15045550111" }]);
    const notShared = (await (await call("GET", `/api/profiles/${withoutShare}/contact`, viewer)).json()) as ProfileContactResponse;
    expect(notShared.methods).toEqual([]);
  });

  it("answers 404 for a profile the member cannot see, and nothing for an administrator beyond a member", async () => {
    const pending = await professionalWith({ methods: ["mest", "email"], share: ["email"] }, { approval: "pending" });
    const hidden = await professionalWith({ methods: ["mest", "email"], share: ["email"] }, { visibility: "hidden" });
    const viewer = await member();
    for (const id of [pending, hidden, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      expect((await call("GET", `/api/profiles/${id}/contact`, viewer)).status, id).toBe(404);
    }

    // An administrator sees the pending profile but gets no contact values from it.
    const admin = await member({ admin: true });
    const res = await call("GET", `/api/profiles/${pending}/contact`, admin);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ methods: [] });
  });
});

describe("POST and DELETE /api/profiles/:id/save", () => {
  it("saves and unsaves for a member, and the profile reports it", async () => {
    const pro = await makePerson(db.pool);
    const viewer = await member();

    const saved = await call("POST", `/api/profiles/${pro}/save`, viewer);
    expect(saved.status).toBe(200);
    expect((await saved.json()) as SaveResponse).toEqual({ saved: true });
    // Saving twice is harmless.
    expect((await call("POST", `/api/profiles/${pro}/save`, viewer)).status).toBe(200);
    const rows = await db.pool.query("SELECT saver_id FROM saved_profiles WHERE saved_id = $1", [pro]);
    expect(rows.rows).toEqual([{ saver_id: viewer }]);

    const view = (await (await call("GET", `/api/profiles/${pro}`, viewer)).json()) as ProfileView;
    expect(view.saved).toBe(true);
    // Nobody else sees that it was saved.
    const other = await member();
    expect(((await (await call("GET", `/api/profiles/${pro}`, other)).json()) as ProfileView).saved).toBe(false);
    expect(((await (await call("GET", `/api/profiles/${pro}`, pro)).json()) as ProfileView).saved).toBe(false);

    const removed = await call("DELETE", `/api/profiles/${pro}/save`, viewer);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ saved: false });
    expect((await db.pool.query("SELECT 1 FROM saved_profiles")).rowCount).toBe(0);
  });

  it("refuses visitors, other origins, and profiles that cannot be saved", async () => {
    const pro = await makePerson(db.pool);
    const pending = await makePerson(db.pool, { approval: "pending" });
    const viewer = await member();

    expect((await call("POST", `/api/profiles/${pro}/save`, null)).status).toBe(401);
    expect((await call("POST", `/api/profiles/${pro}/save`, viewer, "https://evil.example")).status).toBe(403);
    expect((await call("POST", `/api/profiles/${pro}/save`, viewer, null)).status).toBe(403);
    for (const id of [pending, viewer, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const res = await call("POST", `/api/profiles/${id}/save`, viewer);
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ code: "not_found" });
    }
    expect((await db.pool.query("SELECT 1 FROM saved_profiles")).rowCount).toBe(0);
  });
});
