import { createHash } from "node:crypto";
import { Google, OAuth2RequestError, OAuth2Tokens } from "arctic";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthRoutes, type AuthRouteOptions } from "../../src/routes/auth";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";

/**
 * Google sign-in (section 5.1). The only thing mocked is the network call at
 * the `arctic` boundary: `Google.validateAuthorizationCode`, which would
 * exchange the code at Google's token endpoint. The authorization URL, the
 * state cookie, the PKCE pair and the ID-token decoding are the real code.
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

afterEach(() => {
  vi.restoreAllMocks();
});

const ORIGIN = "http://127.0.0.1:8787";
const CLIENT_ID = "test-client.apps.googleusercontent.com";
const CLIENT_SECRET = "test-client-secret";
const FAILED = "/network/signin?error=google";

function appWith(google: AuthRouteOptions["google"]) {
  return testApp(new Hono().route("/auth", createAuthRoutes({ appOrigin: ORIGIN, google })));
}

const app = appWith({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** An ID token as Google's token endpoint returns it (the signature is not checked; see google.ts). */
function idToken(claims: Record<string, unknown>): string {
  return [b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })), b64url(JSON.stringify(claims)), b64url("sig")].join(".");
}

function claimsFor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-sub-1",
    email: "layla@example.test",
    email_verified: true,
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

/** Makes the code exchange answer with these claims, and records what it was called with. */
function googleAnswers(claims: Record<string, unknown>) {
  return vi
    .spyOn(Google.prototype, "validateAuthorizationCode")
    .mockResolvedValue(new OAuth2Tokens({ access_token: "at", token_type: "Bearer", expires_in: 3600, id_token: idToken(claims) }));
}

function cookiePairs(res: Response): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const at = pair.indexOf("=");
    pairs.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return pairs;
}

/** `GET /api/auth/google`: returns the state Google would echo and the cookie the browser keeps. */
async function startGoogle(target = app) {
  const res = await target.request("/api/auth/google");
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location") ?? "");
  const setCookie = res.headers.getSetCookie().find((line) => line.startsWith("mest_google_oauth="));
  expect(setCookie).toBeDefined();
  const value = cookiePairs(res).get("mest_google_oauth") ?? "";
  return { res, location, setCookie: setCookie ?? "", cookie: `mest_google_oauth=${value}`, state: location.searchParams.get("state") ?? "" };
}

function finishGoogle(params: Record<string, string>, cookie: string | null, target = app) {
  return target.request(`/api/auth/google/callback?${new URLSearchParams(params).toString()}`, {
    headers: cookie ? { cookie } : {},
  });
}

async function me(sessionCookie: string) {
  const res = await app.request("/api/auth/me", { headers: { cookie: `mest_session=${sessionCookie}` } });
  return ((await res.json()) as { user: { id: string; kind: string | null } | null }).user;
}

async function insertUser(email: string, kind: "student" | "professional" | null = "student"): Promise<string> {
  return asSystem(db.pool, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO users (email, email_verified_at) VALUES ($1, now()) RETURNING id",
      [email],
    );
    await client.query("INSERT INTO profiles (id, kind) VALUES ($1, $2)", [rows[0].id, kind]);
    return rows[0].id;
  });
}

async function users() {
  return (
    await db.pool.query<{ id: string; email: string | null; google_sub: string | null; email_verified_at: Date | null }>(
      "SELECT id, email::text, google_sub, email_verified_at FROM users ORDER BY created_at",
    )
  ).rows;
}

describe("google sign-in", () => {
  it("google_redirects_to_google_with_state_and_pkce_in_a_short_cookie", async () => {
    const { location, setCookie, state } = await startGoogle();
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((location.searchParams.get("scope") ?? "").split(" ").sort()).toEqual(["email", "openid"]);
    expect(state.length).toBeGreaterThanOrEqual(32);

    // Ten minutes, httpOnly, Lax (Google's redirect back is a top-level GET), scoped to the callback.
    expect(setCookie).toMatch(/Max-Age=600/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\/api\/auth\/google/);
    // The browser keeps the verifier, never the URL.
    expect(location.toString()).not.toContain(setCookie.split(";")[0].split("=")[1]);
  });

  it("google_links_existing_user_by_verified_email", async () => {
    const existing = await insertUser("Layla@Example.test", "student");
    const exchange = googleAnswers(claimsFor({ email: "layla@example.test", sub: "google-sub-1" }));

    const start = await startGoogle();
    const res = await finishGoogle({ code: "code-1", state: start.state }, start.cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/network/me");

    // The exchange got the code and the verifier whose S256 hash was sent to Google.
    expect(exchange).toHaveBeenCalledTimes(1);
    const [code, verifier] = exchange.mock.calls[0];
    expect(code).toBe("code-1");
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(start.location.searchParams.get("code_challenge"));

    // No second account: the existing row is linked to the Google subject.
    const rows = await users();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing);
    expect(rows[0].google_sub).toBe("google-sub-1");

    // The session cookie signs that account in, and the state cookie is cleared.
    const cookies = cookiePairs(res);
    const session = cookies.get("mest_session");
    expect(session).toBeTruthy();
    expect((await me(session ?? ""))?.id).toBe(existing);
    expect(cookies.get("mest_google_oauth")).toBe("");

    // Signing in again finds the account by its Google subject, even after
    // the Google address changed.
    googleAnswers(claimsFor({ email: "layla.new@example.test", sub: "google-sub-1" }));
    const again = await startGoogle();
    const second = await finishGoogle({ code: "code-2", state: again.state }, again.cookie);
    expect(second.headers.get("location")).toBe("/network/me");
    expect((await me(cookiePairs(second).get("mest_session") ?? ""))?.id).toBe(existing);
    expect(await users()).toHaveLength(1);
  });

  it("google_cannot_take_over_an_account_linked_to_another_google_identity", async () => {
    // A verified address can move between Google accounts (a Workspace domain
    // changes hands, a non-Gmail address is re-registered). A second subject
    // reporting the same address must not replace the first link.
    const existing = await insertUser("owner@example.test", "student");
    googleAnswers(claimsFor({ email: "owner@example.test", sub: "google-sub-first" }));
    const first = await startGoogle();
    const linked = await finishGoogle({ code: "code-a", state: first.state }, first.cookie);
    expect(linked.headers.get("location")).toBe("/network/me");

    googleAnswers(claimsFor({ email: "owner@example.test", sub: "google-sub-intruder" }));
    const second = await startGoogle();
    const res = await finishGoogle({ code: "code-b", state: second.state }, second.cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/network/signin?error=google");
    expect(cookiePairs(res).get("mest_session") ?? "").toBe("");

    const rows = await users();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing);
    expect(rows[0].google_sub).toBe("google-sub-first");
  });

  it("google_secure_state_cookie_over_https", async () => {
    const https = testApp(
      new Hono().route(
        "/auth",
        createAuthRoutes({ appOrigin: "https://mest.example", google: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET } }),
      ),
    );
    const res = await https.request("/api/auth/google");
    const line = res.headers.getSetCookie().find((l) => l.startsWith("mest_google_oauth=")) ?? "";
    expect(line).toMatch(/;\s*Secure/);
  });

  it("google_creates_an_account_for_a_new_verified_address", async () => {
    googleAnswers(claimsFor({ email: "new@example.test", sub: "google-sub-new" }));
    const start = await startGoogle();
    const res = await finishGoogle({ code: "code-1", state: start.state }, start.cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/network/onboarding");

    const rows = await users();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("new@example.test");
    expect(rows[0].google_sub).toBe("google-sub-new");
    expect(rows[0].email_verified_at).not.toBeNull();
    const profile = await db.pool.query<{ kind: string | null }>("SELECT kind FROM profiles WHERE id = $1", [rows[0].id]);
    expect(profile.rows).toEqual([{ kind: null }]);
    expect((await me(cookiePairs(res).get("mest_session") ?? ""))?.id).toBe(rows[0].id);
  });

  it("google_rejects_unverified_email", async () => {
    const existing = await insertUser("layla@example.test");
    for (const email_verified of [false, "true", undefined]) {
      googleAnswers(claimsFor({ email: "layla@example.test", email_verified }));
      const start = await startGoogle();
      const res = await finishGoogle({ code: "code-1", state: start.state }, start.cookie);
      expect(res.status, String(email_verified)).toBe(302);
      expect(res.headers.get("location")).toBe(FAILED);
      expect(cookiePairs(res).get("mest_session")).toBeUndefined();
      vi.restoreAllMocks();
    }

    // An unverified address for someone new creates nothing either.
    googleAnswers(claimsFor({ email: "stranger@example.test", sub: "google-sub-2", email_verified: false }));
    const start = await startGoogle();
    const res = await finishGoogle({ code: "code-1", state: start.state }, start.cookie);
    expect(res.headers.get("location")).toBe(FAILED);

    const rows = await users();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing);
    expect(rows[0].google_sub).toBeNull();
    expect((await db.pool.query("SELECT 1 FROM sessions")).rowCount).toBe(0);
  });

  it("google_rejects_a_bad_state_a_missing_cookie_or_a_failed_exchange", async () => {
    const exchange = googleAnswers(claimsFor());
    const start = await startGoogle();

    // State that does not match the cookie (a forged callback), and no cookie at all.
    const forged = await finishGoogle({ code: "code-1", state: "x".repeat(start.state.length) }, start.cookie);
    expect(forged.headers.get("location")).toBe(FAILED);
    const cookieless = await finishGoogle({ code: "code-1", state: start.state }, null);
    expect(cookieless.headers.get("location")).toBe(FAILED);
    // Google reported an error (the person pressed Cancel).
    const canceled = await finishGoogle({ error: "access_denied", state: start.state }, start.cookie);
    expect(canceled.headers.get("location")).toBe(FAILED);
    expect(exchange).not.toHaveBeenCalled();

    // The code exchange fails.
    vi.restoreAllMocks();
    vi.spyOn(Google.prototype, "validateAuthorizationCode").mockRejectedValue(
      new OAuth2RequestError("invalid_grant", null, null, null),
    );
    const refused = await finishGoogle({ code: "code-1", state: start.state }, start.cookie);
    expect(refused.headers.get("location")).toBe(FAILED);

    // An ID token issued to another client, or by someone other than Google, or expired.
    for (const bad of [
      { aud: "someone-else.apps.googleusercontent.com" },
      { iss: "https://evil.example" },
      { exp: Math.floor(Date.now() / 1000) - 60 },
      { sub: "" },
    ]) {
      vi.restoreAllMocks();
      googleAnswers(claimsFor(bad));
      const again = await startGoogle();
      const res = await finishGoogle({ code: "code-1", state: again.state }, again.cookie);
      expect(res.headers.get("location"), JSON.stringify(bad)).toBe(FAILED);
    }

    expect(await users()).toHaveLength(0);
    expect((await db.pool.query("SELECT 1 FROM sessions")).rowCount).toBe(0);
  });

  it("google_does_not_revive_a_deleted_account", async () => {
    // A deleted account keeps a tombstone row with its Google subject.
    const tombstone = await asSystem(db.pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO users (email, google_sub, deleted_at) VALUES (NULL, 'google-sub-1', now()) RETURNING id",
      );
      return rows[0].id;
    });
    googleAnswers(claimsFor({ email: "layla@example.test", sub: "google-sub-1" }));
    const start = await startGoogle();
    const res = await finishGoogle({ code: "code-1", state: start.state }, start.cookie);
    expect(res.headers.get("location")).toBe("/network/onboarding");

    const user = await me(cookiePairs(res).get("mest_session") ?? "");
    expect(user?.id).toBeTruthy();
    expect(user?.id).not.toBe(tombstone);
    const rows = await users();
    expect(rows.find((row) => row.id === tombstone)?.google_sub).toBeNull();
    expect(rows.find((row) => row.id === user?.id)?.google_sub).toBe("google-sub-1");
  });

  it("google_disabled_without_client_id", async () => {
    const exchange = googleAnswers(claimsFor());
    for (const disabled of [appWith(null), appWith({ clientSecret: CLIENT_SECRET }), appWith({ clientId: CLIENT_ID })]) {
      const start = await disabled.request("/api/auth/google");
      expect(start.status).toBe(404);
      expect(await start.json()).toEqual({ code: "not_found" });
      expect(start.headers.getSetCookie()).toEqual([]);

      const callback = await disabled.request("/api/auth/google/callback?code=c&state=s", {
        headers: { cookie: "mest_google_oauth=s.v" },
      });
      expect(callback.status).toBe(404);
      expect(await callback.json()).toEqual({ code: "not_found" });
    }
    expect(exchange).not.toHaveBeenCalled();
    expect(await users()).toHaveLength(0);
  });
});
