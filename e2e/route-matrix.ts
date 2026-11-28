import { expect, type APIRequestContext, type APIResponse, type Locator, type Page } from "@playwright/test";
import { seedFeedback } from "../server/seed/feedback";
import { seedRequestId } from "../server/seed/requests";
import { seedEmail, seedUserId } from "../server/seed/users";
import { closePool } from "../server/src/db/pool";
import { withSystem, type Db } from "../server/src/db/tx";

/**
 * Every screen of the network app, grouped by who can open it, for the
 * accessibility and overflow passes (Tasks 28 and 39). Each group signs in
 * through the test-only dev-login route and opens its pages. Most groups
 * only read. The groups that need a state the seed does not hold (a second
 * region, a chapter administrator, photos waiting or shown, a feedback
 * comment, a calendar feed, an account in its deletion grace period) set it
 * up first and put it back afterwards, so no seeded row is left changed for
 * the specs that follow.
 */

export type Viewer =
  | "visitor"
  | "newcomer"
  | "student"
  | "mentee"
  | "alumnus"
  | "mentor"
  | "photographer"
  | "admin"
  | "moderator"
  | "chapter"
  | "leaving";

type Role = Parameters<Page["getByRole"]>[0];

export interface Screen {
  /** Path under the origin. */
  path: string;
  /** What the page shows once it has loaded (a level-1 heading, or a dialog for drawer routes). */
  ready?: "h1" | "dialog";
  /**
   * A button to press once loaded, so the state it opens is checked too. A
   * string names it exactly (the last match is pressed); a pattern presses
   * the first match, for a row whose name comes from the data.
   */
  press?: string | RegExp;
  /** What pressing opens: a dialog (the default), or a control by role and name. */
  opens?: { role: Role; name: string };
  /** Something that must be on screen before the checks run: the state this entry is here for. */
  shows?: (page: Page) => Locator;
  /** Only in one project (the control or the state exists only there). */
  only?: "phone" | "desktop";
}

const LAYLA = seedUserId("layla-haddad");
const TARIQ = seedUserId("tariq-mansour");
const YAHYA = seedUserId("yahya-abdullah");

/** The second region the chapter group adds; only one is seeded. */
const SECOND_REGION = { id: "acadiana", label: "Acadiana" };

const text = (value: string | RegExp) => (page: Page) => page.getByText(value).first();
const photo = (page: Page) => page.locator("img.pn-mono-photo").first();

export const SCREENS: Record<Viewer, Screen[]> = {
  visitor: [
    { path: "/network" },
    { path: "/network/directory" },
    { path: "/network/directory?q=coastal" },
    { path: "/network/directory", press: "Filters", only: "phone" },
    { path: `/network/directory/${LAYLA}` },
    // Members-only: a visitor gets the sign-in screen for it.
    { path: `/network/directory/${TARIQ}` },
    { path: "/network/mentorship" },
    { path: "/network/signin" },
    { path: "/network/signin?error=link" },
    { path: "/network/check-email" },
    { path: "/network/join" },
    { path: "/network/guidelines" },
    { path: "/network/privacy" },
    { path: "/network/no-such-page" },
  ],
  newcomer: [{ path: "/network/onboarding" }],
  student: [
    { path: "/network/me" },
    { path: "/network/me/discover" },
    { path: `/network/me/discover/${LAYLA}` },
    { path: `/network/directory/${LAYLA}`, press: "Report this profile" },
    { path: "/network/me/requests" },
    { path: `/network/me/requests/new?mentor=${LAYLA}` },
    { path: `/network/me/requests/${seedRequestId("req-1001")}` },
    { path: `/network/me/requests/${seedRequestId("req-1002")}` },
    { path: "/network/me/saved" },
    // Meetings (Task 31): the log in both tabs; req-1001 above carries a
    // meeting to come, one to answer and the Propose times dialog.
    { path: "/network/me/meetings" },
    { path: "/network/me/meetings?show=past" },
    { path: `/network/me/requests/${seedRequestId("req-1001")}`, press: "Propose times" },
    { path: `/network/me/requests/${seedRequestId("req-1001")}`, press: "Cancel meeting" },
    { path: "/network/notifications" },
    { path: "/network/settings" },
    // The photo card with no photo yet (Task 33).
    { path: "/network/settings/profile", shows: text("Choose a photo") },
    { path: "/network/settings/privacy" },
    { path: "/network/settings/notifications" },
    // The calendar feed (Task 37): off, then turned on (the address is
    // shown once, in a read-only field), then the step that confirms
    // turning it off. The clean-up turns it off.
    { path: "/network/settings/calendar", shows: text(/^Off\. Turn it on/) },
    { path: "/network/settings/calendar", press: "Turn on the feed", opens: { role: "textbox", name: "Your feed address" } },
    { path: "/network/settings/calendar", press: "Turn the feed off", opens: { role: "group", name: "Confirm" } },
    { path: "/network/settings/preview" },
    { path: "/network/settings/account" },
  ],
  // Sumaya Osman, choosing from the three times Layla proposed (seed/meetings.ts).
  mentee: [{ path: `/network/me/requests/${seedRequestId("req-1005")}` }, { path: "/network/me/meetings" }],
  // Idris Fofana, whose mentorship with Layla is completed (req-1006): the
  // two feedback questions on the mentee's side (Task 32), and the meeting
  // they held.
  alumnus: [
    {
      path: `/network/me/requests/${seedRequestId("req-1006")}`,
      shows: (page) => page.getByRole("region", { name: "How did it go?" }),
    },
    { path: "/network/me/meetings?show=past" },
  ],
  mentor: [
    { path: "/network/me" },
    { path: "/network/mentor" },
    { path: "/network/mentor/requests" },
    { path: `/network/mentor/requests/${seedRequestId("req-1003")}`, ready: "dialog" },
    { path: `/network/mentor/requests/${seedRequestId("req-1003")}`, ready: "dialog", press: "Accept" },
    { path: `/network/mentor/requests/${seedRequestId("req-1004")}`, ready: "dialog", press: "Decline" },
    { path: "/network/mentor/mentees" },
    // The mentee's page with its meetings panel (Task 31), and the
    // completed one with the feedback card (Task 32).
    {
      path: `/network/mentor/mentees/${seedRequestId("req-1005")}`,
      shows: (page) => page.getByRole("region", { name: "Meetings" }),
    },
    { path: `/network/mentor/mentees/${seedRequestId("req-1005")}`, press: "Change the times" },
    {
      path: `/network/mentor/mentees/${seedRequestId("req-1006")}`,
      shows: (page) => page.getByRole("region", { name: "How did it go?" }),
    },
    { path: "/network/me/meetings?show=past" },
    { path: "/network/settings/mentorship" },
    { path: "/network/settings/privacy" },
    { path: "/network/settings/account" },
  ],
  // Yahya Abdullah with an approved photo (Task 33): his own photo card, and
  // the photo in place of his initials on the directory and his profile.
  photographer: [
    { path: "/network/settings/profile", shows: text("Choose a different photo") },
    { path: "/network/directory?q=Abdullah", shows: photo },
    { path: `/network/directory/${YAHYA}`, shows: photo },
  ],
  admin: [
    { path: "/network/admin" },
    { path: "/network/admin/queue" },
    { path: "/network/admin/queue", press: "Review Dawud Jenkins" },
    { path: "/network/admin/members" },
    // Granting from the members list chooses a scope (Task 38).
    {
      path: "/network/admin/members",
      press: /^Make administrator\b/,
      shows: text("A regional administrator acts only on members in that region."),
    },
    // The photo queue's three tabs with nothing in them (Task 33).
    { path: "/network/admin/photos", shows: text("No photos are waiting.") },
    { path: "/network/admin/photos?status=approved", shows: text("No photos are shown yet.") },
    { path: "/network/admin/photos?status=rejected", shows: text("No photos were turned down.") },
    // The vocabulary tools (Task 34): merge and rename a tag, retire a topic.
    { path: "/network/admin/vocabulary" },
    { path: "/network/admin/vocabulary", press: /^Merge / },
    { path: "/network/admin/vocabulary", press: /^Rename / },
    { path: "/network/admin/vocabulary", press: /^Retire / },
    // The feedback measures and comments (Task 32), with no comment yet.
    { path: "/network/admin/mentorship", shows: text("No comments yet.") },
    { path: "/network/admin/reports" },
    { path: "/network/admin/administrators", shows: text("Every region") },
    { path: "/network/admin/settings" },
  ],
  // An administrator with work waiting: Rania Khalil's photo to review,
  // Yahya Abdullah's shown, and Idris Fofana's comment on his mentorship.
  moderator: [
    { path: "/network/admin/photos", shows: (page) => page.getByRole("img", { name: /Rania Khalil/ }) },
    { path: "/network/admin/photos?status=approved", shows: (page) => page.getByRole("img", { name: /Yahya Abdullah/ }) },
    { path: "/network/admin/mentorship", shows: text("From a mentee") },
  ],
  // Admin Two as a chapter administrator for Greater New Orleans, with a
  // second active region (Task 38): the region filters, the grant dialog
  // held to the chapter's own region, the Region column and the region
  // choice in Settings.
  chapter: [
    {
      path: "/network/admin/members",
      shows: (page) =>
        page.getByRole("combobox", { name: "Region" }).filter({ has: page.locator(`option[value="${SECOND_REGION.id}"]`) }),
    },
    {
      path: "/network/admin/members",
      press: /^Make administrator\b/,
      shows: text("You administer one region, so you can grant that region only."),
    },
    { path: "/network/admin/administrators", shows: text("Greater New Orleans") },
    { path: "/network/directory", only: "desktop", shows: (page) => page.getByRole("button", { name: SECOND_REGION.label }) },
    {
      path: "/network/directory",
      press: "Filters",
      only: "phone",
      shows: (page) => page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: SECOND_REGION.label }),
    },
    {
      path: `/network/directory?region=${SECOND_REGION.id}`,
      // The removable chip for the filter in effect, in both layouts.
      shows: (page) =>
        page
          .getByRole("button", { name: new RegExp(SECOND_REGION.label) })
          .filter({ visible: true })
          .first(),
    },
    { path: "/network/settings/profile", shows: (page) => page.getByRole("combobox", { name: /Region/ }) },
    // Feedback comments are for administrators for every region only (Task 39).
    { path: "/network/admin/mentorship", shows: text("Members' comments are shown only to administrators for every region.") },
  ],
  leaving: [{ path: "/network/scheduled-for-deletion" }],
};

const SEED_KEY: Partial<Record<Viewer, string>> = {
  student: "amina-rahman",
  mentee: "sumaya-osman",
  alumnus: "idris-fofana",
  mentor: "layla-haddad",
  photographer: "yahya-abdullah",
  admin: "admin",
  moderator: "admin",
  chapter: "admin2",
};

type CleanUp = () => Promise<void>;
const nothing: CleanUp = async () => {};

/**
 * What a group needs set up before it signs in, returning what puts it
 * back. A set-up signs in as whoever it needs; `signInAs` signs in as the
 * viewer afterwards.
 */
const PREPARE: Partial<Record<Viewer, (page: Page, origin: string) => Promise<CleanUp>>> = {
  // The calendar screens turn Amina's feed on; this turns it off again.
  student: async (page, origin) => async () => {
    await signInSeed(page, "amina-rahman");
    await expectOk(page.request.delete("/api/me/calendar", { headers: { Origin: origin } }));
  },
  photographer: async (page, origin) => {
    await uploadPhoto(page, origin, "yahya-abdullah");
    await decidePhoto(page, origin, YAHYA, "approved");
    return () => removePhoto(page, origin, "yahya-abdullah");
  },
  moderator: async (page, origin) => {
    await uploadPhoto(page, origin, "rania-khalil");
    await uploadPhoto(page, origin, "yahya-abdullah");
    await decidePhoto(page, origin, YAHYA, "approved");
    await signInSeed(page, "idris-fofana");
    await expectOk(
      page.request.post(`/api/requests/${seedRequestId("req-1006")}/feedback`, {
        data: { helpful: 4, comment: "Clear advice on which internships to apply for, and honest about the trade-offs." },
        headers: { Origin: origin },
      }),
    );
    return async () => {
      await removePhoto(page, origin, "rania-khalil");
      await removePhoto(page, origin, "yahya-abdullah");
      // Takes back the answer on the seeded relationship.
      await asSystem(seedFeedback);
    };
  },
  chapter: async () => {
    await asSystem(async (db) => {
      await db.query(
        `INSERT INTO regions (id, label, sort_order, active) VALUES ($1, $2, 2, true)
         ON CONFLICT (id) DO UPDATE SET active = true`,
        [SECOND_REGION.id, SECOND_REGION.label],
      );
      await db.query("UPDATE admin_roles SET region_id = 'greater-new-orleans' WHERE profile_id = $1", [
        seedUserId("admin2"),
      ]);
    });
    return () =>
      asSystem(async (db) => {
        await db.query("UPDATE admin_roles SET region_id = NULL WHERE profile_id = $1", [seedUserId("admin2")]);
        await db.query("DELETE FROM regions WHERE id = $1", [SECOND_REGION.id]);
      });
  },
};

/**
 * Signs `page` in as the viewer, after setting up what its group needs.
 * The newcomer and the leaving member are fresh addresses; the leaving
 * member then asks to delete the account (it has no name on file, so the
 * confirmation word is "delete"). Returns the clean-up to run afterwards.
 */
export async function signInAs(page: Page, viewer: Viewer, origin: string, label: string): Promise<CleanUp> {
  if (viewer === "visitor") return nothing;
  const prepare = PREPARE[viewer];
  const restore = prepare ? await prepare(page, origin) : nothing;
  try {
    const key = SEED_KEY[viewer];
    const email = key ? seedEmail(key) : `${viewer}-${label}-${Date.now()}@example.test`;
    await expectOk(page.request.post("/api/auth/dev-login", { data: { email } }));
    if (viewer !== "leaving") return restore;

    await expectOk(
      page.request.post("/api/me/deletion", {
        data: { confirmName: "delete" },
        headers: { Origin: origin },
      }),
    );
    return async () => {
      await keepAccount(page.request, origin);
    };
  } catch (error) {
    await restore();
    throw error;
  }
}

async function keepAccount(request: APIRequestContext, origin: string): Promise<void> {
  await expectOk(request.delete("/api/me/deletion", { headers: { Origin: origin } }));
}

async function expectOk(pending: Promise<APIResponse>): Promise<void> {
  const res = await pending;
  expect(res.ok(), `${res.url()}: ${res.status()} ${await res.text()}`).toBe(true);
}

async function signInSeed(page: Page, key: string): Promise<void> {
  await expectOk(page.request.post("/api/auth/dev-login", { data: { email: seedEmail(key) } }));
}

/** Runs `fn` as the database owner, then lets the pool go, as the re-seed does. */
async function asSystem(fn: (db: Db) => Promise<void>): Promise<void> {
  try {
    await withSystem(fn);
  } finally {
    await closePool();
  }
}

let jpeg: Buffer | undefined;

/**
 * A real JPEG the browser can decode (a plain square drawn on a canvas), so
 * the screens show the image rather than falling back to the initials.
 */
async function testJpeg(page: Page): Promise<Buffer> {
  if (jpeg) return jpeg;
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#6b7a8f";
    ctx.fillRect(0, 0, 320, 320);
    ctx.fillStyle = "#d9dee6";
    ctx.beginPath();
    ctx.arc(160, 130, 64, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(64, 220, 192, 100);
    return canvas.toDataURL("image/jpeg", 0.85);
  });
  jpeg = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  return jpeg;
}

/** Uploads a photo as the seeded member `key`; it waits for review. */
async function uploadPhoto(page: Page, origin: string, key: string): Promise<void> {
  const buffer = await testJpeg(page);
  await signInSeed(page, key);
  await expectOk(
    page.request.post("/api/me/photo", {
      multipart: { photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer } },
      headers: { Origin: origin },
    }),
  );
}

/** Decides the waiting photo of `profileId` as the seeded administrator. */
async function decidePhoto(page: Page, origin: string, profileId: string, decision: "approved" | "rejected"): Promise<void> {
  await signInSeed(page, "admin");
  const res = await page.request.get("/api/admin/photos?status=pending&size=50");
  expect(res.ok(), await res.text()).toBe(true);
  const { items } = (await res.json()) as { items: { id: string; profileId: string }[] };
  const waiting = items.find((item) => item.profileId === profileId);
  if (!waiting) throw new Error(`no waiting photo for ${profileId}`);
  await expectOk(page.request.post(`/api/admin/photos/${waiting.id}`, { data: { decision }, headers: { Origin: origin } }));
}

async function removePhoto(page: Page, origin: string, key: string): Promise<void> {
  await signInSeed(page, key);
  await expectOk(page.request.delete("/api/me/photo", { headers: { Origin: origin } }));
}

/** The screens to check in a project: phone-only states are skipped on wide screens, and the reverse. */
export function screensFor(viewer: Viewer, projectName: string): Screen[] {
  const phone = projectName === "mobile-375";
  return SCREENS[viewer].filter((screen) => !screen.only || (screen.only === "phone") === phone);
}

/** A label for a screen in a failure list. */
export function screenLabel(screen: Screen): string {
  return screen.press ? `${screen.path} [${String(screen.press)}]` : screen.path;
}

/**
 * Opens a screen, waits until its data has loaded, presses its button, if
 * any, and waits for the state the entry is there for.
 */
export async function openScreen(page: Page, screen: Screen): Promise<void> {
  await page.goto(screen.path);
  await page.waitForLoadState("networkidle");
  if (screen.ready === "dialog") {
    await expect(page.getByRole("dialog").first()).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  }
  // Nothing still saying it is loading.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  if (screen.press) {
    const button =
      typeof screen.press === "string"
        ? page.getByRole("button", { name: screen.press, exact: true }).last()
        : page.getByRole("button", { name: screen.press }).first();
    await button.click();
    const opened = screen.opens
      ? page.getByRole(screen.opens.role, { name: screen.opens.name, exact: true })
      : page.getByRole("dialog");
    await expect(opened.last()).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
  if (screen.shows) await expect(screen.shows(page)).toBeVisible();
  await settled(page);
}

/**
 * Waits for every finite animation and transition to finish (a sheet sliding
 * in, a fade), so the checks read the composed screen rather than a frame
 * of its entrance.
 */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity),
  );
}
