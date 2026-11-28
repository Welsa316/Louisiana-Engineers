import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { seedRequestId } from "../server/seed/requests";
import { seedEmail, seedUserId } from "../server/seed/users";

/**
 * Every screen of the network app, grouped by who can open it, for the
 * accessibility and overflow passes (Task 28). The checks only read: each
 * group signs in through the test-only dev-login route and opens its pages;
 * the one group that needs state of its own (an account in its deletion
 * grace period) uses a fresh address and keeps its account afterwards, so
 * no seeded row changes.
 */

export type Viewer = "visitor" | "newcomer" | "student" | "mentee" | "mentor" | "admin" | "leaving";

export interface Screen {
  /** Path under the origin. */
  path: string;
  /** What the page shows once it has loaded (a level-1 heading, or a dialog for drawer routes). */
  ready?: "h1" | "dialog";
  /** A button to press once loaded, so the state it opens (a sheet or dialog) is checked too. */
  press?: string;
  /** Only on phones (the control exists only there). */
  phoneOnly?: boolean;
}

const LAYLA = seedUserId("layla-haddad");
const TARIQ = seedUserId("tariq-mansour");

export const SCREENS: Record<Viewer, Screen[]> = {
  visitor: [
    { path: "/network" },
    { path: "/network/directory" },
    { path: "/network/directory?q=coastal" },
    { path: "/network/directory", press: "Filters", phoneOnly: true },
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
    { path: "/network/settings/profile" },
    { path: "/network/settings/privacy" },
    { path: "/network/settings/notifications" },
    { path: "/network/settings/calendar" },
    { path: "/network/settings/preview" },
    { path: "/network/settings/account" },
  ],
  // Sumaya Osman, choosing from the three times Layla proposed (seed/meetings.ts).
  mentee: [{ path: `/network/me/requests/${seedRequestId("req-1005")}` }, { path: "/network/me/meetings" }],
  mentor: [
    { path: "/network/me" },
    { path: "/network/mentor" },
    { path: "/network/mentor/requests" },
    { path: `/network/mentor/requests/${seedRequestId("req-1003")}`, ready: "dialog" },
    { path: `/network/mentor/requests/${seedRequestId("req-1003")}`, ready: "dialog", press: "Accept" },
    { path: `/network/mentor/requests/${seedRequestId("req-1004")}`, ready: "dialog", press: "Decline" },
    { path: "/network/mentor/mentees" },
    { path: `/network/mentor/mentees/${seedRequestId("req-1005")}` },
    { path: `/network/mentor/mentees/${seedRequestId("req-1005")}`, press: "Change the times" },
    { path: `/network/mentor/mentees/${seedRequestId("req-1006")}` },
    { path: "/network/me/meetings?show=past" },
    { path: "/network/settings/mentorship" },
    { path: "/network/settings/privacy" },
    { path: "/network/settings/account" },
  ],
  admin: [
    { path: "/network/admin" },
    { path: "/network/admin/queue" },
    { path: "/network/admin/queue", press: "Review Dawud Jenkins" },
    { path: "/network/admin/members" },
    { path: "/network/admin/vocabulary" },
    { path: "/network/admin/mentorship" },
    { path: "/network/admin/reports" },
    { path: "/network/admin/administrators" },
    { path: "/network/admin/settings" },
  ],
  leaving: [{ path: "/network/scheduled-for-deletion" }],
};

const SEED_KEY: Partial<Record<Viewer, string>> = {
  student: "amina-rahman",
  mentee: "sumaya-osman",
  mentor: "layla-haddad",
  admin: "admin",
};

/**
 * Signs `page` in as the viewer. The newcomer and the leaving member are
 * fresh addresses; the leaving member then asks to delete the account (it
 * has no name on file, so the confirmation word is "delete"). Returns the
 * clean-up to run afterwards.
 */
export async function signInAs(page: Page, viewer: Viewer, origin: string, label: string): Promise<() => Promise<void>> {
  if (viewer === "visitor") return async () => {};
  const key = SEED_KEY[viewer];
  const email = key ? seedEmail(key) : `${viewer}-${label}-${Date.now()}@example.test`;
  const res = await page.request.post("/api/auth/dev-login", { data: { email } });
  expect(res.ok(), await res.text()).toBe(true);
  if (viewer !== "leaving") return async () => {};

  const scheduled = await page.request.post("/api/me/deletion", {
    data: { confirmName: "delete" },
    headers: { Origin: origin },
  });
  expect(scheduled.ok(), await scheduled.text()).toBe(true);
  return async () => {
    await keepAccount(page.request, origin);
  };
}

async function keepAccount(request: APIRequestContext, origin: string): Promise<void> {
  const kept = await request.delete("/api/me/deletion", { headers: { Origin: origin } });
  expect(kept.ok(), await kept.text()).toBe(true);
}

/** The screens to check in a project: phone-only states are skipped on wide screens. */
export function screensFor(viewer: Viewer, projectName: string): Screen[] {
  return SCREENS[viewer].filter((screen) => !screen.phoneOnly || projectName === "mobile-375");
}

/** A label for a screen in a failure list. */
export function screenLabel(screen: Screen): string {
  return screen.press ? `${screen.path} [${screen.press}]` : screen.path;
}

/** Opens a screen, waits until its data has loaded and presses its button, if any. */
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
    await page.getByRole("button", { name: screen.press, exact: true }).last().click();
    await expect(page.getByRole("dialog").last()).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
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
