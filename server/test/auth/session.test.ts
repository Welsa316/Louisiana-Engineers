import { createHash } from "node:crypto";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requireAdmin, requireMember, requireUser, userIdOf } from "../../src/auth/middleware";
import { createAuthRoutes } from "../../src/routes/auth";
import { createConfigRoutes } from "../../src/routes/config";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson } from "../policies/fixtures";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await truncateAll(db.pool);
  await db.pool.query("UPDATE config SET value = 'false' WHERE key = 'platform_paused'");
});

const ORIGIN = "http://127.0.0.1:8787";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** A sub-app guarded by each middleware, standing in for a later area's routes. */
const guarded = new Hono()
  .get("/user", requireUser, (c) => c.json({ id: userIdOf(c) }))
  .post("/user", requireUser, (c) => c.json({ id: userIdOf(c) }))
  .get("/member", requireMember, (c) => c.json({ id: userIdOf(c) }))
  .get("/admin", requireAdmin, (c) => c.json({ id: userIdOf(c) }));

const app = testApp(
  new Hono()
    .route("/auth", createAuthRoutes({ trustProxy: true }))
    .route("/config", createConfigRoutes({ googleClientId: undefined, googleClientSecret: undefined }))
    .route("/guarded", guarded),
);

function cookieFrom(res: Response): string {
  const header = res.headers.getSetCookie().find((c) => c.startsWith("mest_session="));
  if (!header) throw new Error("no mest_session cookie");
  return header;
}

function cookieValue(setCookie: string): string {
  return setCookie.split(";")[0].slice("mest_session=".length);
}

async function signInByLink(email: string, cookie?: string): Promise<Response> {
  const sent = await app.request("/api/auth/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ email }),
  });
  expect(sent.status).toBe(202);
  const last = await app.request(`/api/auth/dev-last-link?email=${encodeURIComponent(email)}`);
  const { link } = (await last.json()) as { link: string };
  const token = new URL(link).searchParams.get("token") ?? "";
  return app.request("/api/auth/callback", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: ORIGIN,
      "user-agent": "vitest",
      ...(cookie ? { cookie: `mest_session=${cookie}` } : {}),
    },
    body: new URLSearchParams({ token }).toString(),
  });
}

function me(cookie?: string) {
  return app.request("/api/auth/me", { headers: cookie ? { cookie: `mest_session=${cookie}` } : {} });
}

describe("sessions", () => {
  it("callback_creates_user_profile_and_cookie", async () => {
    const res = await signInByLink("New.Member@Example.test");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/network/onboarding");

    const setCookie = cookieFrom(res);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=2592000/);
    const value = cookieValue(setCookie);
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // users: one verified row; profiles: one row with kind null.
    const users = await db.pool.query<{ id: string; email: string; email_verified_at: Date | null; last_sign_in_at: Date | null }>(
      "SELECT id, email::text, email_verified_at, last_sign_in_at FROM users",
    );
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0].email.toLowerCase()).toBe("new.member@example.test");
    expect(users.rows[0].email_verified_at).not.toBeNull();
    expect(users.rows[0].last_sign_in_at).not.toBeNull();
    const userId = users.rows[0].id;
    const profiles = await db.pool.query<{ id: string; kind: string | null; approval_state: string }>(
      "SELECT id, kind, approval_state FROM profiles",
    );
    expect(profiles.rows).toEqual([{ id: userId, kind: null, approval_state: "pending" }]);

    // The session row is keyed by the sha256 of the cookie, 30 days out.
    const sessions = await db.pool.query<{ id: string; user_id: string; expires_at: Date; created_at: Date; user_agent: string }>(
      "SELECT id, user_id, expires_at, created_at, user_agent FROM sessions",
    );
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0].id).toBe(sha256(value));
    expect(sessions.rows[0].user_id).toBe(userId);
    expect(sessions.rows[0].user_agent).toBe("vitest");
    const days = (sessions.rows[0].expires_at.getTime() - sessions.rows[0].created_at.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);

    // The cookie identifies the user to /me, with no email in the answer.
    const answer = await me(value);
    const body = (await answer.json()) as { user: Record<string, unknown> };
    expect(body).toEqual({
      user: {
        id: userId,
        kind: null,
        approvalState: "pending",
        isAdmin: false,
        mentorStatus: null,
        hasDeletionScheduled: false,
      },
    });
    expect(JSON.stringify(body).toLowerCase()).not.toContain("example.test");

    // Signing in again finds the same account and rotates the session.
    const again = await signInByLink("new.member@example.test", value);
    const second = cookieValue(cookieFrom(again));
    expect(second).not.toBe(value);
    expect((await db.pool.query("SELECT 1 FROM users")).rowCount).toBe(1);
    const rows = await db.pool.query<{ id: string }>("SELECT id FROM sessions");
    expect(rows.rows.map((r) => r.id)).toEqual([sha256(second)]);
    expect(((await (await me(value)).json()) as { user: unknown }).user).toBeNull();
  });

  it("callback_redirects_onboarded_members_home_and_deleting_members_to_the_grace_screen", async () => {
    const onboarded = await makePerson(db.pool, { email: "onboarded@example.test", kind: "student" });
    const res = await signInByLink("onboarded@example.test");
    expect(res.headers.get("location")).toBe("/network/me");
    const value = cookieValue(cookieFrom(res));
    const body = (await (await me(value)).json()) as { user: { id: string; kind: string } };
    expect(body.user.id).toBe(onboarded);
    expect(body.user.kind).toBe("student");

    const deleting = await makePerson(db.pool, { email: "leaving@example.test", kind: "professional" });
    await asSystem(db.pool, (client) =>
      client.query(
        `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility)
         VALUES ($1, now() + interval '14 days', 'public')`,
        [deleting],
      ),
    );
    const leaving = await signInByLink("leaving@example.test");
    expect(leaving.headers.get("location")).toBe("/network/scheduled-for-deletion");
    const leavingMe = (await (await me(cookieValue(cookieFrom(leaving)))).json()) as {
      user: { hasDeletionScheduled: boolean };
    };
    expect(leavingMe.user.hasDeletionScheduled).toBe(true);
  });

  it("signout_clears_session", async () => {
    const value = cookieValue(cookieFrom(await signInByLink("bye@example.test")));
    expect((await db.pool.query("SELECT 1 FROM sessions")).rowCount).toBe(1);

    // Sign-out without a matching Origin is refused and changes nothing.
    const forged = await app.request("/api/auth/signout", {
      method: "POST",
      headers: { cookie: `mest_session=${value}`, origin: "https://evil.example" },
    });
    expect(forged.status).toBe(403);
    expect((await db.pool.query("SELECT 1 FROM sessions")).rowCount).toBe(1);

    const res = await app.request("/api/auth/signout", {
      method: "POST",
      headers: { cookie: `mest_session=${value}`, origin: ORIGIN },
    });
    expect(res.status).toBe(200);
    const cleared = cookieFrom(res);
    expect(cleared).toMatch(/Max-Age=0/);
    expect(cookieValue(cleared)).toBe("");
    expect((await db.pool.query("SELECT 1 FROM sessions")).rowCount).toBe(0);

    // The old cookie no longer works anywhere.
    expect(((await (await me(value)).json()) as { user: unknown }).user).toBeNull();
    const guardedRes = await app.request("/api/guarded/user", { headers: { cookie: `mest_session=${value}` } });
    expect(guardedRes.status).toBe(401);
  });

  it("me_null_without_cookie", async () => {
    const res = await me();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ user: null });

    // A malformed, unknown or expired cookie is the same as none.
    expect(await (await me("not a cookie")).json()).toEqual({ user: null });
    expect(await (await me("A".repeat(43))).json()).toEqual({ user: null });
    const value = cookieValue(cookieFrom(await signInByLink("expired@example.test")));
    await db.pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect(await (await me(value)).json()).toEqual({ user: null });
  });

  it("require_user_member_and_admin_answer_401_and_403", async () => {
    expect((await app.request("/api/guarded/user")).status).toBe(401);
    expect(await (await app.request("/api/guarded/user")).json()).toEqual({ code: "unauthenticated" });

    // A suspended account is signed in but not a member.
    const suspended = await makePerson(db.pool, { email: "suspended@example.test", suspended: true });
    const suspendedCookie = cookieValue(cookieFrom(await signInByLink("suspended@example.test")));
    const asSuspended = { headers: { cookie: `mest_session=${suspendedCookie}` } };
    expect(await (await app.request("/api/guarded/user", asSuspended)).json()).toEqual({ id: suspended });
    const notMember = await app.request("/api/guarded/member", asSuspended);
    expect(notMember.status).toBe(403);
    expect(await notMember.json()).toEqual({ code: "not_member" });

    const member = await makePerson(db.pool, { email: "member@example.test" });
    const memberCookie = cookieValue(cookieFrom(await signInByLink("member@example.test")));
    const asMember = { headers: { cookie: `mest_session=${memberCookie}` } };
    expect(await (await app.request("/api/guarded/member", asMember)).json()).toEqual({ id: member });
    const notAdmin = await app.request("/api/guarded/admin", asMember);
    expect(notAdmin.status).toBe(403);
    expect(await notAdmin.json()).toEqual({ code: "not_admin" });

    const admin = await makePerson(db.pool, { email: "admin@example.test", admin: true });
    const adminCookie = cookieValue(cookieFrom(await signInByLink("admin@example.test")));
    const asAdmin = { headers: { cookie: `mest_session=${adminCookie}` } };
    expect(await (await app.request("/api/guarded/admin", asAdmin)).json()).toEqual({ id: admin });
    expect(((await (await me(adminCookie)).json()) as { user: { isAdmin: boolean } }).user.isAdmin).toBe(true);

    // Non-GET requests through requireUser also need a matching Origin.
    const noOrigin = await app.request("/api/guarded/user", { method: "POST", ...asMember });
    expect(noOrigin.status).toBe(403);
    expect(await noOrigin.json()).toEqual({ code: "bad_origin" });
    const withOrigin = await app.request("/api/guarded/user", {
      method: "POST",
      headers: { ...asMember.headers, origin: ORIGIN },
    });
    expect(withOrigin.status).toBe(200);
  });

  it("public_config_reports_google_and_pause", async () => {
    const res = await app.request("/api/config/public");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ googleEnabled: false, platformPaused: false });

    await db.pool.query("UPDATE config SET value = 'true' WHERE key = 'platform_paused'");
    const google = testApp(
      new Hono().route("/config", createConfigRoutes({ googleClientId: "id", googleClientSecret: "secret" })),
    );
    expect(await (await google.request("/api/config/public")).json()).toEqual({
      googleEnabled: true,
      platformPaused: true,
    });
  });
});
