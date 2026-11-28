import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { seedRequestId } from "../server/seed/requests";
import { seedEmail } from "../server/seed/users";
import { reseed } from "./reseed";

/**
 * Post-completion feedback (Task 32) against the seed. Layla Haddad's
 * mentorship with Idris Fofana (req-1006) is already completed, so both
 * see the two questions; her active one with Sumaya Osman (req-1005) is
 * what the desktop flow completes: Layla marks it completed, the form takes
 * focus, she answers; Sumaya is invited and sees her own form without
 * Layla's answer; the administrator sees the comment with no name, and the
 * count and the average held back until there are 5 answers. That flow changes seeded rows, so it runs once,
 * in the desktop project, and re-seeds afterwards. Each member gets a
 * browser context of their own.
 */

const WITH_SUMAYA = seedRequestId("req-1005");
const WITH_IDRIS = seedRequestId("req-1006");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const LAYLA_COMMENT = "Sharp questions about consulting careers; I enjoyed every conversation.";

/** Runs `fn` in a fresh context signed in as the seeded member `key`, shaped like the current project. */
async function asMember<T>(
  browser: Browser,
  options: BrowserContextOptions,
  key: string,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext(options);
  try {
    const page = await context.newPage();
    const res = await page.request.post("/api/auth/dev-login", { data: { email: seedEmail(key) } });
    expect(res.ok()).toBe(true);
    return await fn(page);
  } finally {
    await context.close();
  }
}

/** No element wider than the viewport (03 section 12). */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.right > width + 1;
    });
    return { width, scroll: document.documentElement.scrollWidth, wide: wide.slice(0, 5).map((el) => el.outerHTML.slice(0, 120)) };
  });
  expect(overflow.width).toBe(page.viewportSize()?.width ?? overflow.width);
  expect(overflow.scroll, overflow.wide.join("\n")).toBeLessThanOrEqual(overflow.width);
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(serious, serious.join("\n")).toEqual([]);
}

const form = (page: Page) => page.getByRole("region", { name: "How did it go?" });
/** One dashboard measure, by its label exactly (the held-back value mentions "answers" too). */
const stat = (page: Page, label: string) =>
  page.locator(".pn-stat").filter({ has: page.locator(".pn-stat-label").getByText(label, { exact: true }) });
const commentsCard = (page: Page) =>
  page.locator(".pn-card").filter({ has: page.getByRole("heading", { name: "What members said" }) });

/** The context options of the running project (viewport, touch, base URL). */
function projectOptions(testInfo: { project: { use: BrowserContextOptions } }, baseURL: string | undefined): BrowserContextOptions {
  const { viewport, isMobile, hasTouch, deviceScaleFactor, userAgent } = testInfo.project.use;
  return { baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent };
}

test.describe("feedback screens (read-only)", () => {
  test("both sides of a completed mentorship see the two questions", async ({ browser, baseURL }, testInfo) => {
    const options = projectOptions(testInfo, baseURL);

    await asMember(browser, options, "layla-haddad", async (page) => {
      await page.goto(`/network/mentor/mentees/${WITH_IDRIS}`);
      await expect(page.getByRole("heading", { level: 1, name: "Idris Fofana" })).toBeVisible();
      await expect(form(page)).toBeVisible();
      await expect(form(page).getByRole("group", { name: "How helpful was this mentorship?" })).toBeVisible();
      await expect(form(page).getByRole("radio")).toHaveCount(5);
      await expect(form(page).getByLabel("Anything you want to add? (optional)")).toBeVisible();
      // Sending without a rating says what is missing.
      await form(page).getByRole("button", { name: "Send feedback" }).click();
      await expect(form(page).getByText("Choose how helpful it was.")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoSeriousAxe(page);
    });

    await asMember(browser, options, "idris-fofana", async (page) => {
      await page.goto(`/network/me/requests/${WITH_IDRIS}`);
      // The mentee's own view of the request, not the mentor's.
      await expect(page.getByRole("link", { name: "All requests" })).toBeVisible();
      await expect(form(page)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoSeriousAxe(page);
    });

    // An active mentorship has no form yet.
    await asMember(browser, options, "sumaya-osman", async (page) => {
      await page.goto(`/network/me/requests/${WITH_SUMAYA}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Mark as completed" })).toBeVisible();
      await expect(form(page)).toHaveCount(0);
    });
  });

  test("administrators see the feedback measures and the comment list", async ({ browser, baseURL }, testInfo) => {
    await asMember(browser, projectOptions(testInfo, baseURL), "admin", async (page) => {
      await page.goto("/network/admin/mentorship");
      await expect(stat(page, "Average helpfulness")).toBeVisible();
      await expect(stat(page, "Answers")).toBeVisible();
      await expect(commentsCard(page)).toBeVisible();
      await expect(commentsCard(page).getByRole("alert")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoSeriousAxe(page);
    });
  });
});

test.describe("feedback flow", () => {
  test.skip(({ isMobile }) => isMobile, "changes seeded rows; runs once, at desktop width");
  test.afterAll(async () => {
    await reseed();
  });

  test("completing invites the other party, and answers stay with their author", async ({ browser, baseURL }, testInfo) => {
    const options = projectOptions(testInfo, baseURL);

    await asMember(browser, options, "layla-haddad", async (page) => {
      await page.goto(`/network/mentor/mentees/${WITH_SUMAYA}`);
      await page.getByRole("button", { name: "Mark as completed" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("asked for feedback");
      await dialog.getByRole("button", { name: "Mark as completed" }).click();

      // The form appears and takes focus.
      await expect(form(page)).toBeVisible();
      await expect(form(page).getByRole("heading", { name: "How did it go?" })).toBeFocused();
      await form(page).locator("label").filter({ hasText: "4, Helpful" }).click();
      await expect(form(page).getByRole("radio", { name: "4, Helpful" })).toBeChecked();
      await form(page).getByLabel("Anything you want to add? (optional)").fill(LAYLA_COMMENT);
      await form(page).getByRole("button", { name: "Send feedback" }).click();
      const answer = page.getByRole("region", { name: "Your feedback" });
      await expect(answer).toContainText("You rated it 4 of 5: Helpful.");
      await expect(answer).toContainText(LAYLA_COMMENT);
    });

    // Sumaya is invited, and sees her own form without Layla's answer.
    await asMember(browser, options, "sumaya-osman", async (page) => {
      await page.goto("/network/notifications");
      await expect(page.getByRole("main").getByText("Layla marked your mentorship as completed").first()).toBeVisible();
      await page.goto(`/network/me/requests/${WITH_SUMAYA}`);
      await expect(page.getByRole("link", { name: "All requests" })).toBeVisible();
      await expect(form(page)).toBeVisible();
      await expect(page.getByText(LAYLA_COMMENT)).toHaveCount(0);
    });

    // The administrator reads the comment, with no name; one answer is too
    // few for the count and the average, which would give it away.
    await asMember(browser, options, "admin", async (page) => {
      await page.goto("/network/admin/mentorship");
      await expect(stat(page, "Average helpfulness")).toContainText("Shown after 5 answers");
      await expect(stat(page, "Answers")).toContainText("Shown after 5 answers");
      const comments = commentsCard(page);
      await expect(comments).toContainText(LAYLA_COMMENT);
      await expect(comments).toContainText("From a mentor");
      await expect(comments).not.toContainText("Layla");
      await expect(comments).not.toContainText("Sumaya");
    });
  });
});
