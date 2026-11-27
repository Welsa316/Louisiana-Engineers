import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedEmail, seedUserId } from "../server/seed/users";

/**
 * The directory and profile pages against the seed: 14 public professionals
 * for a visitor, 15 for a member (Tariq Mansour is members-only), Layla
 * Haddad shares her booking link and LinkedIn with members, and Dawud
 * Jenkins waits in the approval queue. Nothing here changes a seeded row
 * for good: the one save toggle is put back before the test ends.
 */

const LAYLA = seedUserId("layla-haddad");
const TARIQ = seedUserId("tariq-mansour");
const DAWUD = seedUserId("dawud-jenkins");

async function signIn(page: Page, key: string) {
  const res = await page.request.post("/api/auth/dev-login", { data: { email: seedEmail(key) } });
  expect(res.ok()).toBe(true);
}

/** No horizontal scroll and no element wider than the viewport, header included (03 section 12). */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.right > width + 1;
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

const results = (page: Page) => page.getByRole("list", { name: "Profiles" }).getByRole("listitem");
const resultCount = (page: Page) => page.getByTestId("directory-count");
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

/** The filter controls: the left column on desktop, the bottom sheet on a phone. */
async function openFilters(page: Page): Promise<Locator> {
  if (!isPhone(page)) return page.getByRole("complementary", { name: "Filters" });
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe("directory", () => {
  test("a visitor sees the 14 public profiles and no members-only one", async ({ page }) => {
    await page.goto("/network/directory");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(resultCount(page)).toHaveText(/^14 profiles/);
    await expect(results(page)).toHaveCount(14);
    await expect(page.getByRole("link", { name: /Tariq Mansour/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in to see members-only profiles" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("a member sees 15, including Tariq Mansour", async ({ page }) => {
    await signIn(page, "hamza-ali");
    await page.goto("/network/directory");
    await expect(resultCount(page)).toHaveText(/^15 profiles/);
    await expect(results(page)).toHaveCount(15);
    await expect(page.getByRole("link", { name: /Tariq Mansour/ })).toBeVisible();
  });

  test("searching for coastal finds Layla, and the search lives in the URL", async ({ page }) => {
    await page.goto("/network/directory");
    await expect(results(page)).toHaveCount(14);
    await page.getByRole("searchbox", { name: "Search the directory" }).fill("coastal");
    await expect(page).toHaveURL(/[?&]q=coastal/);
    // The previous 14 stay on screen until the search answers, so wait for it.
    await expect.poll(() => results(page).count()).toBeLessThan(14);
    expect(await results(page).count()).toBeGreaterThan(0);
    await expect(page.getByRole("link", { name: /Layla Haddad/ })).toBeVisible();

    // Reloading keeps the search.
    await page.reload();
    await expect(page.getByRole("searchbox", { name: "Search the directory" })).toHaveValue("coastal");
    await expect(page.getByRole("link", { name: /Layla Haddad/ })).toBeVisible();
  });

  test("each discipline's count matches the cards it shows", async ({ page }) => {
    await page.goto("/network/directory");
    await expect(results(page)).toHaveCount(14);
    const filters = await openFilters(page);
    const coastal = filters.getByRole("button", { name: /Coastal & environmental/ });
    const shown = Number((await coastal.locator(".pn-check-count").textContent())?.trim());
    expect(shown).toBeGreaterThan(0);
    await coastal.click();
    await expect(coastal).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/[?&]discipline=coastal/);
    if (isPhone(page)) {
      const apply = filters.getByRole("button", { name: new RegExp(`^Show ${shown} result`) });
      await expect(apply).toBeVisible();
      await apply.click();
      await expect(filters).toBeHidden();
    }
    await expect(results(page)).toHaveCount(shown);
    await expect(resultCount(page)).toHaveText(new RegExp(`^${shown} profile`));

    // The facet counts the discipline itself leaves out: every other option
    // still says how many it would show.
    const api = await page.request.get("/api/directory?size=50");
    const body = (await api.json()) as { facets: { disciplines: { id: string; count: number }[] } };
    expect(body.facets.disciplines.find((d) => d.id === "coastal")?.count).toBe(shown);
  });

  test("Back undoes a filter change, and a page past the end offers page 1", async ({ page }) => {
    await page.goto("/network/directory");
    await expect(results(page)).toHaveCount(14);
    const filters = await openFilters(page);
    await filters.getByRole("button", { name: /Coastal & environmental/ }).click();
    await expect(page).toHaveURL(/[?&]discipline=coastal/);
    if (isPhone(page)) await page.keyboard.press("Escape");
    await page.goBack();
    await expect(page).not.toHaveURL(/discipline=/);
    await expect(results(page)).toHaveCount(14);

    await page.goto("/network/directory?page=99");
    await expect(page.getByText("This page is past the end of the results.")).toBeVisible();
    await expect(page.getByText("The directory is new.")).toHaveCount(0);
    await page.getByRole("button", { name: "Back to page 1" }).click();
    await expect(results(page)).toHaveCount(14);
  });

  test("the filter sheet applies on a phone", async ({ page }) => {
    test.skip(!isPhone(page), "The sheet replaces the filter column below 768px.");
    await page.goto("/network/directory");
    await expect(results(page)).toHaveCount(14);
    const sheet = await openFilters(page);
    const answered = page.waitForResponse((res) => res.url().includes("/api/directory?") && res.url().includes("experience=20"));
    await sheet.getByRole("button", { name: "20 years or more" }).click();
    const { total: expected } = (await (await answered).json()) as { total: number };
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(14);
    const apply = sheet.getByRole("button", { name: new RegExp(`^Show ${expected} results?$`) });
    await apply.click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/[?&]experience=20%2B/);
    await expect(results(page)).toHaveCount(expected);
    await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("Find mentors presets the available filter", async ({ page }) => {
    await signIn(page, "hamza-ali");
    await page.goto("/network/me/discover");
    await expect(page.getByRole("heading", { level: 1, name: "Who can help with what you are working on?" })).toBeVisible();
    await expect(results(page).first()).toBeVisible();
    const cards = await results(page).count();
    await expect(results(page).getByText("Taking requests")).toHaveCount(cards);
    expect(cards).toBeLessThan(15);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("profile", () => {
  test("Tariq's members-only profile shows the sign-in screen to a visitor and the profile to a member", async ({ page }) => {
    await page.goto(`/network/directory/${TARIQ}`);
    await expect(page.getByRole("heading", { level: 1, name: "This profile is for signed-in members." })).toBeVisible();
    await expect(page.getByText("Tariq")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in" }).last()).toBeVisible();

    await signIn(page, "hamza-ali");
    await page.goto(`/network/directory/${TARIQ}`);
    await expect(page.getByRole("heading", { level: 1, name: /Tariq Mansour/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("a visitor gets the sign-in prompt for contact and a member sees Layla's shared methods", async ({ page, browser, baseURL }) => {
    const visitor = await browser.newContext({ baseURL: baseURL ?? undefined });
    try {
      const anon = await visitor.newPage();
      const contactCalls: string[] = [];
      anon.on("request", (req) => {
        if (req.url().includes("/contact")) contactCalls.push(req.url());
      });
      await anon.goto(`/network/directory/${LAYLA}`);
      await expect(anon.getByRole("heading", { level: 1, name: /Layla Haddad/ })).toBeVisible();
      await expect(anon.getByText("Sign in to see how to reach Layla")).toBeVisible();
      await expect(anon.getByRole("link", { name: /cal\.example\.test/ })).toHaveCount(0);
      await expect(anon.getByText("linkedin.com", { exact: false })).toHaveCount(0);
      await expect(anon.getByRole("link", { name: "Sign in to request mentorship" })).toBeVisible();
      expect(contactCalls, "a visitor's page never asks for contact details").toEqual([]);
      // The exact years stay private; the band shows.
      await expect(anon.getByText("10 to 19 years")).toBeVisible();
      await expect(anon.getByText("14 years")).toHaveCount(0);
      await expectNoHorizontalOverflow(anon);
    } finally {
      await visitor.close();
    }

    await signIn(page, "hamza-ali");
    await page.goto(`/network/directory/${LAYLA}`);
    const contact = page.getByRole("region", { name: "Contact" });
    await expect(contact.getByRole("link", { name: /cal\.example\.test\/layla-haddad/ })).toBeVisible();
    await expect(contact.getByRole("link", { name: /linkedin\.com\/in\/example-layla-haddad/ })).toBeVisible();
    await expect(contact.getByRole("button", { name: "Copy booking link" })).toBeVisible();
    await expect(contact.getByRole("button", { name: "Copy LinkedIn" })).toBeVisible();
    await expect(contact.getByText("Sign in to see how to reach Layla")).toHaveCount(0);
    // Hamza already has a pending request to Layla: the profile points at it instead of offering another.
    await expect(page.getByRole("link", { name: /^Request pending since / })).toBeVisible();
    await expect(page.getByRole("link", { name: "Request mentorship" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("someone signed in who has not finished joining is pointed to onboarding, not an error", async ({ page }, testInfo) => {
    const email = `unfinished-${testInfo.project.name}-${Date.now()}@example.test`;
    expect((await page.request.post("/api/auth/dev-login", { data: { email } })).ok()).toBe(true);
    const contactCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/contact")) contactCalls.push(req.url());
    });
    await page.goto(`/network/directory/${LAYLA}`);
    await expect(page.getByRole("heading", { level: 1, name: /Layla Haddad/ })).toBeVisible();
    const contact = page.getByRole("region", { name: "Contact" });
    await expect(contact.getByText("Finish joining to see how to reach Layla")).toBeVisible();
    await expect(contact.getByRole("link", { name: "Finish joining" })).toHaveAttribute("href", "/network/onboarding");
    await expect(page.getByText("did not load")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Save profile/ })).toHaveCount(0);
    expect(contactCalls).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });

  test("a member saves a profile and removes it again", async ({ page }) => {
    await signIn(page, "hamza-ali");
    await page.goto(`/network/directory/${LAYLA}`);
    const save = page.getByRole("button", { name: /^Save profile$|^Saved$/ });
    await expect(save).toBeVisible();
    const before = await save.getAttribute("aria-pressed");
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
    await page.reload();
    await expect(save).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", before ?? "false");
  });

  test("a pending professional sees their own profile with the review banner; others get not found", async ({ page, browser, baseURL }) => {
    await signIn(page, "dawud-jenkins");
    await page.goto(`/network/directory/${DAWUD}`);
    await expect(page.getByRole("heading", { level: 1, name: /Dawud Jenkins/ })).toBeVisible();
    await expect(page.getByText("Waiting for review", { exact: false }).first()).toBeVisible();

    const visitor = await browser.newContext({ baseURL: baseURL ?? undefined });
    try {
      const anon = await visitor.newPage();
      await anon.goto(`/network/directory/${DAWUD}`);
      await expect(anon.getByRole("heading", { level: 1, name: "This profile is not available." })).toBeVisible();
      await expect(anon.getByText("Dawud")).toHaveCount(0);
    } finally {
      await visitor.close();
    }
  });

  test("the server puts Layla's name in the title for crawlers", async ({ page }) => {
    const res = await page.request.get(`/network/directory/${LAYLA}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Layla Haddad, Senior Coastal Engineer · MEST Network</title>");
    expect(html).not.toContain('content="noindex"');

    // The page keeps the same title once it has rendered.
    await page.goto(`/network/directory/${LAYLA}`);
    await expect(page.getByRole("heading", { level: 1, name: /Layla Haddad/ })).toBeVisible();
    await expect(page).toHaveTitle("Layla Haddad, Senior Coastal Engineer · MEST Network");
  });
});
