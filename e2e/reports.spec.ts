import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedEmail, seedUserId } from "../server/seed/users";
import { reseed } from "./reseed";

/**
 * Reports and moderation against the seed: Amina Rahman reports Bilal
 * Chowdhury (an approved, public professional), an administrator resolves
 * the report by hiding his profile and his card leaves the directory, then
 * restoring him from Members brings it back. Amina hears that her report
 * was reviewed, never the note.
 *
 * The report and the hide change seeded rows, so that flow runs once per
 * run, in the desktop project, and re-seeds afterwards (the reports seed
 * removes reports it did not write). The phone project checks the same
 * screens read-only.
 */

const BILAL = seedUserId("bilal-chowdhury");
const DETAIL = "His bio links to a paid consulting offer instead of talking about his engineering work.";
const NOTE = "Asked Bilal to take the consulting link out of his bio before relisting.";

async function signIn(page: Page, key: string) {
  const res = await page.request.post("/api/auth/dev-login", { data: { email: seedEmail(key) } });
  expect(res.ok()).toBe(true);
}

/**
 * No horizontal scroll and no element wider than the viewport (03 section 12).
 * Content inside a horizontal scroller that itself fits (the admin section
 * tabs scroll sideways on a phone by design) is not page overflow.
 */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const inFittingScroller = (el: HTMLElement) => {
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const x = getComputedStyle(parent).overflowX;
        if ((x === "auto" || x === "scroll") && parent.getBoundingClientRect().right <= width + 1) return true;
      }
      return false;
    };
    const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.right > width + 1 && !inFittingScroller(el);
    });
    return {
      width,
      scroll: document.documentElement.scrollWidth,
      wide: wide.slice(0, 5).map((el) => el.outerHTML.slice(0, 120)),
    };
  });
  expect(overflow.width).toBe(page.viewportSize()?.width ?? overflow.width);
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.width);
  expect(overflow.wide, overflow.wide.join("\n")).toEqual([]);
}

/** The option card is the radio's label; the radio itself is visually hidden. */
async function pick(radio: Locator) {
  await radio.locator("xpath=ancestor::label").click();
  await expect(radio).toBeChecked();
}

const cards = (page: Page) => page.getByRole("list", { name: "Profiles" }).getByRole("listitem");

test.describe("reports", () => {
  test("a visitor gets no report control and a member does", async ({ page, browser, baseURL }) => {
    await page.goto(`/network/directory/${BILAL}`);
    await expect(page.getByRole("heading", { level: 1, name: /Bilal Chowdhury/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Report this profile" })).toHaveCount(0);

    const member = await browser.newContext({ baseURL: baseURL ?? undefined });
    try {
      const memberPage = await member.newPage();
      await signIn(memberPage, "amina-rahman");
      await memberPage.goto(`/network/directory/${BILAL}`);
      const report = memberPage.getByRole("button", { name: "Report this profile" });
      await expect(report).toBeVisible();
      await report.click();
      const dialog = memberPage.getByRole("dialog", { name: "Report this profile" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Bilal will not see who reported them", { exact: false })).toBeVisible();
      // Nothing can be sent without a reason.
      await expect(dialog.getByRole("button", { name: "Send report" })).toBeDisabled();
      await expectNoHorizontalOverflow(memberPage);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();

      // The owner of a profile is offered no report control on their own page.
      await signIn(memberPage, "bilal-chowdhury");
      await memberPage.goto(`/network/directory/${BILAL}`);
      await expect(memberPage.getByRole("link", { name: "Edit your profile" })).toBeVisible();
      await expect(memberPage.getByRole("button", { name: "Report this profile" })).toHaveCount(0);
    } finally {
      await member.close();
    }
  });

  test("the reports page lists the seeded report and opens the resolve dialog", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/network/admin/reports");
    await expect(page.getByRole("heading", { level: 1, name: "Flagged profiles." })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Administration sections" });
    await expect(nav.getByRole("link", { name: /Reports/ })).toHaveAttribute("aria-current", "page");

    const musa = page.getByRole("article").filter({ hasText: "Musa Grant" });
    await expect(musa).toBeVisible();
    await expect(musa.getByText("Promotional or off-topic.")).toBeVisible();
    await expect(musa.getByText("Pending review")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await musa.getByRole("button", { name: "Show requests involving Musa Grant" }).click();
    await expect(page.getByRole("region", { name: "Requests involving Musa Grant" })).toBeVisible();

    await musa.getByRole("button", { name: "Resolve or dismiss the report about Musa Grant" }).click();
    const dialog = page.getByRole("dialog", { name: "Close the report about Musa Grant" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /Hide the profile/ })).toBeVisible();
    await pick(dialog.getByRole("radio", { name: /Dismiss/ }));
    // A dismissal takes no action, so the action choices go away.
    await expect(dialog.getByRole("radio", { name: /Hide the profile/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("reporting Bilal, hiding him and restoring him", async ({ page, browser, baseURL }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-1280",
      "The report and the hide change seeded rows; they run once, in the desktop project.",
    );
    const origin = baseURL ?? "http://127.0.0.1:8787";
    const amina = await browser.newContext({ baseURL: origin });
    const visitor = await browser.newContext({ baseURL: origin });
    try {
      const visitorPage = await visitor.newPage();
      await visitorPage.goto("/network/directory?q=Chowdhury");
      await expect(cards(visitorPage).filter({ hasText: "Bilal Chowdhury" })).toHaveCount(1);

      // Amina reports Bilal.
      const aminaPage = await amina.newPage();
      await signIn(aminaPage, "amina-rahman");
      await aminaPage.goto(`/network/directory/${BILAL}`);
      await aminaPage.getByRole("button", { name: "Report this profile" }).click();
      const dialog = aminaPage.getByRole("dialog", { name: "Report this profile" });
      await pick(dialog.getByRole("radio", { name: "Promotional or off-topic" }));
      await dialog.getByLabel(/Anything an administrator should know/).fill(DETAIL);
      await dialog.getByRole("button", { name: "Send report" }).click();
      await expect(dialog).toBeHidden();
      await expect(aminaPage.getByRole("status").filter({ hasText: "An administrator will review your report." })).toBeVisible();

      // An administrator resolves it by hiding the profile.
      await signIn(page, "admin");
      await page.goto("/network/admin/reports");
      const bilal = page.getByRole("article").filter({ hasText: "Bilal Chowdhury" });
      await expect(bilal.getByText(DETAIL, { exact: false })).toBeVisible();
      await expect(bilal.getByText("Amina Rahman")).toBeVisible();
      await bilal.getByRole("button", { name: "Resolve or dismiss the report about Bilal Chowdhury" }).click();
      const resolve = page.getByRole("dialog", { name: "Close the report about Bilal Chowdhury" });
      await pick(resolve.getByRole("radio", { name: /Hide the profile/ }));
      await resolve.getByLabel(/Note for administrators/).fill(NOTE);
      await resolve.getByRole("button", { name: "Resolve report" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Report resolved. Bilal Chowdhury's profile is hidden." }),
      ).toBeVisible();
      await expect(page.getByRole("article").filter({ hasText: "Bilal Chowdhury" })).toHaveCount(0);

      // The closed report keeps the note for administrators.
      await page.getByRole("button", { name: /^Resolved/ }).click();
      const row = page.getByRole("row").filter({ hasText: "Bilal Chowdhury" });
      await expect(row.getByText("Profile hidden", { exact: false })).toBeVisible();
      await expect(row.getByText(NOTE)).toBeVisible();

      // His card is gone for a visitor, and his profile is not found.
      await visitorPage.goto("/network/directory?q=Chowdhury");
      await expect(visitorPage.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(cards(visitorPage).filter({ hasText: "Bilal Chowdhury" })).toHaveCount(0);
      const gone = await visitorPage.request.get(`/api/profiles/${BILAL}`);
      expect(gone.status()).toBe(404);

      // Amina is told it was reviewed, without the note.
      const notes = await aminaPage.request.get("/api/notifications");
      const body = JSON.stringify(await notes.json());
      expect(body).toContain("Your report was reviewed");
      expect(body).not.toContain(NOTE);

      // Restoring him from Members brings the card back.
      await page.goto("/network/admin/members?q=Chowdhury");
      await page.getByRole("button", { name: "Restore Bilal Chowdhury" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Bilal Chowdhury is restored." })).toBeVisible();
      await visitorPage.goto("/network/directory?q=Chowdhury");
      await expect(cards(visitorPage).filter({ hasText: "Bilal Chowdhury" })).toHaveCount(1);
    } finally {
      await reseed();
      await amina.close();
      await visitor.close();
    }
  });
});
