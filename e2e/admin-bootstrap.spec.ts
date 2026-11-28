import { expect, test } from "@playwright/test";

/**
 * ADMIN_EMAILS (playwright.config.ts sets one address per run): the listed
 * address signs in, is an administrator, and works in the admin area without
 * filling in a profile. Its member pages still wait for onboarding.
 */

const address = process.env.E2E_BOOTSTRAP_ADMIN ?? "";

test.describe.configure({ mode: "serial" });

test.describe("an administrator from ADMIN_EMAILS", () => {
  test.skip(!address, "E2E_BOOTSTRAP_ADMIN is set by playwright.config.ts");

  test("lands on the admin area with no profile to fill in", async ({ page, baseURL }) => {
    const login = await page.request.post("/api/auth/dev-login", { data: { email: address } });
    expect(login.ok()).toBe(true);
    expect(await login.json()).toMatchObject({ redirect: "/network/admin" });

    await page.goto("/network/admin");
    await expect(page).toHaveURL(/\/network\/admin$/);
    await expect(page.locator("main h1")).toBeVisible();

    // The approvals queue works too.
    await page.goto("/network/admin/approvals");
    await expect(page).toHaveURL(/\/network\/admin\/approvals$/);
    await expect(page.locator("main h1")).toBeVisible();

    // The navigation offers the admin area and joining, nothing that needs a profile.
    const join = page.getByRole("link", { name: /^Join/ }).filter({ visible: true });
    await expect(join.first()).toHaveAttribute("href", "/network/onboarding");
    await expect(page.getByRole("link", { name: /^Directory$/ }).filter({ visible: true })).toHaveCount(0);

    // On a phone the tab bar carries the same two destinations.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/network/admin");
    await expect(page.getByRole("link", { name: /^Join/ }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator("main h1")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Member pages still ask for a profile first.
    await page.goto("/network/me");
    await expect(page).toHaveURL(/\/network\/onboarding$/);

    // Leave the shared e2e database with only the seeded administrators
    // acting (e2e/reseed.ts also revokes strays if a run stops before here).
    const { userId } = (await login.json()) as { userId: string };
    expect((await page.request.post("/api/auth/dev-login", { data: { email: "admin@example.test" } })).ok()).toBe(true);
    const revoke = await page.request.delete(`/api/admin/admins/${userId}`, {
      headers: { Origin: new URL(baseURL ?? "").origin },
    });
    expect(revoke.status()).toBe(200);
  });
});
