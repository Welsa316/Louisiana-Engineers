import { expect, test } from "@playwright/test";

/**
 * The network app's foundation: the landing page is untouched, the network
 * shell boots under /network, signed-in areas send visitors to sign in, and
 * the Node server answers the SPA fallback only under /network.
 */

test.describe("foundation", () => {
  test("the landing page still renders its sections", async ({ page }) => {
    await page.goto("/");
    for (const id of ["hero", "mission", "events", "get-involved"]) {
      await expect(page.locator(`section#${id}`)).toBeVisible();
    }
    // The network stylesheet and shell never load on the landing page.
    await expect(page.locator(".pn-root")).toHaveCount(0);
  });

  test("/network renders the network home inside the public shell", async ({ page }) => {
    await page.goto("/network");
    await expect(page.locator(".pn-root header.pn-header")).toBeVisible();
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page).toHaveTitle(/MEST Network/);
    // The not-found page also has an h1 and a MEST Network title, so prove
    // this is the home route and not the catch-all.
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toHaveCount(0);
    expect(await page.title()).not.toMatch(/^Page not found/);
    // Every network page is noindex unless it opts in.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  test("client navigation moves between network pages without a reload", async ({ page }) => {
    await page.goto("/network");
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });
    // Phones reach the network links through the header menu.
    const menu = page.getByRole("button", { name: "Menu" });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("link", { name: "Directory", exact: true }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/network\/directory$/);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page).toHaveTitle(/^Directory · MEST Network$/);
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
    // A screen reader or keyboard user is taken to the new page's content.
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("main");
  });

  test("an anonymous visitor opening /network/me is sent to sign in", async ({ page }) => {
    await page.goto("/network/me");
    await expect(page).toHaveURL(/\/network\/signin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("an anonymous visitor opening the admin area is sent to sign in", async ({ page }) => {
    await page.goto("/network/admin/approvals");
    await expect(page).toHaveURL(/\/network\/signin$/);
  });

  test("a signed-in member who has not finished onboarding is sent to onboarding", async ({ page }, testInfo) => {
    const email = `foundation-${testInfo.project.name}-${Date.now()}@example.test`;
    const login = await page.request.post("/api/auth/dev-login", { data: { email } });
    expect(login.ok()).toBe(true);

    await page.goto("/network/me");
    await expect(page).toHaveURL(/\/network\/onboarding$/);

    // The public header offers to finish signing up instead of Join.
    await page.goto("/network");
    const account = page.getByRole("link", { name: "Finish signing up" });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute("href", "/network/onboarding");
    await expect(page.getByRole("link", { name: "Join", exact: true })).toHaveCount(0);
  });

  test("an unknown network path shows the app's not-found page", async ({ page }) => {
    await page.goto("/network/no-such-page");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Network home" })).toHaveAttribute("href", "/network");
  });

  test("the server answers index.html for /network/directory", async ({ request }) => {
    const res = await request.get("/network/directory");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/html");
    expect(await res.text()).toContain('<div id="root">');
  });

  test("any other unknown path is a real 404", async ({ request }) => {
    const res = await request.get("/nothing-here");
    expect(res.status()).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
