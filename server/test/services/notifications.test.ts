import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  MarkAllReadResponse,
  MarkReadResponse,
  NotificationItem,
  NotificationsResponse,
} from "@shared/types/notifications";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { notificationRoutes } from "../../src/routes/notifications";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson } from "../policies/fixtures";

/**
 * The in-app notification list (`/api/notifications`, NOT-2): a recipient
 * reads, pages, filters and marks read their own notifications and nobody
 * else's, administrators included.
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
const app = testApp(new Hono().route("/notifications", notificationRoutes));

async function cookieFor(userId: string): Promise<string> {
  const session = await asSystem(db.pool, (client) => createSession(wrapClient(client), userId, null));
  return `mest_session=${session.value}`;
}

async function call(cookie: string | null, method: string, path: string): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (cookie) headers.cookie = cookie;
  return app.request(`/api/notifications${path}`, { method, headers });
}

async function json<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return JSON.parse(text) as T;
}

/** Writes a notification the way definer functions and jobs do, through `create_notification`. */
async function notify(
  recipient: string,
  title: string,
  options: { category?: string; body?: string; link?: string | null; createdAt?: Date } = {},
): Promise<string> {
  return asSystem(db.pool, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT create_notification($1, $2::notification_category, $3, $4, $5, 'default', '{}'::jsonb, false) AS id`,
      [
        recipient,
        options.category ?? "profile",
        title,
        options.body ?? "",
        options.link === undefined ? "/network/me" : options.link,
      ],
    );
    const id = rows[0].id;
    if (options.createdAt) {
      await client.query("UPDATE notifications SET created_at = $2 WHERE id = $1", [id, options.createdAt]);
    }
    return id;
  });
}

async function readAtOf(id: string): Promise<Date | null> {
  const { rows } = await db.pool.query<{ read_at: Date | null }>("SELECT read_at FROM notifications WHERE id = $1", [id]);
  return rows[0].read_at;
}

describe("reading notifications", () => {
  it("recipient_only_reads", async () => {
    const layla = await makePerson(db.pool, { firstName: "Layla" });
    const omar = await makePerson(db.pool, { firstName: "Omar", kind: "student", visibility: "hidden" });
    const admin = await makePerson(db.pool, { admin: true, visibility: "hidden" });

    const older = await notify(layla, "Your profile is listed", {
      body: "People can now find you in the directory.",
      createdAt: new Date(Date.now() - 60_000),
    });
    const newer = await notify(layla, "Your affiliation was verified", { link: null });
    const omars = await notify(omar, "A note for Omar only");

    // Layla reads her own two, newest first, and nothing of Omar's.
    const mine = await json<NotificationsResponse>(await call(await cookieFor(layla), "GET", ""));
    expect(mine.total).toBe(2);
    expect(mine.unread).toBe(2);
    expect(mine.items.map((n) => n.id)).toEqual([newer, older]);
    expect(mine.items[1]).toEqual<NotificationItem>({
      id: older,
      category: "profile",
      title: "Your profile is listed",
      body: "People can now find you in the directory.",
      link: "/network/me",
      createdAt: expect.any(String) as unknown as string,
      readAt: null,
    });
    expect(mine.items[0].link).toBeNull();
    // Only the fields the list promises: no recipient, template, payload or email state.
    expect(Object.keys(mine.items[0]).sort()).toEqual(["body", "category", "createdAt", "id", "link", "readAt", "title"]);

    // Omar sees only his; an administrator has no reach into anyone's list.
    const his = await json<NotificationsResponse>(await call(await cookieFor(omar), "GET", ""));
    expect(his.items.map((n) => n.id)).toEqual([omars]);
    const admins = await json<NotificationsResponse>(await call(await cookieFor(admin), "GET", ""));
    expect(admins).toEqual({ items: [], total: 0, unread: 0 });

    // A visitor is asked to sign in.
    expect((await json<{ code: string }>(await call(null, "GET", ""), 401)).code).toBe("unauthenticated");
  });

  it("unread_filter_and_paging", async () => {
    const layla = await makePerson(db.pool);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(await notify(layla, `Notice ${i}`, { createdAt: new Date(Date.now() - (5 - i) * 60_000) }));
    }
    await db.pool.query("UPDATE notifications SET read_at = now() WHERE id = ANY($1)", [[ids[0], ids[1]]]);
    const cookie = await cookieFor(layla);

    const unread = await json<NotificationsResponse>(await call(cookie, "GET", "?unread=1"));
    expect(unread.total).toBe(3);
    expect(unread.unread).toBe(3);
    expect(unread.items.map((n) => n.title)).toEqual(["Notice 4", "Notice 3", "Notice 2"]);

    const page2 = await json<NotificationsResponse>(await call(cookie, "GET", "?page=2&size=2"));
    expect(page2.total).toBe(5);
    expect(page2.unread).toBe(3);
    expect(page2.items.map((n) => n.title)).toEqual(["Notice 2", "Notice 1"]);
    expect(page2.items[1].readAt).toEqual(expect.any(String));

    expect((await json<{ code: string }>(await call(cookie, "GET", "?size=51"), 400)).code).toBe("validation");
    expect((await json<{ code: string }>(await call(cookie, "GET", "?unread=yes"), 400)).code).toBe("validation");
  });

  it("suspended_member_still_reads_own_list", async () => {
    // Moderation notices go to suspended members, who are no longer `is_member()`.
    const suspended = await makePerson(db.pool, { suspended: true });
    await notify(suspended, "Requests are paused on your account", { category: "account" });
    const list = await json<NotificationsResponse>(await call(await cookieFor(suspended), "GET", ""));
    expect(list.items.map((n) => n.category)).toEqual(["account"]);
  });
});

describe("marking notifications read", () => {
  it("mark_read_only_own", async () => {
    const layla = await makePerson(db.pool);
    const omar = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const laylas = await notify(layla, "For Layla");
    const omars = await notify(omar, "For Omar");
    const laylaCookie = await cookieFor(layla);

    // Layla cannot mark Omar's: as far as she can see it does not exist.
    expect((await json<{ code: string }>(await call(laylaCookie, "POST", `/${omars}/read`), 404)).code).toBe("not_found");
    expect(await readAtOf(omars)).toBeNull();

    // Her own is marked once; a second mark keeps the first time.
    const first = await json<MarkReadResponse>(await call(laylaCookie, "POST", `/${laylas}/read`));
    expect(first).toEqual({ id: laylas, readAt: expect.any(String) });
    const stamped = await readAtOf(laylas);
    expect(stamped).not.toBeNull();
    const again = await json<MarkReadResponse>(await call(laylaCookie, "POST", `/${laylas}/read`));
    expect(again.readAt).toBe(first.readAt);
    expect((await readAtOf(laylas))?.getTime()).toBe(stamped?.getTime());

    const list = await json<NotificationsResponse>(await call(laylaCookie, "GET", ""));
    expect(list.unread).toBe(0);

    // Not a notification id at all, a foreign Origin, and no session.
    expect((await json<{ code: string }>(await call(laylaCookie, "POST", "/not-a-uuid/read"), 400)).code).toBe("validation");
    const foreign = await app.request(`/api/notifications/${laylas}/read`, {
      method: "POST",
      headers: { cookie: laylaCookie, origin: "https://elsewhere.test" },
    });
    expect(foreign.status).toBe(403);
    expect((await json<{ code: string }>(await call(null, "POST", `/${laylas}/read`), 401)).code).toBe("unauthenticated");
  });

  it("read_all_marks_only_own_unread", async () => {
    const layla = await makePerson(db.pool);
    const omar = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const already = await notify(layla, "Already read");
    await db.pool.query("UPDATE notifications SET read_at = now() - interval '1 day' WHERE id = $1", [already]);
    const before = await readAtOf(already);
    await notify(layla, "One");
    await notify(layla, "Two");
    const omars = await notify(omar, "Omar's");

    const result = await json<MarkAllReadResponse>(await call(await cookieFor(layla), "POST", "/read-all"));
    expect(result).toEqual({ updated: 2 });

    const { rows } = await db.pool.query<{ unread: number }>(
      "SELECT count(*)::int AS unread FROM notifications WHERE recipient_id = $1 AND read_at IS NULL",
      [layla],
    );
    expect(rows[0].unread).toBe(0);
    expect((await readAtOf(already))?.getTime()).toBe(before?.getTime());
    expect(await readAtOf(omars)).toBeNull();
  });
});
