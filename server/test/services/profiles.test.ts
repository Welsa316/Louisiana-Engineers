import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OwnProfile, OwnSettings, PreviewResponse } from "@shared/types/me";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { meRoutes } from "../../src/routes/me";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import {
  makePerson,
  newAccount,
  professionalPayload,
  rowsAs,
  runAs,
  studentPayload,
} from "../policies/fixtures";

/**
 * `/api/me/*`: onboarding, the owner's profile and settings, the kind switch
 * and the preview (Task 12). Every request goes through the real guards and
 * `withUser`, so Row Level Security and the SQL functions decide.
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
  await db.pool.query("UPDATE config SET value = '3' WHERE key = 'default_max_active'");
});

const ORIGIN = "http://127.0.0.1:8787";
const app = testApp(new Hono().route("/me", meRoutes));

async function cookieFor(userId: string): Promise<string> {
  return asSystem(db.pool, async (client) => (await createSession(wrapClient(client), userId, null)).value);
}

interface Call {
  status: number;
  body: any;
}

async function call(cookie: string | null, method: string, path: string, body?: unknown): Promise<Call> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (cookie) headers.cookie = `mest_session=${cookie}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/api/me${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Approves a professional the way an administrator's review does (system context). */
async function approve(id: string): Promise<void> {
  await asSystem(db.pool, async (client) => {
    await client.query("UPDATE profiles SET approval_state = 'approved' WHERE id = $1", [id]);
    await client.query(
      "UPDATE profile_reviews SET decision = 'approved', decided_at = now() WHERE profile_id = $1 AND decision IS NULL",
      [id],
    );
  });
}

describe("onboarding", () => {
  it("student_onboarding_lands_approved", async () => {
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);

    const res = await call(cookie, "POST", "/onboarding", studentPayload());
    expect(res.status).toBe(200);
    const profile = res.body as OwnProfile;
    expect(profile.kind).toBe("student");
    expect(profile.approvalState).toBe("approved");
    expect(profile.visibility).toBe("hidden");
    expect(profile.review).toBeNull();
    expect(profile.student?.program).toBe("BS Civil Engineering, junior");
    expect(profile.professional).toBeNull();
    expect(profile.settings.mentorship).toBeNull();
    expect(profile.settings.notifications?.requests).toBe(true);

    // The stored state agrees, read back through the same endpoint.
    const again = await call(cookie, "GET", "/profile");
    expect(again.status).toBe(200);
    expect(again.body.approvalState).toBe("approved");

    // A second onboarding is refused by complete_onboarding.
    const twice = await call(cookie, "POST", "/onboarding", studentPayload());
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("already_onboarded");
  });

  it("professional_onboarding_pending_with_review", async () => {
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);

    const res = await call(cookie, "POST", "/onboarding", professionalPayload());
    expect(res.status).toBe(200);
    const profile = res.body as OwnProfile;
    expect(profile.kind).toBe("professional");
    expect(profile.approvalState).toBe("pending");
    expect(profile.review).not.toBeNull();
    expect(profile.review?.decision).toBeNull();
    expect(profile.review?.notes).toBeNull();
    expect(profile.professional?.title).toBe("Water Resources Engineer");
    expect(profile.settings.mentorship?.status).toBe("active");
    expect(profile.settings.mentorship?.maxActive).toBe(3);
    expect(profile.settings.contact?.shareWithMembers).toEqual(["email"]);

    // A visitor cannot see the pending profile at all.
    expect(await rowsAs(db.pool, null, "SELECT id FROM profiles WHERE id = $1", [id])).toEqual([]);
  });

  it("onboarding_refuses_an_invalid_payload_and_a_missing_mission", async () => {
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);
    const noMission = await call(cookie, "POST", "/onboarding", professionalPayload({ acceptMission: false }));
    expect(noMission.status).toBe(400);
    expect(noMission.body.code).toBe("validation");
    const shortBio = await call(cookie, "POST", "/onboarding", professionalPayload({ bio: "Too short." }));
    expect(shortBio.status).toBe(400);
    const profile = await call(cookie, "GET", "/profile");
    expect(profile.body.kind).toBeNull();
  });

  it("unknown_expertise_becomes_proposed", async () => {
    await asSystem(db.pool, (client) =>
      client.query("INSERT INTO expertise_tags (label, slug, status) VALUES ('Hydraulic modeling', 'hydraulic-modeling', 'approved')"),
    );
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);

    const res = await call(cookie, "POST", "/onboarding", professionalPayload({ expertise: ["Hydraulic modeling", "Tidal origami"] }));
    expect(res.status).toBe(200);
    const tags = (res.body as OwnProfile).professional?.expertise ?? [];
    expect(tags.map((t) => [t.label, t.status])).toEqual([
      ["Hydraulic modeling", "approved"],
      ["Tidal origami", "proposed"],
    ]);

    // A later patch with another unknown label proposes that one too.
    const patched = await call(cookie, "PATCH", "/profile", { expertise: ["Hydraulic modeling", "Marsh acoustics"] });
    expect(patched.status).toBe(200);
    expect((patched.body as OwnProfile).professional?.expertise.map((t) => [t.label, t.status])).toEqual([
      ["Hydraulic modeling", "approved"],
      ["Marsh acoustics", "proposed"],
    ]);

    // Once approved, a visitor sees the approved tag only.
    await approve(id);
    const seen = await rowsAs<{ tags: string[] }>(db.pool, null, "SELECT tags FROM directory_entries WHERE id = $1", [id]);
    expect(seen).toEqual([{ tags: ["Hydraulic modeling"] }]);

    // A rejected label is refused with its domain code.
    await asSystem(db.pool, (client) =>
      client.query("INSERT INTO expertise_tags (label, slug, status) VALUES ('Snake oil', 'snake-oil', 'rejected')"),
    );
    const rejected = await call(cookie, "PATCH", "/profile", { expertise: ["Hydraulic modeling", "Snake oil"] });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe("tag_rejected");
  });
});

describe("own profile", () => {
  it("own_profile_requires_a_session", async () => {
    expect((await call(null, "GET", "/profile")).status).toBe(401);
    expect((await call(null, "GET", "/settings")).status).toBe(401);
    expect((await call(null, "GET", "/preview?as=visitor")).status).toBe(401);
    const res = await call(null, "PATCH", "/profile", { firstName: "Nobody" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthenticated");
  });

  it("own_linkedin_through_definer_function_only", async () => {
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);
    const linkedinUrl = "https://www.linkedin.com/in/noor-bayou";
    await call(cookie, "POST", "/onboarding", professionalPayload({ linkedinUrl }));
    await approve(id);

    const own = await call(cookie, "GET", "/profile");
    expect(own.body.linkedinUrl).toBe(linkedinUrl);

    // The column itself stays withheld from every request, the owner's included.
    const other = await makePerson(db.pool);
    for (const viewer of [null, other, id]) {
      await expect(runAs(db.pool, viewer, "SELECT linkedin_url FROM profiles WHERE id = $1", [id])).rejects.toThrow(
        /permission denied/,
      );
    }
    // The definer function answers for the caller only.
    expect(await rowsAs(db.pool, other, "SELECT * FROM my_profile_private()")).toEqual([{ linkedin_url: null }]);
    expect(await rowsAs(db.pool, null, "SELECT * FROM my_profile_private()")).toEqual([]);

    // The owner clears it, which a LinkedIn contact method would forbid.
    const withMethod = await call(cookie, "PATCH", "/settings", {
      contact: { methods: ["mest", "linkedin"], shareWithMembers: ["linkedin"] },
    });
    expect(withMethod.status).toBe(200);
    const cleared = await call(cookie, "PATCH", "/profile", { linkedinUrl: null });
    expect(cleared.status).toBe(409);
    expect(cleared.body.code).toBe("invalid_contact");
    await call(cookie, "PATCH", "/settings", { contact: { methods: ["mest"] } });
    const clearedNow = await call(cookie, "PATCH", "/profile", { linkedinUrl: "" });
    expect(clearedNow.status).toBe(200);
    expect(clearedNow.body.linkedinUrl).toBeNull();
  });

  it("profile_patch_writes_owner_columns_and_refuses_protected_ones", async () => {
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);
    await call(cookie, "POST", "/onboarding", professionalPayload());

    const res = await call(cookie, "PATCH", "/profile", {
      firstName: "Nour",
      credentials: "",
      title: "Senior Water Resources Engineer",
      yearsExperience: 13,
      interests: ["Wetlands"],
      education: [{ degree: "MS", field: "Coastal Engineering", school: "A Gulf Coast university", year: 2015 }],
    });
    expect(res.status).toBe(200);
    const profile = res.body as OwnProfile;
    expect(profile.firstName).toBe("Nour");
    expect(profile.credentials).toBeNull();
    expect(profile.professional?.title).toBe("Senior Water Resources Engineer");
    expect(profile.professional?.yearsExperience).toBe(13);
    expect(profile.professional?.interests).toEqual(["Wetlands"]);
    expect(profile.education).toEqual([{ degree: "MS", field: "Coastal Engineering", school: "A Gulf Coast university", year: 2015 }]);

    for (const body of [{ approvalState: "approved" }, { kind: "student" }, { verified: true }, {}]) {
      const refused = await call(cookie, "PATCH", "/profile", body);
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe("validation");
    }
    // Student fields on a professional, and a cleared professional bio, are refused.
    const studentField = await call(cookie, "PATCH", "/profile", { program: "BS Physics" });
    expect(studentField.status).toBe(409);
    expect(studentField.body.code).toBe("not_student");
    const noBio = await call(cookie, "PATCH", "/profile", { bio: null });
    expect(noBio.status).toBe(409);
    expect(noBio.body.code).toBe("bio_required");
    expect((await call(cookie, "GET", "/profile")).body.approvalState).toBe("pending");
  });

  it("member_with_open_deletion_cannot_write", async () => {
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);
    await call(cookie, "POST", "/onboarding", studentPayload());
    await asSystem(db.pool, (client) =>
      client.query(
        "INSERT INTO account_deletions (profile_id, execute_after, previous_visibility) VALUES ($1, now() + interval '14 days', 'hidden')",
        [id],
      ),
    );
    const res = await call(cookie, "PATCH", "/profile", { firstName: "Gone" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("not_member");
    // Reading their own profile still works during the grace period.
    const read = await call(cookie, "GET", "/profile");
    expect(read.status).toBe(200);
    expect(read.body.firstName).toBe("Sami");
  });
});

describe("kind", () => {
  it("set_kind_keeps_saved", async () => {
    const mentor = await makePerson(db.pool, { firstName: "Layla" });
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);
    await call(cookie, "POST", "/onboarding", studentPayload({ bio: undefined }));
    await runAs(db.pool, id, "SELECT save_profile($1)", [mentor]);

    const res = await call(cookie, "POST", "/kind", { kind: "professional" });
    expect(res.status).toBe(200);
    const profile = res.body as OwnProfile;
    expect(profile.kind).toBe("professional");
    expect(profile.approvalState).toBe("pending");
    expect(profile.review?.decision).toBeNull();
    expect(profile.settings.mentorship?.status).toBe("off");

    // The saved profile is still there.
    expect(await rowsAs(db.pool, id, "SELECT saved_id FROM saved_profiles")).toEqual([{ saved_id: mentor }]);

    // The new professional fills in their details through the profile patch.
    const missing = await call(cookie, "PATCH", "/profile", { title: "Engineer in training" });
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe("professional_details_required");
    const filled = await call(cookie, "PATCH", "/profile", {
      bio: "I am finishing a civil engineering degree and starting at a drainage firm, and I would like to meet people working on the coast.",
      title: "Engineer in training",
      organization: "Delta Drainage Partners",
      disciplineId: "civil",
      yearsExperience: 0,
      participation: ["directory", "networking"],
      expertise: ["Stormwater", "Surveying"],
    });
    expect(filled.status).toBe(200);
    expect(filled.body.professional.organization).toBe("Delta Drainage Partners");
    expect(filled.body.professional.participation).toEqual(["directory", "networking"]);

    const bad = await call(cookie, "POST", "/kind", { kind: "admin" });
    expect(bad.status).toBe(400);
  });
});

describe("settings", () => {
  it("mentoring_requires_participation", async () => {
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);
    await call(
      cookie,
      "POST",
      "/onboarding",
      professionalPayload({ participation: ["directory", "networking"], mentorship: undefined }),
    );

    const refused = await call(cookie, "PATCH", "/settings", {
      mentorship: { status: "active", topics: ["graduate-school"], audience: ["grad"] },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("mentoring_not_offered");
    // Nothing from the refused patch was kept.
    const before = (await call(cookie, "GET", "/settings")).body as OwnSettings;
    expect(before.mentorship?.status).toBe("off");
    expect(before.mentorship?.topics).toEqual([]);

    await call(cookie, "PATCH", "/profile", { participation: ["directory", "networking", "mentoring"] });
    const accepted = await call(cookie, "PATCH", "/settings", {
      mentorship: { status: "active", topics: ["graduate-school"], audience: ["grad"] },
    });
    expect(accepted.status).toBe(200);
    expect((accepted.body as OwnSettings).mentorship?.status).toBe("active");
    expect((accepted.body as OwnSettings).mentorship?.topics).toEqual(["graduate-school"]);

    // Dropping mentoring from participation turns the offer off.
    await call(cookie, "PATCH", "/profile", { participation: ["directory"] });
    expect(((await call(cookie, "GET", "/settings")).body as OwnSettings).mentorship?.status).toBe("off");
  });

  it("lowering_max_active_keeps_relationships", async () => {
    // Relationships arrive with Task 19, which adds an accepted mentee here
    // and asserts it survives; until then the offer must stay open and keep
    // every other setting when the cap drops.
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);
    await call(cookie, "POST", "/onboarding", professionalPayload());

    const res = await call(cookie, "PATCH", "/settings", { mentorship: { maxActive: 1 } });
    expect(res.status).toBe(200);
    const settings = res.body as OwnSettings;
    expect(settings.mentorship?.maxActive).toBe(1);
    expect(settings.mentorship?.status).toBe("active");
    expect(settings.mentorship?.topics).toEqual(["internships-and-first-jobs", "professional-licensure"]);
    expect(settings.mentorship?.availability).toBe("Weekday evenings");
  });

  it("pause_with_resume_date_and_unknown_topic", async () => {
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);
    await call(cookie, "POST", "/onboarding", professionalPayload());

    const paused = await call(cookie, "PATCH", "/settings", { mentorship: { status: "paused", resumeOn: "2099-01-15" } });
    expect(paused.status).toBe(200);
    expect(paused.body.mentorship.status).toBe("paused");
    expect(paused.body.mentorship.pausedUntil).toBe("2099-01-15");

    const noDate = await call(cookie, "PATCH", "/settings", { mentorship: { resumeOn: "2099-01-15" } });
    expect(noDate.status).toBe(400);

    const unknown = await call(cookie, "PATCH", "/settings", { mentorship: { topics: ["basket-weaving"] } });
    expect(unknown.status).toBe(409);
    expect(unknown.body.code).toBe("invalid_topic");
  });

  it("contact_visibility_and_notification_settings", async () => {
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);
    await call(cookie, "POST", "/onboarding", professionalPayload());

    // Sharing a phone number needs the number.
    const noPhone = await call(cookie, "PATCH", "/settings", {
      contact: { methods: ["mest", "email", "phone"], shareWithMembers: ["phone"] },
    });
    expect(noPhone.status).toBe(409);
    expect(noPhone.body.code).toBe("invalid_contact");

    const res = await call(cookie, "PATCH", "/settings", {
      visibility: "members",
      contact: { methods: ["mest", "email", "phone"], shareWithMembers: ["email", "phone"], phone: "+15045550123" },
      notifications: { requests: false, productUpdates: true },
    });
    expect(res.status).toBe(200);
    const settings = res.body as OwnSettings;
    expect(settings.visibility).toBe("members");
    expect(settings.contact).toEqual({
      methods: ["mest", "email", "phone"],
      shareWithMembers: ["email", "phone"],
      contactEmail: null,
      phone: "+15045550123",
      bookingUrl: null,
    });
    expect(settings.notifications?.requests).toBe(false);
    expect(settings.notifications?.productUpdates).toBe(true);

    // Turning a method off also stops sharing it.
    const off = await call(cookie, "PATCH", "/settings", { contact: { methods: ["mest", "email"] } });
    expect(off.status).toBe(200);
    expect(off.body.contact.shareWithMembers).toEqual(["email"]);

    // A student has no listing to change.
    const student = await newAccount(db.pool);
    const studentCookie = await cookieFor(student);
    await call(studentCookie, "POST", "/onboarding", studentPayload());
    const studentVisibility = await call(studentCookie, "PATCH", "/settings", { visibility: "public" });
    expect(studentVisibility.status).toBe(409);
    expect(studentVisibility.body.code).toBe("not_professional");
    const studentNotifications = await call(studentCookie, "PATCH", "/settings", { notifications: { reminders: false } });
    expect(studentNotifications.status).toBe(200);
    expect(studentNotifications.body.notifications.reminders).toBe(false);
  });

  it("touch_records_activity_once_a_day", async () => {
    const id = await newAccount(db.pool);
    const cookie = await cookieFor(id);
    expect((await call(cookie, "POST", "/touch")).body).toEqual({ touched: true });
    expect((await call(cookie, "POST", "/touch")).body).toEqual({ touched: false });
  });
});

describe("preview", () => {
  it("preview_as_visitor_hides_members_only_profile", async () => {
    await asSystem(db.pool, (client) =>
      client.query("INSERT INTO expertise_tags (label, slug, status) VALUES ('Hydraulic modeling', 'hydraulic-modeling', 'approved')"),
    );
    const id = await newAccount(db.pool, { email: "noor@example.test" });
    const cookie = await cookieFor(id);
    await call(
      cookie,
      "POST",
      "/onboarding",
      professionalPayload({
        visibility: "members",
        expertise: ["Hydraulic modeling", "Tidal origami"],
        contact: { methods: ["mest", "email", "phone"], shareWithMembers: ["email"], phone: "+15045550123" },
      }),
    );

    // While pending, nobody else can see it.
    const pending = (await call(cookie, "GET", "/preview?as=member")).body as PreviewResponse;
    expect(pending).toEqual({ as: "member", access: "none" });

    await approve(id);
    const visitor = (await call(cookie, "GET", "/preview?as=visitor")).body as PreviewResponse;
    expect(visitor).toEqual({ as: "visitor", access: "members_only" });

    const member = (await call(cookie, "GET", "/preview?as=member")).body as PreviewResponse;
    expect(member.access).toBe("visible");
    expect(member.profile?.firstName).toBe("Noor");
    // The owner's own proposed tag is not part of what others see.
    expect(member.profile?.tags).toEqual(["Hydraulic modeling"]);
    // The same shape a viewer gets from GET /api/profiles/:id, without the owner-only fields.
    expect(member.profile).toMatchObject({ isOwner: false, saved: false });
    expect(member.profile).not.toHaveProperty("approvalState");
    expect(member.profile?.mentorship).toMatchObject({ status: "active" });
    // The shared method only, resolved to the sign-in address; the phone is not shared.
    expect(member.contact).toEqual([{ method: "email", value: "noor@example.test" }]);
    // The preview reads, it does not release: no contact.viewed entry.
    const audits = await asSystem(db.pool, (client) =>
      client.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'contact.viewed'"),
    );
    expect(audits.rows[0].n).toBe(0);

    // Public: a visitor sees the profile but never contact values.
    await call(cookie, "PATCH", "/settings", { visibility: "public" });
    const publicVisitor = (await call(cookie, "GET", "/preview?as=visitor")).body as PreviewResponse;
    expect(publicVisitor.access).toBe("visible");
    expect(publicVisitor.profile?.lastName).toBe("Bayou");
    expect(publicVisitor.contact).toBeUndefined();

    // Hidden: nobody.
    await call(cookie, "PATCH", "/settings", { visibility: "hidden" });
    expect((await call(cookie, "GET", "/preview?as=member")).body).toEqual({ as: "member", access: "none" });

    expect((await call(cookie, "GET", "/preview?as=admin")).status).toBe(400);
  });
});
