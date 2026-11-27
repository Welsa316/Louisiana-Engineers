import { expect, test, type Page } from "@playwright/test";
import { seedEmail, seedUserId } from "../server/seed/users";
import { reseed } from "./reseed";

/**
 * The administration area against the seed: Dawud Jenkins, Samira Benali and
 * Musa Grant wait in the approval queue. An administrator approves Dawud (he
 * appears in the directory) and declines Musa with notes (Musa reads them).
 *
 * The decisions change seeded rows, so they run once per run, in the
 * desktop project, and re-seed afterwards so every other spec (in either
 * project, in any order) sees the seeded queue and directory. The phone
 * project checks the same screens read-only.
 */

const DAWUD = seedUserId("dawud-jenkins");
const MUSA = seedUserId("musa-grant");
const DECLINE_NOTES = "Please describe your engineering work and remove the consultation offer, then submit again.";

async function signIn(page: Page, key: string) {
  const res = await page.request.post("/api/auth/dev-login", { data: { email: seedEmail(key) } });
  expect(res.ok()).toBe(true);
}

/** No element wider than the viewport (03 section 12). */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.right > width + 1;
    });
    return { scroll: document.documentElement.scrollWidth - width, wide: wide.slice(0, 5).map((el) => el.outerHTML.slice(0, 120)) };
  });
  expect(overflow.scroll, overflow.wide.join("\n")).toBeLessThanOrEqual(0);
}

test.describe("administration", () => {
  test("a member who is not an administrator gets the not-found page", async ({ page }) => {
    await signIn(page, "layla-haddad");
    await page.goto("/network/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    const api = await page.request.get("/api/admin/dashboard");
    expect(api.status()).toBe(403);
  });

  test("the queue lists the waiting submissions oldest first and opens one", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/network/admin/queue");
    await expect(page.getByRole("heading", { level: 1, name: "Profiles waiting to be listed." })).toBeVisible();
    await expect(page.getByText("Actions here are recorded in the audit log.")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Administration sections" });
    await expect(nav.getByRole("link", { name: /Approval queue/ })).toHaveAttribute("aria-current", "page");

    // Oldest first: the seed submitted Musa 3 days ago, Dawud 2, Samira 1.
    const review = page.getByRole("button", { name: /^Review / });
    await expect(review).toHaveText(["Review Musa Grant", "Review Dawud Jenkins", "Review Samira Benali, PE"]);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Review Dawud Jenkins" }).click();
    const drawer = page.getByRole("dialog", { name: "Dawud Jenkins" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Independent backend developer", { exact: false })).toBeVisible();
    // The sign-up domain, never an address.
    await expect(drawer.getByText("example.test", { exact: true })).toBeVisible();
    await expect(drawer.getByText("dawud-jenkins@example.test")).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Approve and list" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Decline with notes" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/network\/admin\/queue$/);
  });

  test("approving Dawud lists him and declining Musa sends him the notes", async ({ page, browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "Decisions change seeded rows; they run once, in the desktop project.");
    const origin = baseURL ?? "http://127.0.0.1:8787";
    await signIn(page, "admin");

    const open = await page.request.get("/api/admin/reviews?status=pending");
    const waiting = JSON.stringify(await open.json());
    expect(waiting.includes(DAWUD) && waiting.includes(MUSA), "Dawud and Musa must be waiting (the global setup re-seeds)").toBe(
      true,
    );

    const visitor = await browser.newContext({ baseURL: origin });
    const musa = await browser.newContext({ baseURL: origin });
    try {
      // Approve Dawud.
      await page.goto("/network/admin/queue");
      await page.getByRole("button", { name: "Review Dawud Jenkins" }).click();
      await page.getByRole("dialog", { name: "Dawud Jenkins" }).getByRole("button", { name: "Approve and list" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Dawud Jenkins is approved and listed." })).toBeVisible();
      await expect(page.getByRole("button", { name: "Review Dawud Jenkins" })).toHaveCount(0);

      // Declining Musa needs notes.
      await page.getByRole("button", { name: "Review Musa Grant" }).click();
      const drawer = page.getByRole("dialog", { name: "Musa Grant" });
      await drawer.getByRole("button", { name: "Decline with notes" }).click();
      await expect(drawer.getByRole("alert").filter({ hasText: "Write what needs to change" })).toBeVisible();
      await expect(drawer.getByLabel("Notes")).toBeFocused();
      await drawer.getByLabel("Notes").fill(DECLINE_NOTES);
      await drawer.getByRole("button", { name: "Decline with notes" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Musa Grant was sent back with your notes." })).toBeVisible();

      // Each decision moved to its own tab (first: a re-seeded database keeps earlier decided rows).
      await page.getByRole("button", { name: /^Needs changes/ }).click();
      await expect(page.getByRole("button", { name: "Open Musa Grant" }).first()).toBeVisible();
      await page.getByRole("button", { name: /^Listed/ }).click();
      await expect(page.getByRole("button", { name: "Open Dawud Jenkins" }).first()).toBeVisible();

      // Musa's account says so, and his own profile carries the notes (GET /api/me/profile, Task 12).
      const musaPage = await musa.newPage();
      await signIn(musaPage, "musa-grant");
      const me = await musaPage.request.get("/api/auth/me");
      expect((await me.json()).user.approvalState).toBe("declined");
      const own = await musaPage.request.get("/api/me/profile");
      expect(own.ok()).toBe(true);
      expect(JSON.stringify(await own.json())).toContain(DECLINE_NOTES);

      // A visitor finds Dawud in the directory and not Musa (GET /api/directory, Task 13).
      const dawudSearch = await visitor.request.get("/api/directory?q=Dawud");
      expect(dawudSearch.ok()).toBe(true);
      expect(JSON.stringify(await dawudSearch.json())).toContain(DAWUD);
      const musaSearch = await visitor.request.get("/api/directory?q=Musa");
      expect(JSON.stringify(await musaSearch.json())).not.toContain(MUSA);
    } finally {
      // Put the queue and directory back the way the seed left them.
      await reseed();
      await visitor.close();
      await musa.close();
    }
  });

  test("members, administrators, vocabulary and settings render without overflow", async ({ page }) => {
    await signIn(page, "admin");

    await page.goto("/network/admin/members");
    await expect(page.getByRole("heading", { level: 1, name: "Everyone with an account." })).toBeVisible();
    await expect(page.getByRole("table").getByText("Layla Haddad", { exact: false }).first()).toBeVisible();
    // Domains only.
    await expect(page.getByText("@example.test")).toHaveCount(0);
    await page.getByLabel("Search members by name").fill("Haddad");
    await expect(page).toHaveURL(/q=Haddad/);
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
    await expectNoHorizontalOverflow(page);

    await page.goto("/network/admin/administrators");
    await expect(page.getByText("Admin One (you)")).toBeVisible();
    // Two is the minimum, so neither can be removed.
    for (const button of await page.getByRole("button", { name: /^Remove role/ }).all()) {
      await expect(button).toBeDisabled();
    }
    await expectNoHorizontalOverflow(page);

    await page.goto("/network/admin/vocabulary");
    await expect(page.getByRole("heading", { level: 2, name: "Disciplines" })).toBeVisible();
    await expect(page.getByText("Coastal & environmental")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto("/network/admin/settings");
    await expect(page.getByLabel(/Requests expire after/)).toHaveValue("14");
    await expectNoHorizontalOverflow(page);
  });
});
