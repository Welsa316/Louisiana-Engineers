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

  test("the landing page sends people to join the network, not to a membership form", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("section#hero")).toBeVisible();
    // There is no formal MEST membership yet: no "Join MEST" anywhere.
    await expect(page.getByText("Join MEST", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Membership enrollment opens soon.")).toHaveCount(0);
    // The header (or, on phones, its menu) and the Get Involved section link to the network's sign-up.
    const menu = page.getByRole("button", { name: "Open menu" });
    if (await menu.isVisible()) await menu.click();
    const headerJoin = page.getByRole("link", { name: "Join the network" }).filter({ visible: true }).first();
    await expect(headerJoin).toHaveAttribute("href", "/network/join");
    if (await page.getByRole("button", { name: "Close menu" }).isVisible()) await page.getByRole("button", { name: "Close menu" }).click();
    // The section fades in as it scrolls into view, as a visitor would see it.
    const section = page.locator("section#get-involved");
    await section.scrollIntoViewIfNeeded();
    await page.locator("footer").scrollIntoViewIfNeeded();
    await section.getByRole("heading").first().scrollIntoViewIfNeeded();
    await expect(section.getByRole("link", { name: /Join the MEST Network/ })).toHaveAttribute("href", "/network/join");
    // The organizers can be reached by email and phone, in the section and the footer.
    for (const where of [section, page.locator("footer")]) {
      await where.scrollIntoViewIfNeeded();
      const email = where.locator('a[href="mailto:admin@mestnola.com"]');
      await expect(email).toBeVisible();
      expect((await email.textContent())?.replace(/\s/g, "")).toBe("admin@mestnola.com");
      await expect(where.getByRole("link", { name: "(504) 230-9499" })).toHaveAttribute("href", "tel:+15042309499");
    }
  });

  test("the WhatsApp group is one tap away without covering anything", async ({ page }) => {
    const group = "https://chat.whatsapp.com/HK75bKX3us2AfeIXWqzN9F?mode=gi_t";
    const phone = (page.viewportSize()?.width ?? 0) < 768;
    const button = page.getByRole("link", { name: "Join the MEST WhatsApp group (opens in a new tab)" });

    await page.goto("/");
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("href", group);
    await expect(button).toHaveAttribute("target", "_blank");

    // On the network's sign-in page it never sits on the email field.
    await page.goto("/network/signin");
    const email = page.getByLabel("Email");
    await expect(email).toBeVisible();
    if (phone) {
      await expect(button).toBeHidden();
      await page.getByRole("button", { name: "Menu" }).click();
      await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: /WhatsApp group/ })).toHaveAttribute("href", group);
    } else {
      await expect(button).toBeVisible();
      const [b, e] = [await button.boundingBox(), await email.boundingBox()];
      const overlaps = b && e && b.x < e.x + e.width && b.x + b.width > e.x && b.y < e.y + e.height && b.y + b.height > e.y;
      expect(overlaps).toBeFalsy();
    }
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

    // The public header (or, on phones, its menu) offers to finish signing up instead of Join.
    await page.goto("/network");
    await expect(page.locator("main h1")).toBeVisible();
    const menu = page.getByRole("button", { name: "Menu" });
    if (await menu.isVisible()) await menu.click();
    const account = page.getByRole("link", { name: "Finish signing up" }).filter({ visible: true });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute("href", "/network/onboarding");
    await expect(page.getByRole("link", { name: "Join", exact: true })).toHaveCount(0);
  });

  test("the signed-in public header fits the screen and the menu carries the account link", async ({ page }, testInfo) => {
    const unfinished = `header-${testInfo.project.name}-${Date.now()}@example.test`;
    for (const [email, label] of [
      ["layla-haddad@example.test", "My dashboard"],
      [unfinished, "Finish signing up"],
    ] as const) {
      expect((await page.request.post("/api/auth/dev-login", { data: { email } })).ok()).toBe(true);
      for (const path of ["/network", "/network/mentorship", "/network/directory"]) {
        await page.goto(path);
        await expect(page.locator("main h1")).toBeVisible();
        const width = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        expect(width.scroll, `${path} for ${label}`).toBeLessThanOrEqual(width.viewport);
      }
      const menu = page.getByRole("button", { name: "Menu" });
      if (await menu.isVisible()) {
        await menu.click();
        await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: label })).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await expect(page.getByRole("banner").getByRole("link", { name: label })).toBeVisible();
      }
    }
  });

  test("the app header shows the logo and kind on phones only", async ({ page }) => {
    expect((await page.request.post("/api/auth/dev-login", { data: { email: "layla-haddad@example.test" } })).ok()).toBe(true);
    await page.goto("/network/me");
    await expect(page.locator("main h1:visible").first()).toBeVisible();
    const head = page.getByTestId("app-head");
    const phone = (page.viewportSize()?.width ?? 0) < 768;
    await expect(head.getByRole("link", { name: "MEST Network home" })).toBeVisible({ visible: phone });
    await expect(head.getByText("Professional", { exact: true })).toBeVisible({ visible: phone });
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
