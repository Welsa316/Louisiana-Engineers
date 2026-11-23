import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * The mission statement as src/content/site.ts holds it. Read as text: the
 * module itself reads Vite's `import.meta.env`, which Playwright lacks.
 */
const missionStatement = (() => {
  const source = readFileSync(new URL("../src/content/site.ts", import.meta.url), "utf8");
  const match = /statement:\s*"([^"]+)"/.exec(source);
  if (!match) throw new Error("mission.statement not found in src/content/site.ts");
  return match[1];
})();

/**
 * The public network screens and passwordless sign-in: a new address signs
 * in by magic link and lands on onboarding, a used link and a failed Google
 * sign-in each explain themselves, Join asks for a path and the mission
 * statement, and the landing page gains a Directory link without losing its
 * section links.
 *
 * Only the first test sends a real magic link (one per project). The server
 * limits links to `magic_links_per_hour` per address and per IP, and every
 * request here comes from 127.0.0.1, so the other form tests answer the
 * magic-link call in the browser instead of spending that budget.
 */

const LINK_ERROR = /That sign-in link did not work/;
const GOOGLE_ERROR = /Google sign-in did not finish/;

/** A unique fake client address, honoured only when the server trusts a proxy. */
function fakeClientIp(): string {
  const n = Date.now() % 250;
  return `198.51.100.${n + 1}`;
}

/** Phones reach the landing links through the menu dialog; wider screens through the header. */
async function openLandingMenuIfNeeded(page: Page) {
  await expect(page.locator("section#hero")).toBeVisible();
  const width = page.viewportSize()?.width ?? 1280;
  if (width < 768) {
    await page.getByRole("button", { name: "Open menu" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    return dialog;
  }
  return page.getByRole("navigation", { name: "Primary", exact: true });
}

test.describe("sign-in", () => {
  test("a new address signs in by magic link, lands on onboarding and signs out", async ({ page, context }, testInfo) => {
    await context.setExtraHTTPHeaders({ "X-Forwarded-For": fakeClientIp() });
    const email = `auth-${testInfo.project.name}-${Date.now()}@example.test`;

    await page.goto("/network/signin");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();

    await expect(page).toHaveURL(/\/network\/check-email$/);
    await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    // The address rides in memory, never in the URL.
    expect(page.url()).not.toContain("example.test");

    const res = await page.request.get(`/api/auth/dev-last-link?email=${encodeURIComponent(email)}`);
    expect(res.ok()).toBe(true);
    const { link } = (await res.json()) as { link: string };

    // Opening the link only shows a form; Continue consumes it.
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Finish signing in" })).toBeVisible();
    await page.getByRole("button", { name: "Continue to MEST Network" }).click();
    await expect(page).toHaveURL(/\/network\/onboarding$/);

    // Signed in: the sign-in screen says so and offers to sign out.
    await page.goto("/network/signin");
    await expect(page.getByText("You are signed in.")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    const me = await page.request.get("/api/auth/me");
    expect(await me.json()).toEqual({ user: null });

    // The same link a second time fails and says why.
    await page.goto(link);
    await page.getByRole("button", { name: "Continue to MEST Network" }).click();
    await expect(page).toHaveURL(/\/network\/signin\?error=link$/);
    await expect(page.getByRole("alert")).toContainText(LINK_ERROR);
    await expect(page.getByRole("alert")).not.toContainText(GOOGLE_ERROR);
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
  });

  test("an invalid email is announced and focused", async ({ page }) => {
    await page.goto("/network/signin");
    const email = page.getByLabel("Email");
    await email.fill("not-an-address");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Enter a valid email address" })).toBeVisible();
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute("aria-invalid", "true");
  });

  test("a failed Google sign-in has its own message", async ({ page }) => {
    await page.goto("/network/signin?error=google");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(GOOGLE_ERROR);
    await expect(alert).toContainText("already linked to a different Google account");
    await expect(alert).not.toContainText(LINK_ERROR);
  });

  test("a bad or expired link has its own message", async ({ page }) => {
    await page.goto("/network/signin?error=link");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(LINK_ERROR);
    await expect(alert).toContainText("expire after 15 minutes");
    await expect(alert).not.toContainText(GOOGLE_ERROR);
  });

  test("an unknown error value shows no message", async ({ page }) => {
    await page.goto("/network/signin?error=something");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("too many links shows the rate-limit message and stays on the form", async ({ page }) => {
    await page.route("**/api/auth/magic-link", (route) =>
      route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ code: "rate_limited" }) }),
    );
    await page.goto("/network/signin");
    await page.getByLabel("Email").fill("someone@example.test");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("alert")).toContainText("Too many sign-in links");
    await expect(page).toHaveURL(/\/network\/signin$/);
  });

  test("Google is offered only when the server enables it", async ({ page }) => {
    await page.route("**/api/config/public", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ googleEnabled: true, platformPaused: false }) }),
    );
    await page.goto("/network/signin");
    await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/api/auth/google");

    await page.unroute("**/api/config/public");
    await page.route("**/api/config/public", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ googleEnabled: false, platformPaused: false }) }),
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);
  });
});

test.describe("join", () => {
  test("Join asks for a path and the mission statement before sending a link", async ({ page }) => {
    const sent: unknown[] = [];
    await page.route("**/api/auth/magic-link", async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
    });

    await page.goto("/network/join");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The statement shown is the organisation's own, from the site content.
    await expect(page.getByText(missionStatement)).toBeVisible();

    await page.getByLabel("Email").fill("new-student@example.test");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    // Both errors are announced, not just shown.
    await expect(page.getByRole("alert").filter({ hasText: "Choose which describes you." })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Confirm the mission statement to join." })).toBeVisible();
    expect(sent).toHaveLength(0);

    await page.getByText("I am a student or early in my career").click();
    await expect(page.getByRole("radio", { name: /I am a student/ })).toBeChecked();
    await page.getByText("I share this mission").click();
    await expect(page.getByRole("checkbox", { name: /I share this mission/ })).toBeChecked();
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();

    await expect(page).toHaveURL(/\/network\/check-email$/);
    await expect(page.getByText("new-student@example.test")).toBeVisible();
    expect(sent).toEqual([{ email: "new-student@example.test" }]);
    // The choice is kept for onboarding on this device.
    const intent = await page.evaluate(() => window.localStorage.getItem("mest-join-intent"));
    expect(JSON.parse(intent ?? "null")).toMatchObject({ kind: "student", missionAccepted: true });
  });

  test("a path link preselects the matching choice", async ({ page }) => {
    await page.goto("/network/join?as=professional");
    await expect(page.getByRole("radio", { name: /I am a working professional/ })).toBeChecked();
  });
});

test.describe("public pages", () => {
  test("the network home, mentorship, guidelines and privacy pages render", async ({ page }) => {
    await page.goto("/network");
    await expect(page.getByRole("heading", { level: 1, name: "Find the person who has already done it." })).toBeVisible();
    await expect(page).toHaveTitle("MEST Network");

    await page.goto("/network/mentorship");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle("Mentorship · MEST Network");

    for (const [path, title] of [
      ["/network/guidelines", "Community guidelines"],
      ["/network/privacy", "Privacy notice"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByText("Draft for board review").first()).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    }
    await expect(page.getByText("24 months").first()).toBeVisible();
    await expect(page.getByText(/14 days/).first()).toBeVisible();
  });

  test("the scheduled-for-deletion screen sends a visitor to sign in", async ({ page }) => {
    await page.goto("/network/scheduled-for-deletion");
    await expect(page).toHaveURL(/\/network\/signin$/);
  });

  test("the scheduled-for-deletion screen sends a member with no deletion to their account", async ({ page }, testInfo) => {
    const email = `nodelete-${testInfo.project.name}-${Date.now()}@example.test`;
    const login = await page.request.post("/api/auth/dev-login", { data: { email } });
    expect(login.ok()).toBe(true);
    await page.goto("/network/scheduled-for-deletion");
    await expect(page).toHaveURL(/\/network\/onboarding$/);
  });
});

test.describe("landing header", () => {
  test("the landing header links to the directory", async ({ page }) => {
    await page.goto("/");
    const nav = await openLandingMenuIfNeeded(page);
    const directory = nav.getByRole("link", { name: "Directory" });
    await expect(directory).toHaveAttribute("href", "/network/directory");
    await directory.click();
    await expect(page).toHaveURL(/\/network\/directory$/);
    await expect(page.locator(".pn-root header.pn-header")).toBeVisible();
  });

  test("the landing section links still scroll and mark the current section", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("section#hero")).toBeVisible();
    const nav = await openLandingMenuIfNeeded(page);
    await nav.getByRole("link", { name: "Mission" }).click();
    await expect(page).toHaveURL(/\/#mission$/);
    await expect
      .poll(() => page.evaluate(() => Math.abs(document.getElementById("mission")!.getBoundingClientRect().top)))
      .toBeLessThan(200);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // The desktop header nav (present but hidden on phones) carries aria-current.
    const primary = page.locator('nav[aria-label="Primary"]');
    await expect(primary.locator('a[href="#mission"]')).toHaveAttribute("aria-current", "true");
    await expect(primary.locator('a[href="/network/directory"]')).not.toHaveAttribute("aria-current", /.*/);
  });
});
