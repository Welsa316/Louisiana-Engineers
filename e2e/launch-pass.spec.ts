import { expect, test, type Page } from "@playwright/test";
import { seedEmail, seedUserId } from "../server/seed/users";

/**
 * The launch pass's screen changes (Task 28), all read-only against the
 * seed: onboarding reads its defaults and topics from the server, the
 * administrator filters the members list, and a profile's actions stick to
 * the bottom of a phone screen. The answers onboarding reads are replaced in
 * the browser, so no shared setting or vocabulary changes.
 */

const LAYLA = seedUserId("layla-haddad");

async function signIn(page: Page, key: string) {
  const res = await page.request.post("/api/auth/dev-login", { data: { email: seedEmail(key) } });
  expect(res.ok()).toBe(true);
}

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

test("onboarding prefills mentees at once from the network default and offers topics administrators add", async ({
  page,
}, testInfo) => {
  // An administrator's choices, as the server would report them.
  await page.route("**/api/config/public", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), defaultMaxActive: 4 } });
  });
  await page.route("**/api/config/vocabulary", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { topics: { id: string; label: string }[] };
    await route.fulfill({
      response: res,
      json: { topics: [...body.topics, { id: "coastal-permitting", label: "Coastal permitting" }] },
    });
  });

  const email = `launch-pro-${testInfo.project.name}-${Date.now()}@example.test`;
  expect((await page.request.post("/api/auth/dev-login", { data: { email } })).ok()).toBe(true);
  await page.goto("/network/onboarding");

  await page.getByText("Professional", { exact: true }).click();
  await page.getByText("I share this mission").click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(heading(page, "Start with the basics.")).toBeVisible();
  await page.getByLabel(/^First name/).fill("Nadia");
  await page.getByLabel(/^Last name/).fill("Karimi");
  await page.getByLabel(/^General location/).fill("Metairie, LA");
  await page
    .getByLabel(/^Short biography/)
    .fill(
      "I design drainage and flood protection for parishes around the lake, and I lead a small team of civil engineers. I like helping students find their first internship.",
    );
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(heading(page, "What you do.")).toBeVisible();
  await page.getByLabel(/^Discipline/).selectOption("civil");
  await page.getByLabel(/^Job title/).fill("Senior Drainage Engineer");
  await page.getByLabel(/^Company or institution/).fill("Self-employed");
  await page.getByLabel(/^Years of experience/).fill("12");
  const expertise = page.getByLabel(/^Areas of expertise/);
  for (const tag of ["Drainage", "Permitting"]) {
    await expertise.fill(tag);
    await expertise.press("Enter");
  }
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(heading(page, "How do you want to take part?")).toBeVisible();
  await page.locator("#onb-participation").getByText("Mentorship", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(heading(page, "Mentorship, on your terms.")).toBeVisible();
  await expect(page.getByLabel(/^Active mentees at once/)).toHaveValue("4");
  // The added topic is offered beside the starting set, and can be chosen.
  const added = page.getByRole("button", { name: "Coastal permitting" });
  await expect(added).toBeVisible();
  await expect(page.getByRole("button", { name: "Internships and first jobs" })).toBeVisible();
  await added.click();
  await expect(added).toHaveAttribute("aria-pressed", "true");
});

test("administrators filter the members list by kind, approval and mentoring", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/network/admin/members");
  await expect(heading(page, "Everyone with an account.")).toBeVisible();
  const rows = page.locator(".pn-table tbody tr");
  await expect(rows.first()).toBeVisible();

  await page.getByLabel("Kind").selectOption("student");
  await expect(page).toHaveURL(/[?&]kind=student/);
  // The list re-reads behind the previous rows; wait until only students remain.
  await expect(rows.filter({ hasNotText: "Student" })).toHaveCount(0);
  await expect(rows.first()).toBeVisible();

  // Students have no approval queue: combined with it, nothing matches.
  await page.getByLabel("Approval").selectOption("pending");
  await expect(page.getByText("No members match these filters.")).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/kind=|approval=/);
  await page.getByLabel("Mentoring").selectOption("paused");
  await expect(page).toHaveURL(/[?&]mentorStatus=paused/);
  await expect(rows.filter({ hasNotText: "Paused" })).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Fatima Noor");

  // Reloading keeps the filter.
  await page.reload();
  await expect(page.getByLabel("Mentoring")).toHaveValue("paused");
});

test("a profile's actions stick to the bottom of a phone screen, above the tab bar", async ({ page }, testInfo) => {
  const phone = testInfo.project.name === "mobile-375";
  await signIn(page, "amina-rahman");
  await page.goto(`/network/directory/${LAYLA}`);
  await expect(page.getByRole("heading", { level: 1, name: /Layla Haddad/ })).toBeVisible();

  const save = page.getByRole("button", { name: /^Save profile$|^Saved$/ });
  // One copy of the actions is displayed at each width.
  await expect(save).toHaveCount(1);
  const inBar = page.locator(".pn-profile-bar").getByRole("button", { name: /^Save profile$|^Saved$/ });
  const inHead = page.locator(".pn-profile-head").getByRole("button", { name: /^Save profile$|^Saved$/ });
  if (!phone) {
    await expect(inHead).toBeVisible();
    await expect(inBar).toHaveCount(0);
    return;
  }
  await expect(inHead).toHaveCount(0);
  await expect(inBar).toBeVisible();

  // At the top of the page, the bar already sits at the bottom of the screen,
  // directly above the tab bar if there is one.
  const measure = () =>
    page.evaluate(() => {
      const bar = document.querySelector(".pn-profile-bar")!.getBoundingClientRect();
      const tabs = document.querySelector(".pn-tabbar");
      const tabTop = tabs && getComputedStyle(tabs).display !== "none" ? tabs.getBoundingClientRect().top : null;
      return { barTop: bar.top, barBottom: bar.bottom, tabTop, height: window.innerHeight, width: bar.width };
    });
  const top = await measure();
  const floor = top.tabTop ?? top.height;
  expect(Math.abs(top.barBottom - floor)).toBeLessThanOrEqual(1);
  expect(top.width).toBe(375);
  // Its buttons are reachable touch targets.
  expect((await inBar.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Half way down it is still there.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  const middle = await measure();
  expect(Math.abs(middle.barBottom - floor)).toBeLessThanOrEqual(1);
});

test("the directory's topic filter offers and names a topic administrators add", async ({ page }) => {
  await page.route("**/api/config/vocabulary", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { topics: { id: string; label: string }[] };
    await route.fulfill({
      response: res,
      json: { topics: [...body.topics, { id: "coastal-permitting", label: "Coastal permitting" }] },
    });
  });
  await signIn(page, "amina-rahman");
  await page.goto("/network/me/discover");
  await expect(page.locator("main h1:visible").first()).toBeVisible();
  const phone = (page.viewportSize()?.width ?? 0) < 768;
  if (phone) await page.getByRole("button", { name: /^Filters/ }).click();
  const panel = phone ? page.getByRole("dialog", { name: "Filters" }) : page.getByRole("complementary", { name: "Filters" });
  await panel.getByRole("button", { name: "Coastal permitting" }).click();
  await expect(page).toHaveURL(/topic=coastal-permitting/);
  // The chosen filter reads as its name, never as its id.
  await expect(page.getByText("coastal-permitting", { exact: true })).toHaveCount(0);
});
