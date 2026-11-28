import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { photoLimits } from "@shared/limits";
import type { AdminPhoto, OwnPhotoResponse } from "@shared/types/photos";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { directoryRoutes } from "../../src/routes/directory";
import { exportRoutes } from "../../src/routes/export";
import { adminPhotoRoutes, mePhotoRoutes, photoRoutes } from "../../src/routes/photos";
import { profileRoutes } from "../../src/routes/profiles";
import { sniffImageType } from "../../src/services/photos";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { makePerson, rowsAs, runAs } from "../policies/fixtures";
import { makeMentor, makeStudent, resetRequestConfig, sendRequest } from "../policies/request-fixtures";

/**
 * Profile photos (Task 33). A photo is stored in Postgres, is visible only
 * after an administrator approves it, and is served only to callers who may
 * see the profile itself (`profile_access`). Uploads are checked by their
 * bytes, not by what the browser says they are.
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

const api = new Hono();
api.route("/me", mePhotoRoutes);
api.route("/me", exportRoutes);
api.route("/photos", photoRoutes);
api.route("/admin", adminPhotoRoutes);
api.route("/directory", directoryRoutes);
api.route("/profiles", profileRoutes);
const app = testApp(api);

async function cookieFor(userId: string): Promise<string> {
  return asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
}

/** A byte string that starts like a JPEG: SOI, an APP0 marker, filler and EOI. */
function jpegBytes(size = 2048, fill = 7): Uint8Array {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.set([0xff, 0xd9], size - 2);
  return bytes;
}

/** A RIFF/WEBP container header followed by filler. */
function webpBytes(size = 1024): Uint8Array {
  const bytes = new Uint8Array(size).fill(3);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  new DataView(bytes.buffer).setUint32(4, size - 8, true);
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20], 8); // WEBPVP8 + space
  return bytes;
}

/** The first bytes of a PNG. */
function pngBytes(size = 1024): Uint8Array {
  const bytes = new Uint8Array(size).fill(1);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

interface Answer {
  status: number;
  headers: Headers;
  body: any;
  bytes: Uint8Array;
}

async function call(
  cookie: string | null,
  method: string,
  path: string,
  options: { form?: FormData; json?: unknown; headers?: Record<string, string> } = {},
): Promise<Answer> {
  const headers: Record<string, string> = { origin: ORIGIN, ...options.headers };
  if (cookie) headers.cookie = `mest_session=${cookie}`;
  let body: FormData | string | undefined;
  if (options.form) body = options.form;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers["content-type"] = "application/json";
  }
  const res = await app.request(`/api${path}`, { method, headers, body });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const type = res.headers.get("content-type") ?? "";
  const parsed = type.startsWith("application/json") && bytes.length > 0 ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  return { status: res.status, headers: res.headers, body: parsed, bytes };
}

function photoForm(bytes: Uint8Array, type = "image/jpeg", name = "me.jpg"): FormData {
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type }), name);
  return form;
}

async function upload(cookie: string, bytes: Uint8Array = jpegBytes(), type = "image/jpeg"): Promise<Answer> {
  return call(cookie, "POST", "/me/photo", { form: photoForm(bytes, type) });
}

async function photoRow(profileId: string) {
  const rows = await db.pool.query<{ id: string; status: string; content_type: string; byte_size: number; reviewed_by: string | null }>(
    "SELECT id, status::text AS status, content_type, byte_size, reviewed_by FROM profile_photos WHERE profile_id = $1",
    [profileId],
  );
  return rows.rows[0] ?? null;
}

async function review(adminCookie: string, photoId: string, decision: "approved" | "rejected"): Promise<Answer> {
  return call(adminCookie, "POST", `/admin/photos/${photoId}`, { json: { decision } });
}

/** A professional with an uploaded photo, and an administrator to review it. */
async function arrange(options: Parameters<typeof makeMentor>[1] = {}) {
  const owner = await makeMentor(db.pool, { firstName: "Layla", lastName: "Haddad", ...options });
  const admin = await makePerson(db.pool, { admin: true, firstName: "Omar", lastName: "Admin" });
  const ownerCookie = await cookieFor(owner);
  const adminCookie = await cookieFor(admin);
  const bytes = jpegBytes(4096, 9);
  const res = await upload(ownerCookie, bytes);
  expect(res.status).toBe(201);
  const photoId = (res.body as OwnPhotoResponse).photo!.id;
  return { owner, admin, ownerCookie, adminCookie, bytes, photoId };
}

describe("sniffImageType", () => {
  it("recognises_jpeg_and_webp_by_their_bytes_only", () => {
    expect(sniffImageType(jpegBytes())).toBe("image/jpeg");
    expect(sniffImageType(webpBytes())).toBe("image/webp");
    expect(sniffImageType(pngBytes())).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    // RIFF without the WEBP form type (a WAV file) is not an image.
    const wav = webpBytes();
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(sniffImageType(wav)).toBeNull();
  });
});

describe("POST /api/me/photo", () => {
  it("upload_needs_a_signed_in_member_and_the_origin", async () => {
    expect((await call(null, "POST", "/me/photo", { form: photoForm(jpegBytes()) })).status).toBe(401);
    const unverified = await makePerson(db.pool, { verified: false });
    expect((await upload(await cookieFor(unverified))).status).toBe(403);
    const member = await makeMentor(db.pool);
    const res = await call(await cookieFor(member), "POST", "/me/photo", {
      form: photoForm(jpegBytes()),
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("bad_origin");
    expect(await photoRow(member)).toBeNull();
  });

  it("upload_is_checked_by_magic_bytes_not_by_the_declared_type", async () => {
    const member = await makeMentor(db.pool);
    const cookie = await cookieFor(member);

    // A PNG, and a script, both labelled as JPEG.
    const png = await upload(cookie, pngBytes(), "image/jpeg");
    expect(png.status).toBe(415);
    expect(png.body.code).toBe("unsupported_media_type");
    const script = await upload(cookie, new TextEncoder().encode("<script>alert(1)</script>"), "image/jpeg");
    expect(script.status).toBe(415);
    expect(await photoRow(member)).toBeNull();

    // A real WebP labelled as JPEG is stored as what it is.
    const webp = await upload(cookie, webpBytes(), "image/jpeg");
    expect(webp.status).toBe(201);
    expect((await photoRow(member))?.content_type).toBe("image/webp");
  });

  it("upload_over_the_size_limit_is_refused", async () => {
    const member = await makeMentor(db.pool);
    const cookie = await cookieFor(member);
    const exact = await upload(cookie, jpegBytes(photoLimits.maxBytes));
    expect(exact.status).toBe(201);
    expect((await photoRow(member))?.byte_size).toBe(photoLimits.maxBytes);

    const over = await upload(cookie, jpegBytes(photoLimits.maxBytes + 1));
    expect(over.status).toBe(413);
    expect(over.body.code).toBe("too_large");
    const huge = await upload(cookie, jpegBytes(2_000_000));
    expect(huge.status).toBe(413);
    // The earlier photo is untouched.
    expect((await photoRow(member))?.byte_size).toBe(photoLimits.maxBytes);
  });

  it("upload_without_a_file_is_a_validation_error", async () => {
    const member = await makeMentor(db.pool);
    const form = new FormData();
    form.append("photo", "not a file");
    const res = await call(await cookieFor(member), "POST", "/me/photo", { form });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation");
  });

  it("member_cannot_write_photo_rows_directly", async () => {
    const member = await makeMentor(db.pool);
    const hex = Buffer.from(jpegBytes()).toString("hex");
    await expect(
      runAs(db.pool, member, `INSERT INTO profile_photos (profile_id, image, content_type, byte_size, status)
                               VALUES ($1, decode($2, 'hex'), 'image/jpeg', 2048, 'approved')`, [member, hex]),
    ).rejects.toThrow(/permission denied/);

    const cookie = await cookieFor(member);
    expect((await upload(cookie)).status).toBe(201);
    await expect(runAs(db.pool, member, "UPDATE profile_photos SET status = 'approved' WHERE profile_id = $1", [member])).rejects.toThrow(
      /permission denied/,
    );
    await expect(runAs(db.pool, member, "DELETE FROM profile_photos WHERE profile_id = $1", [member])).rejects.toThrow(
      /permission denied/,
    );
    expect((await photoRow(member))?.status).toBe("pending");
  });
});

describe("moderation", () => {
  it("pending_photo_is_served_to_nobody_until_approved", async () => {
    const p = await arrange();
    const stranger = await makeStudent(db.pool);
    const strangerCookie = await cookieFor(stranger);

    // The owner sees their own upload waiting, on the owner-only endpoint.
    const own = await call(p.ownerCookie, "GET", "/me/photo");
    expect(own.status).toBe(200);
    expect(own.body.photo).toMatchObject({ id: p.photoId, status: "pending", contentType: "image/jpeg", byteSize: 4096 });
    const ownImage = await call(p.ownerCookie, "GET", "/me/photo/image");
    expect(ownImage.status).toBe(200);
    expect(ownImage.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(ownImage.bytes).equals(Buffer.from(p.bytes))).toBe(true);

    // The public endpoint answers 404 for everyone, the owner included.
    for (const cookie of [null, strangerCookie, p.ownerCookie, p.adminCookie]) {
      expect((await call(cookie, "GET", `/photos/${p.owner}`)).status).toBe(404);
    }
    // And no card or profile points at it.
    const directory = await call(null, "GET", "/directory");
    expect(directory.body.items.find((e: any) => e.id === p.owner)?.photoUrl).toBeNull();
    expect((await call(null, "GET", `/profiles/${p.owner}`)).body.photoUrl).toBeNull();
    // Nor can a member read the pending row through the table.
    expect(await rowsAs(db.pool, stranger, "SELECT id FROM profile_photos")).toEqual([]);

    // Approved: the bytes, with the type the server determined.
    const approved = await review(p.adminCookie, p.photoId, "approved");
    expect(approved.status).toBe(200);
    const served = await call(null, "GET", `/photos/${p.owner}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    // Revalidated every time (a cheap 304), so a takedown or a visibility change applies at once.
    expect(served.headers.get("cache-control")).toBe("public, no-cache");
    expect(Buffer.from(served.bytes).equals(Buffer.from(p.bytes))).toBe(true);
    const card = (await call(null, "GET", "/directory")).body.items.find((e: any) => e.id === p.owner);
    expect(card.photoUrl).toBe(`/api/photos/${p.owner}?v=${p.photoId}`);
    expect((await call(null, "GET", `/profiles/${p.owner}`)).body.photoUrl).toBe(`/api/photos/${p.owner}?v=${p.photoId}`);
  });

  it("members_only_profile_photo_is_private_and_hidden_from_visitors", async () => {
    const p = await arrange({ visibility: "members" });
    expect((await review(p.adminCookie, p.photoId, "approved")).status).toBe(200);
    const member = await makeStudent(db.pool);

    expect((await call(null, "GET", `/photos/${p.owner}`)).status).toBe(404);
    const served = await call(await cookieFor(member), "GET", `/photos/${p.owner}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("photo_follows_the_profile_rule_when_the_profile_is_out_of_sight", async () => {
    const p = await arrange();
    expect((await review(p.adminCookie, p.photoId, "approved")).status).toBe(200);
    const member = await makeStudent(db.pool);
    const memberCookie = await cookieFor(member);
    expect((await call(memberCookie, "GET", `/photos/${p.owner}`)).status).toBe(200);

    // Hidden by the owner: gone for members and visitors.
    await asSystem(db.pool, (client) => client.query("UPDATE profiles SET visibility = 'hidden' WHERE id = $1", [p.owner]));
    expect((await call(null, "GET", `/photos/${p.owner}`)).status).toBe(404);
    expect((await call(memberCookie, "GET", `/photos/${p.owner}`)).status).toBe(404);
    // The owner still sees their own photo on their profile.
    const own = await call(p.ownerCookie, "GET", `/photos/${p.owner}`);
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toMatch(/^private/);

    // Hidden by an administrator: the same.
    await asSystem(db.pool, (client) =>
      client.query("UPDATE profiles SET visibility = 'public', admin_hidden_at = now() WHERE id = $1", [p.owner]),
    );
    expect((await call(null, "GET", `/photos/${p.owner}`)).status).toBe(404);

    // A student's profile is never listed, but the mentor they asked sees it.
    const student = await makeStudent(db.pool, { firstName: "Amina" });
    const studentCookie = await cookieFor(student);
    const studentPhoto = await upload(studentCookie);
    expect((await review(p.adminCookie, studentPhoto.body.photo.id, "approved")).status).toBe(200);
    const mentor = await makeMentor(db.pool);
    expect((await call(await cookieFor(mentor), "GET", `/photos/${student}`)).status).toBe(404);
    await sendRequest(db.pool, student, mentor);
    expect((await call(await cookieFor(mentor), "GET", `/photos/${student}`)).status).toBe(200);
    expect((await call(null, "GET", `/photos/${student}`)).status).toBe(404);

    // A malformed id is a plain 404.
    expect((await call(null, "GET", "/photos/not-a-uuid")).status).toBe(404);
  });

  it("rejection_hides_the_photo_notifies_the_owner_and_is_audited", async () => {
    const p = await arrange();
    expect((await review(p.adminCookie, p.photoId, "rejected")).status).toBe(200);
    expect((await call(null, "GET", `/photos/${p.owner}`)).status).toBe(404);
    expect(await photoRow(p.owner)).toMatchObject({ status: "rejected", reviewed_by: p.admin });

    const own = await call(p.ownerCookie, "GET", "/me/photo");
    expect(own.body.photo.status).toBe("rejected");

    const notes = await db.pool.query<{ template: string; title: string; link: string; category: string; payload: any }>(
      "SELECT template, title, link, category::text AS category, payload FROM notifications WHERE recipient_id = $1",
      [p.owner],
    );
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0]).toMatchObject({ template: "photo-reviewed", category: "profile", link: "/network/settings/profile" });
    expect(notes.rows[0].payload).toMatchObject({ firstName: "Layla", decision: "rejected" });
    const outbox = await db.pool.query("SELECT template FROM email_outbox WHERE template = 'photo-reviewed'");
    expect(outbox.rows).toHaveLength(1);

    const audit = await db.pool.query<{ action: string; actor_id: string; subject_id: string }>(
      "SELECT action, actor_id, subject_id FROM audit_log WHERE action LIKE 'photo.%' ORDER BY id",
    );
    expect(audit.rows.map((a) => a.action)).toEqual(["photo.uploaded", "photo.rejected"]);
    expect(audit.rows[1]).toMatchObject({ actor_id: p.admin, subject_id: p.owner });

    // A decision already taken is refused; changing it is not.
    expect((await review(p.adminCookie, p.photoId, "rejected")).body.code).toBe("review_closed");
    expect((await review(p.adminCookie, p.photoId, "approved")).status).toBe(200);
    expect((await call(null, "GET", `/photos/${p.owner}`)).status).toBe(200);
  });

  it("only_administrators_review_or_list_photos", async () => {
    const p = await arrange();
    const other = await makeMentor(db.pool);
    const otherCookie = await cookieFor(other);

    expect((await review(otherCookie, p.photoId, "approved")).status).toBe(403);
    expect((await review(p.ownerCookie, p.photoId, "approved")).status).toBe(403);
    expect((await call(otherCookie, "GET", "/admin/photos")).status).toBe(403);
    expect((await call(otherCookie, "GET", `/admin/photos/${p.photoId}/image`)).status).toBe(403);
    // The SQL function checks the caller on its own too.
    await expect(runAs(db.pool, p.owner, "SELECT admin_review_photo($1, 'approved')", [p.photoId])).rejects.toThrow(/mest\.forbidden/);
    expect((await photoRow(p.owner))?.status).toBe("pending");
  });

  it("admin_queue_lists_pending_oldest_first_and_shows_the_image", async () => {
    const p = await arrange();
    const second = await makeMentor(db.pool, { firstName: "Yusuf", lastName: "Hassan" });
    const secondCookie = await cookieFor(second);
    expect((await upload(secondCookie, jpegBytes(3000))).status).toBe(201);
    await asSystem(db.pool, (client) =>
      client.query("UPDATE profile_photos SET created_at = now() - interval '2 days' WHERE profile_id = $1", [p.owner]),
    );

    const queue = await call(p.adminCookie, "GET", "/admin/photos");
    expect(queue.status).toBe(200);
    expect(queue.body.total).toBe(2);
    const items = queue.body.items as AdminPhoto[];
    expect(items.map((i) => i.firstName)).toEqual(["Layla", "Yusuf"]);
    expect(items[0]).toMatchObject({
      id: p.photoId,
      profileId: p.owner,
      lastName: "Haddad",
      status: "pending",
      imageUrl: `/api/admin/photos/${p.photoId}/image`,
    });
    // No contact detail or sign-in address rides along.
    expect(JSON.stringify(queue.body)).not.toMatch(/@example\.test/);

    const image = await call(p.adminCookie, "GET", `/admin/photos/${p.photoId}/image`);
    expect(image.status).toBe(200);
    expect(image.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(image.bytes).equals(Buffer.from(p.bytes))).toBe(true);

    expect((await review(p.adminCookie, p.photoId, "approved")).status).toBe(200);
    expect((await call(p.adminCookie, "GET", "/admin/photos")).body.total).toBe(1);
    const approved = await call(p.adminCookie, "GET", "/admin/photos?status=approved");
    expect(approved.body.items.map((i: AdminPhoto) => i.id)).toEqual([p.photoId]);
  });

  it("a_new_upload_replaces_the_photo_and_waits_for_review_again", async () => {
    const p = await arrange();
    expect((await review(p.adminCookie, p.photoId, "approved")).status).toBe(200);

    const next = await upload(p.ownerCookie, webpBytes(2000), "image/webp");
    expect(next.status).toBe(201);
    expect(next.body.photo.id).not.toBe(p.photoId);
    expect(next.body.photo.status).toBe("pending");
    const rows = await db.pool.query("SELECT id FROM profile_photos WHERE profile_id = $1", [p.owner]);
    expect(rows.rows).toHaveLength(1);
    // The approved one is gone; the new one is not shown yet.
    expect((await call(null, "GET", `/photos/${p.owner}`)).status).toBe(404);
  });

  it("owner_removes_their_photo", async () => {
    const p = await arrange();
    expect((await review(p.adminCookie, p.photoId, "approved")).status).toBe(200);
    const removed = await call(p.ownerCookie, "DELETE", "/me/photo");
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ photo: null });
    expect(await photoRow(p.owner)).toBeNull();
    expect((await call(null, "GET", `/photos/${p.owner}`)).status).toBe(404);
    expect((await call(p.ownerCookie, "GET", "/me/photo")).body).toEqual({ photo: null });
    expect((await call(p.ownerCookie, "GET", "/me/photo/image")).status).toBe(404);
    // Removing nothing is fine.
    expect((await call(p.ownerCookie, "DELETE", "/me/photo")).status).toBe(200);
    expect((await call(null, "DELETE", "/me/photo")).status).toBe(401);
  });
});

describe("deletion and export", () => {
  it("sweep_deletes_the_photo_row", async () => {
    const p = await arrange();
    expect((await review(p.adminCookie, p.photoId, "approved")).status).toBe(200);
    // The leaver also reviewed someone else's photo as an administrator.
    const other = await makeMentor(db.pool);
    const otherPhoto = await upload(await cookieFor(other));
    await asSystem(db.pool, (client) => client.query("INSERT INTO admin_roles (profile_id) VALUES ($1)", [p.owner]));
    expect((await review(p.ownerCookie, otherPhoto.body.photo.id, "approved")).status).toBe(200);

    const deleted = await asSystem(db.pool, async (client) => {
      const d = await client.query<{ id: string }>(
        `INSERT INTO account_deletions (profile_id, execute_after, previous_visibility, immediate)
         VALUES ($1, now() - interval '1 minute', 'public', true) RETURNING id`,
        [p.owner],
      );
      return (await client.query<{ done: boolean }>("SELECT execute_account_deletion($1, now()) AS done", [d.rows[0].id])).rows[0].done;
    });
    expect(deleted).toBe(true);
    expect(await photoRow(p.owner)).toBeNull();
    expect((await photoRow(other))?.reviewed_by).toBeNull();
    expect((await call(null, "GET", `/photos/${p.owner}`)).status).toBe(404);
  });

  it("export_notes_the_photo_without_its_bytes", async () => {
    const p = await arrange();
    const res = await call(p.ownerCookie, "GET", "/me/export");
    expect(res.status).toBe(200);
    expect(res.body.photo).toEqual({
      status: "pending",
      contentType: "image/jpeg",
      byteSize: 4096,
      uploadedAt: expect.any(String),
      reviewedAt: null,
    });
    const text = new TextDecoder().decode(res.bytes);
    // Neither the image nor any encoding of it.
    expect(text).not.toContain(Buffer.from(p.bytes).toString("base64").slice(0, 40));
    expect(text).not.toContain(Buffer.from(p.bytes).toString("hex").slice(0, 40));
    expect(text).not.toMatch(/"image"/);

    // Another member's export says nothing about it.
    const other = await makeMentor(db.pool);
    expect((await call(await cookieFor(other), "GET", "/me/export")).body.photo).toBeNull();
  });
});
