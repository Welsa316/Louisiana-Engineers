import { createHash } from "node:crypto";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuthRoutes } from "../../src/routes/auth";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await truncateAll(db.pool);
  await db.pool.query("UPDATE config SET value = '5' WHERE key = 'magic_links_per_hour'");
});

const ORIGIN = "http://127.0.0.1:8787";

/** The auth routes as the API mounts them, trusting X-Forwarded-For so tests can vary the IP. */
const app = testApp(new Hono().route("/auth", createAuthRoutes({ trustProxy: true })));

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function requestLink(email: string, ip = "203.0.113.7") {
  return app.request("/api/auth/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": ip },
    body: JSON.stringify({ email }),
  });
}

async function lastLink(email: string): Promise<string> {
  const res = await app.request(`/api/auth/dev-last-link?email=${encodeURIComponent(email)}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { link: string };
  return body.link;
}

function tokenOf(link: string): string {
  const token = new URL(link).searchParams.get("token");
  if (!token) throw new Error(`no token in ${link}`);
  return token;
}

function submitToken(token: string) {
  return app.request("/api/auth/callback", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
    body: new URLSearchParams({ token }).toString(),
  });
}

async function tokenRows() {
  return (
    await db.pool.query<{ email: string; token_hash: string; used_at: Date | null; expires_at: Date; created_at: Date }>(
      "SELECT email::text, token_hash, used_at, expires_at, created_at FROM auth_tokens ORDER BY created_at",
    )
  ).rows;
}

describe("magic link", () => {
  it("magic_link_enqueues_email_and_stores_hash_only", async () => {
    const res = await requestLink("Layla@Example.test");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({});

    const link = await lastLink("layla@example.test");
    expect(link.startsWith(`${ORIGIN}/api/auth/callback?token=`)).toBe(true);
    const token = tokenOf(link);
    // 32 random bytes, base64url without padding.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // auth_tokens holds the sha256 of the token, never the token itself.
    const rows = await tokenRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].email.toLowerCase()).toBe("layla@example.test");
    expect(rows[0].token_hash).toBe(sha256(token));
    expect(rows[0].used_at).toBeNull();
    const ttl = rows[0].expires_at.getTime() - rows[0].created_at.getTime();
    expect(ttl).toBe(15 * 60 * 1000);
    const dump = JSON.stringify(
      (await db.pool.query("SELECT * FROM auth_tokens")).rows,
    );
    expect(dump).not.toContain(token);

    // The email is queued in the outbox with the magic-link template.
    const outbox = await db.pool.query<{ to_email: string; template: string; payload: { link: string }; notification_id: string | null }>(
      "SELECT to_email::text, template, payload, notification_id FROM email_outbox",
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].to_email.toLowerCase()).toBe("layla@example.test");
    expect(outbox.rows[0].template).toBe("magic-link");
    expect(outbox.rows[0].payload.link).toBe(link);
    expect(outbox.rows[0].notification_id).toBeNull();

    // Requesting a link creates no account: that waits for the callback.
    const users = await db.pool.query("SELECT 1 FROM users");
    expect(users.rowCount).toBe(0);
  });

  it("magic_link_always_answers_202_for_valid_addresses_and_400_for_invalid", async () => {
    const bad = await requestLink("not-an-address");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe("validation");

    const noOrigin = await app.request("/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.test" }),
    });
    expect(noOrigin.status).toBe(403);
    expect(await noOrigin.json()).toEqual({ code: "bad_origin" });

    const foreign = await app.request("/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ email: "a@example.test" }),
    });
    expect(foreign.status).toBe(403);
    expect((await tokenRows()).length).toBe(0);
  });

  it("magic_link_get_does_not_consume", async () => {
    await requestLink("scanner@example.test");
    const link = await lastLink("scanner@example.test");
    const token = tokenOf(link);

    // A mail scanner prefetches the link, twice.
    for (let i = 0; i < 2; i += 1) {
      const res = await app.request(new URL(link).pathname + new URL(link).search);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(res.headers.get("set-cookie")).toBeNull();
      const html = await res.text();
      expect(html).toContain("Continue to MEST Network");
      expect(html).toMatch(/<form[^>]+method="post"[^>]+action="\/api\/auth\/callback"/);
      expect(html).toContain(`name="token" value="${token}"`);
    }
    const rows = await tokenRows();
    expect(rows[0].used_at).toBeNull();
    expect((await db.pool.query("SELECT 1 FROM users")).rowCount).toBe(0);
    expect((await db.pool.query("SELECT 1 FROM sessions")).rowCount).toBe(0);

    // The person then submits the form and is signed in.
    const res = await submitToken(token);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/network/onboarding");
    expect(res.headers.get("set-cookie")).toContain("mest_session=");
  });

  it("magic_link_single_use_and_expiry", async () => {
    await requestLink("once@example.test");
    const token = tokenOf(await lastLink("once@example.test"));

    const first = await submitToken(token);
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe("/network/onboarding");

    // The second submit of the same link fails and sets no cookie.
    const second = await submitToken(token);
    expect(second.status).toBe(303);
    expect(second.headers.get("location")).toBe("/network/signin?error=link");
    expect(second.headers.get("set-cookie")).toBeNull();
    expect((await db.pool.query("SELECT 1 FROM sessions")).rowCount).toBe(1);

    // A link older than 15 minutes fails.
    await requestLink("late@example.test");
    const lateToken = tokenOf(await lastLink("late@example.test"));
    await asSystem(db.pool, (client) =>
      client.query(
        `UPDATE auth_tokens SET created_at = created_at - interval '15 minutes 1 second',
                                expires_at = expires_at - interval '15 minutes 1 second'
          WHERE token_hash = $1`,
        [sha256(lateToken)],
      ),
    );
    const late = await submitToken(lateToken);
    expect(late.headers.get("location")).toBe("/network/signin?error=link");
    expect(late.headers.get("set-cookie")).toBeNull();
    expect((await db.pool.query("SELECT 1 FROM users WHERE email = 'late@example.test'")).rowCount).toBe(0);

    // Unknown and malformed tokens fail the same way.
    for (const bogus of ["A".repeat(43), "short", ""]) {
      const res = await submitToken(bogus);
      expect(res.headers.get("location"), bogus).toBe("/network/signin?error=link");
    }
    const page = await app.request("/api/auth/callback?token=%3Cscript%3E");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/network/signin?error=link");

    // A form posted from another site is refused before the token is touched.
    await requestLink("csrf@example.test");
    const csrfToken = tokenOf(await lastLink("csrf@example.test"));
    const forged = await app.request("/api/auth/callback", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
      body: new URLSearchParams({ token: csrfToken }).toString(),
    });
    expect(forged.headers.get("location")).toBe("/network/signin?error=link");
    expect(forged.headers.get("set-cookie")).toBeNull();
    const csrfRow = await db.pool.query("SELECT used_at FROM auth_tokens WHERE token_hash = $1", [sha256(csrfToken)]);
    expect(csrfRow.rows[0].used_at).toBeNull();
  });

  it("concurrent_submits_of_one_link_sign_in_once", async () => {
    await requestLink("race@example.test");
    const token = tokenOf(await lastLink("race@example.test"));
    const results = await Promise.all([submitToken(token), submitToken(token), submitToken(token)]);
    const signedIn = results.filter((res) => res.headers.get("location") === "/network/onboarding");
    expect(signedIn).toHaveLength(1);
    expect((await db.pool.query("SELECT 1 FROM sessions")).rowCount).toBe(1);
    expect((await db.pool.query("SELECT 1 FROM users")).rowCount).toBe(1);
  });

  it("rate_limit_per_email_and_ip", async () => {
    // Five links an hour for one address, from five different IPs.
    for (let i = 0; i < 5; i += 1) {
      const res = await requestLink("busy@example.test", `198.51.100.${i + 1}`);
      expect(res.status, `link ${i + 1}`).toBe(202);
    }
    const sixth = await requestLink("BUSY@example.test", "198.51.100.99");
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ code: "rate_limited" });

    // Five links an hour from one IP, for five different addresses.
    for (let i = 0; i < 5; i += 1) {
      const res = await requestLink(`person${i}@example.test`, "192.0.2.50");
      expect(res.status, `ip link ${i + 1}`).toBe(202);
    }
    const fromSameIp = await requestLink("someone-else@example.test", "192.0.2.50");
    expect(fromSameIp.status).toBe(429);

    // Refused requests store nothing and queue nothing.
    expect((await tokenRows()).length).toBe(10);
    expect((await db.pool.query("SELECT 1 FROM email_outbox")).rowCount).toBe(10);

    // Links older than an hour no longer count.
    await db.pool.query("UPDATE auth_tokens SET created_at = created_at - interval '61 minutes'");
    expect((await requestLink("busy@example.test", "192.0.2.50")).status).toBe(202);

    // The limit is the config row, not a constant.
    await db.pool.query("UPDATE config SET value = '1' WHERE key = 'magic_links_per_hour'");
    expect((await requestLink("fresh@example.test", "192.0.2.99")).status).toBe(202);
    expect((await requestLink("fresh@example.test", "192.0.2.98")).status).toBe(429);
  });

  it("concurrent_requests_from_one_ip_respect_the_ip_limit", async () => {
    // Different addresses take different address locks, so without an IP
    // lock all of these would read the same count and slip through.
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => requestLink(`burst${i}@example.test`, "198.51.100.77")),
    );
    const statuses = results.map((res) => res.status).sort();
    expect(statuses.filter((status) => status === 202)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(3);
  });

  it("spoofed_forwarded_for_entries_cannot_dodge_the_ip_limit", async () => {
    // A client can prepend anything to X-Forwarded-For; the trusted proxy
    // appends the real peer address last. Rotating the leading entries must
    // not create a fresh per-IP bucket.
    for (let i = 0; i < 5; i += 1) {
      const res = await requestLink(`spoof${i}@example.test`, `10.9.8.${i + 1}, 198.51.100.200`);
      expect(res.status, `link ${i + 1}`).toBe(202);
    }
    const sixth = await requestLink("spoof-last@example.test", "10.9.8.77, 198.51.100.200");
    expect(sixth.status).toBe(429);
  });

  it("ip_is_read_from_x_forwarded_for_only_behind_a_trusted_proxy", async () => {
    const direct = testApp(new Hono().route("/auth", createAuthRoutes({ trustProxy: false })));
    const res = await direct.request("/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "192.0.2.1" },
      body: JSON.stringify({ email: "direct@example.test" }),
    });
    expect(res.status).toBe(202);
    const row = await db.pool.query<{ ip: string | null }>(
      "SELECT host(ip) AS ip FROM auth_tokens WHERE email = 'direct@example.test'",
    );
    expect(row.rows[0].ip).not.toBe("192.0.2.1");

    // One trusted proxy (the default): the entry it appended, the last one.
    // The leading entry is whatever the client sent and is not trusted.
    await requestLink("proxied@example.test", "192.0.2.2, 10.0.0.1");
    const proxied = await db.pool.query<{ ip: string | null }>(
      "SELECT host(ip) AS ip FROM auth_tokens WHERE email = 'proxied@example.test'",
    );
    expect(proxied.rows[0].ip).toBe("10.0.0.1");

    // Two trusted proxies: the second entry from the right.
    const twoHops = testApp(new Hono().route("/auth", createAuthRoutes({ trustProxy: true, trustProxyHops: 2 })));
    await twoHops.request("/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "6.6.6.6, 192.0.2.3, 10.0.0.1" },
      body: JSON.stringify({ email: "two-hops@example.test" }),
    });
    const hopped = await db.pool.query<{ ip: string | null }>(
      "SELECT host(ip) AS ip FROM auth_tokens WHERE email = 'two-hops@example.test'",
    );
    expect(hopped.rows[0].ip).toBe("192.0.2.3");
  });

  it("dev_routes_absent_outside_test", async () => {
    for (const nodeEnv of ["development", "production"] as const) {
      const prod = testApp(new Hono().route("/auth", createAuthRoutes({ nodeEnv })));
      const login = await prod.request("/api/auth/dev-login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email: "dev@example.test" }),
      });
      expect(login.status, nodeEnv).toBe(404);
      expect(await login.json()).toEqual({ code: "not_found" });
      const last = await prod.request("/api/auth/dev-last-link?email=dev@example.test");
      expect(last.status, nodeEnv).toBe(404);
    }
    expect((await db.pool.query("SELECT 1 FROM users")).rowCount).toBe(0);

    // In test mode (the default under vitest) both exist.
    const login = await app.request("/api/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "dev@example.test" }),
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as { userId: string; redirect: string };
    expect(body.redirect).toBe("/network/onboarding");
    expect(login.headers.get("set-cookie")).toContain("mest_session=");
    const missing = await app.request("/api/auth/dev-last-link?email=nobody@example.test");
    expect(missing.status).toBe(404);
  });
});
