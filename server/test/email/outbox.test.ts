import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withSystem } from "../../src/db/tx";
import { sendOutboxBatch } from "../../src/email/outbox";
import type { Mailer, OutgoingEmail } from "../../src/email/resend";
import { registerTemplate, renderTemplate } from "../../src/email/templates/registry";
import { asSystem, asUser, createTestDb, truncateAll, type TestDb } from "../harness";
import { makePerson } from "../policies/fixtures";

const resendSend = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: resendSend } })),
}));

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await truncateAll(db.pool);
  resendSend.mockReset();
});

interface NotifyArgs {
  category: string;
  email: boolean;
  template?: string;
  payload?: Record<string, unknown>;
}

async function notify(recipient: string, args: NotifyArgs): Promise<string> {
  return asSystem(db.pool, async (client) => {
    const result = await client.query<{ id: string }>(
      "SELECT create_notification($1, $2, $3, $4, $5, $6, $7::jsonb, $8) AS id",
      [
        recipient,
        args.category,
        "Something happened",
        "Open MEST Network to see it.",
        "/network/me",
        args.template ?? "default",
        JSON.stringify(args.payload ?? {}),
        args.email,
      ],
    );
    return result.rows[0].id;
  });
}

async function outboxRows() {
  return (
    await db.pool.query<{
      id: string;
      notification_id: string | null;
      to_email: string;
      template: string;
      payload: Record<string, unknown>;
      attempts: number;
      last_error: string | null;
      sent_at: Date | null;
    }>("SELECT id, notification_id, to_email::text, template, payload, attempts, last_error, sent_at FROM email_outbox ORDER BY created_at")
  ).rows;
}

async function emailStatus(notificationId: string): Promise<string> {
  const r = await db.pool.query<{ email_status: string }>("SELECT email_status FROM notifications WHERE id = $1", [
    notificationId,
  ]);
  return r.rows[0].email_status;
}

async function setPreference(profileId: string, column: string, value: boolean) {
  await asSystem(db.pool, (client) =>
    client.query(
      `INSERT INTO notification_preferences (profile_id, ${column}) VALUES ($1, $2)
       ON CONFLICT (profile_id) DO UPDATE SET ${column} = EXCLUDED.${column}`,
      [profileId, value],
    ),
  );
}

describe("create_notification", () => {
  it("create_notification_account_always_emails", async () => {
    const member = await makePerson(db.pool, { email: "account@example.test" });
    // Every preference off: account email still goes.
    await asSystem(db.pool, (client) =>
      client.query(
        `INSERT INTO notification_preferences (profile_id, email_requests, email_responses, email_reminders,
            email_profile, email_reports, email_admin_digest, email_product_updates)
         VALUES ($1, false, false, false, false, false, false, false)`,
        [member],
      ),
    );
    const id = await notify(member, { category: "account", email: true, template: "moderation-action" });

    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].notification_id).toBe(id);
    expect(rows[0].to_email).toBe("account@example.test");
    expect(rows[0].template).toBe("moderation-action");
    expect(rows[0].payload).toMatchObject({ title: "Something happened", link: "/network/me" });
    expect(await emailStatus(id)).toBe("queued");

    // The in-app row exists whatever happens to email.
    const inApp = await db.pool.query("SELECT recipient_id, category, title FROM notifications");
    expect(inApp.rows).toEqual([{ recipient_id: member, category: "account", title: "Something happened" }]);

    // email = false means in-app only, even for account.
    const quiet = await notify(member, { category: "account", email: false });
    expect(await outboxRows()).toHaveLength(1);
    expect(await emailStatus(quiet)).toBe("skipped");
  });

  it("create_notification_respects_category_preference", async () => {
    const columns: Record<string, string> = {
      request: "email_requests",
      response: "email_responses",
      reminder: "email_reminders",
      profile: "email_profile",
      report: "email_reports",
      admin_digest: "email_admin_digest",
    };
    for (const [category, column] of Object.entries(columns)) {
      const member = await makePerson(db.pool, { email: `${category}@example.test` });

      // No preference row yet: the column defaults (on) apply.
      const first = await notify(member, { category, email: true });
      expect(await emailStatus(first), category).toBe("queued");

      // Turned off: in-app only.
      await setPreference(member, column, false);
      const second = await notify(member, { category, email: true });
      expect(await emailStatus(second), category).toBe("skipped");

      // Another category's switch does not matter.
      const other = Object.values(columns).find((c) => c !== column) as string;
      await setPreference(member, column, true);
      await setPreference(member, other, false);
      const third = await notify(member, { category, email: true });
      expect(await emailStatus(third), category).toBe("queued");

      const queued = (await outboxRows()).filter((r) => r.to_email === `${category}@example.test`);
      expect(queued.map((r) => r.notification_id), category).toEqual([first, third]);
    }
    expect((await db.pool.query("SELECT 1 FROM notifications")).rowCount).toBe(18);
  });

  it("create_notification_strips_private_keys_and_skips_deleted_accounts", async () => {
    const member = await makePerson(db.pool, { email: "private@example.test" });
    const id = await notify(member, {
      category: "request",
      email: true,
      payload: { mentorName: "Layla", why: "secret why", goals: "secret goals", nested: { phone: "+15045550100" } },
    });
    const row = await db.pool.query<{ payload: Record<string, unknown> }>("SELECT payload FROM notifications WHERE id = $1", [id]);
    expect(row.rows[0].payload).toEqual({ mentorName: "Layla", nested: {} });
    const [outbox] = await outboxRows();
    expect(JSON.stringify(outbox.payload)).not.toMatch(/secret|5550100/);
    expect(outbox.payload.mentorName).toBe("Layla");

    const gone = await makePerson(db.pool, { deleted: true });
    const goneId = await notify(gone, { category: "account", email: true });
    expect(await emailStatus(goneId)).toBe("skipped");
    expect(await outboxRows()).toHaveLength(1);
  });

  it("app_user_cannot_notify_enqueue_or_read_the_outbox", async () => {
    const member = await makePerson(db.pool, { email: "member@example.test" });
    const other = await makePerson(db.pool, { email: "other@example.test" });
    await notify(member, { category: "account", email: true });
    await notify(other, { category: "account", email: false });

    await expect(
      asUser(db.pool, member, (client) =>
        client.query("SELECT create_notification($1, 'account', 't', 'b', '/network', 'default', '{}', true)", [other]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db.pool, member, (client) =>
        client.query("SELECT enqueue_email('someone@example.test', 'default', '{}')"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db.pool, member, (client) => client.query("SELECT * FROM email_outbox"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser(db.pool, member, (client) =>
        client.query("INSERT INTO notifications (recipient_id, category, title) VALUES ($1, 'account', 'x')", [other]),
      ),
    ).rejects.toThrow(/permission denied/);

    // A recipient reads and marks read only their own, and nothing else on the row.
    const seen = await asUser(db.pool, member, async (client) => {
      const rows = await client.query<{ recipient_id: string }>("SELECT recipient_id FROM notifications");
      const marked = await client.query("UPDATE notifications SET read_at = now()");
      return { rows: rows.rows, marked: marked.rowCount };
    });
    expect(seen.rows).toEqual([{ recipient_id: member }]);
    expect(seen.marked).toBe(1);
    await expect(
      asUser(db.pool, member, (client) => client.query("UPDATE notifications SET title = 'changed'")),
    ).rejects.toThrow(/permission denied/);
    const otherUnread = await db.pool.query("SELECT read_at FROM notifications WHERE recipient_id = $1", [other]);
    expect(otherUnread.rows[0].read_at).toBeNull();
  });
});

/** A mailer that fails the first `failures` sends to each address. */
function flakyMailer(failures: Record<string, number>): Mailer & { sent: OutgoingEmail[] } {
  const seen = new Map<string, number>();
  const sent: OutgoingEmail[] = [];
  return {
    kind: "resend",
    sent,
    async send(message) {
      const n = (seen.get(message.to) ?? 0) + 1;
      seen.set(message.to, n);
      if (n <= (failures[message.to] ?? 0)) throw new Error(`provider refused attempt ${n}`);
      sent.push(message);
    },
  };
}

describe("outbox sender", () => {
  it("outbox_sends_retries_and_gives_up_after_3", async () => {
    const ok = await makePerson(db.pool, { email: "ok@example.test" });
    const flaky = await makePerson(db.pool, { email: "flaky@example.test" });
    const broken = await makePerson(db.pool, { email: "broken@example.test" });
    const okId = await notify(ok, { category: "account", email: true });
    const flakyId = await notify(flaky, { category: "account", email: true });
    const brokenId = await notify(broken, { category: "account", email: true });

    const mailer = flakyMailer({ "flaky@example.test": 1, "broken@example.test": 99 });
    const run = () => withSystem((tx) => sendOutboxBatch(tx, 50, mailer));

    // First pass: ok sends, the other two fail once.
    expect(await run()).toEqual({ sent: 1, failed: 2, gaveUp: 0 });
    let rows = await outboxRows();
    const byTo = (to: string) => rows.find((r) => r.to_email === to)!;
    expect(byTo("ok@example.test").sent_at).not.toBeNull();
    expect(byTo("flaky@example.test")).toMatchObject({ attempts: 1, last_error: "provider refused attempt 1", sent_at: null });
    expect(await emailStatus(okId)).toBe("sent");
    expect(await emailStatus(flakyId)).toBe("queued");

    // Second pass: flaky succeeds; broken fails again.
    expect(await run()).toEqual({ sent: 1, failed: 1, gaveUp: 0 });
    rows = await outboxRows();
    expect(byTo("flaky@example.test").sent_at).not.toBeNull();
    expect(byTo("flaky@example.test").attempts).toBe(1);
    expect(await emailStatus(flakyId)).toBe("sent");

    // Third pass: broken's third failure is its last.
    expect(await run()).toEqual({ sent: 0, failed: 1, gaveUp: 1 });
    rows = await outboxRows();
    expect(byTo("broken@example.test")).toMatchObject({ attempts: 3, sent_at: null });
    expect(await emailStatus(brokenId)).toBe("failed");

    // Nothing is left to try; each address got exactly one delivered message.
    expect(await run()).toEqual({ sent: 0, failed: 0, gaveUp: 0 });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(["flaky@example.test", "ok@example.test"]);
    expect(mailer.sent[0].subject).toBe("Something happened");
    expect(mailer.sent[0].text).toContain("Open MEST Network to see it.");
    expect(mailer.sent[0].text).toContain("http://127.0.0.1:8787/network/me");
  });

  it("outbox_respects_the_batch_limit_and_oldest_first", async () => {
    const people = [];
    for (let i = 0; i < 3; i += 1) {
      const id = await makePerson(db.pool, { email: `p${i}@example.test` });
      people.push(id);
      await notify(id, { category: "account", email: true });
    }
    const mailer = flakyMailer({});
    expect(await withSystem((tx) => sendOutboxBatch(tx, 2, mailer))).toEqual({ sent: 2, failed: 0, gaveUp: 0 });
    expect(mailer.sent.map((m) => m.to)).toEqual(["p0@example.test", "p1@example.test"]);
    expect(await withSystem((tx) => sendOutboxBatch(tx, 2, mailer))).toEqual({ sent: 1, failed: 0, gaveUp: 0 });
  });

  it("outbox_sends_through_resend_and_records_its_errors", async () => {
    const { createResendMailer } = await import("../../src/email/resend");
    const member = await makePerson(db.pool, { email: "resend@example.test" });
    await notify(member, { category: "account", email: true });
    resendSend
      .mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "domain not verified" } })
      .mockResolvedValueOnce({ data: { id: "email_1" }, error: null });
    const mailer = createResendMailer("re_test_key", "MEST Network <network@example.test>");

    expect(await withSystem((tx) => sendOutboxBatch(tx, 50, mailer))).toEqual({ sent: 0, failed: 1, gaveUp: 0 });
    expect((await outboxRows())[0].last_error).toContain("domain not verified");
    expect(await withSystem((tx) => sendOutboxBatch(tx, 50, mailer))).toEqual({ sent: 1, failed: 0, gaveUp: 0 });

    expect(resendSend).toHaveBeenCalledTimes(2);
    const message = resendSend.mock.calls[1][0] as Record<string, string>;
    expect(message.from).toBe("MEST Network <network@example.test>");
    expect(message.to).toBe("resend@example.test");
    expect(message.subject).toBe("Something happened");
    expect(message.text).toContain("Open MEST Network to see it.");
    expect(message.html).toContain("Open MEST Network to see it.");
  });

  it("without_an_api_key_the_sender_logs_the_text_and_marks_sent", async () => {
    const { createLogMailer } = await import("../../src/email/resend");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const member = await makePerson(db.pool, { email: "local@example.test" });
      await notify(member, { category: "account", email: true });
      await withSystem((tx) =>
        tx.query("SELECT enqueue_email('link@example.test', 'magic-link', $1::jsonb)", [
          JSON.stringify({ link: "http://127.0.0.1:8787/api/auth/callback?token=abc" }),
        ]),
      );
      const result = await withSystem((tx) => sendOutboxBatch(tx, 50, createLogMailer("development")));
      expect(result).toEqual({ sent: 2, failed: 0, gaveUp: 0 });
      const printed = log.mock.calls.map((args) => args.join(" ")).join("\n");
      expect(printed).toContain("http://127.0.0.1:8787/api/auth/callback?token=abc");
      expect(printed).toContain("Open MEST Network to see it.");

      // A sent magic link no longer keeps its token in the outbox.
      const magic = (await outboxRows()).find((r) => r.template === "magic-link")!;
      expect(magic.sent_at).not.toBeNull();
      expect(magic.payload).toEqual({});
    } finally {
      log.mockRestore();
    }

    // In test mode (CI, Playwright) nothing is printed: test runs read links
    // from the test-only dev-last-link route, and CI logs must not carry
    // working sign-in links or addresses.
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await withSystem((tx) =>
        tx.query("SELECT enqueue_email('ci@example.test', 'magic-link', $1::jsonb)", [
          JSON.stringify({ link: "http://127.0.0.1:8787/api/auth/callback?token=ci-token" }),
        ]),
      );
      const ci = await withSystem((tx) => sendOutboxBatch(tx, 50, createLogMailer("test")));
      expect(ci).toEqual({ sent: 1, failed: 0, gaveUp: 0 });
      const printed = quiet.mock.calls.map((args) => args.join(" ")).join("\n");
      expect(printed).not.toContain("ci-token");
      expect(printed).not.toContain("ci@example.test");
    } finally {
      quiet.mockRestore();
    }

    // In production, a missing key is a failure, never a printed sign-in link.
    await withSystem((tx) => tx.query("SELECT enqueue_email('prod@example.test', 'magic-link', '{\"link\":\"x\"}')"));
    const prod = await withSystem((tx) => sendOutboxBatch(tx, 50, createLogMailer("production")));
    expect(prod).toEqual({ sent: 0, failed: 1, gaveUp: 0 });
  });
});

describe("template registry", () => {
  it("renders_registered_templates_and_falls_back_to_default", () => {
    const magic = renderTemplate("magic-link", { link: "http://127.0.0.1:8787/api/auth/callback?token=t<1>" });
    expect(magic.subject).toBe("Your sign-in link for MEST Network");
    expect(magic.text).toContain("http://127.0.0.1:8787/api/auth/callback?token=t<1>");
    expect(magic.html).toContain("token=t&lt;1&gt;");
    expect(magic.html).not.toContain("t<1>");
    expect(`${magic.subject}${magic.text}${magic.html}`).not.toMatch(/—/);

    // A name no template registers (Task 20 registered request-received and the rest).
    const fallback = renderTemplate("not-registered-yet", { title: "New request", body: "<b>Hi</b>", link: "/network/mentor" });
    expect(fallback.subject).toBe("New request");
    expect(fallback.html).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(fallback.text).toContain("http://127.0.0.1:8787/network/mentor");

    registerTemplate("test-template", (data) => ({ subject: `Hello ${String(data.name)}`, text: "t", html: "h" }));
    expect(renderTemplate("test-template", { name: "Amina" }).subject).toBe("Hello Amina");
  });
});
