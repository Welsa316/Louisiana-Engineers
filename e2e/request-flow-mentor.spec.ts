import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { seedRequestId } from "../server/seed/requests";
import { seedEmail, seedUserId } from "../server/seed/users";
import { reseed } from "./reseed";

/**
 * The mentor's side of a mentorship request against the seed (Task 23).
 * Layla Haddad takes 3 mentees at once and has one (Sumaya Osman), with two
 * requests waiting (Hamza Ali, two days old; Leen Saleh, one day old) and a
 * completed one with Idris Fofana. Tariq Mansour mentors but uses only
 * "Requests through MEST", which is not a handoff, so he has nothing to
 * share until he adds a method.
 *
 * `beforeAll` sends Layla and Tariq a request from Amina Rahman through the
 * API and turns on Layla's email (she uses LinkedIn and a scheduling link
 * in the seed). Layla accepts, sharing email only; Amina's request then
 * shows Accepted and the address; another member gets 404; Layla marks it
 * completed and her capacity line drops by one. Tariq's accept sends him to
 * Privacy and contact and back. Those run once, in the desktop project, and
 * re-seed afterwards; the phone project reads the seeded inbox only.
 */

const LAYLA = seedUserId("layla-haddad");
const TARIQ = seedUserId("tariq-mansour");
const SUMAYA_WITH_LAYLA = seedRequestId("req-1005");
const HAMZA_TO_LAYLA = seedRequestId("req-1003");
const AMINA_TO_ZAINAB = seedRequestId("req-1001");

const WHY =
  "I am a junior in civil engineering planning for the FE exam, and I would value an hour with someone who passed it while working.";

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
    return { width, scroll: document.documentElement.scrollWidth, wide: wide.slice(0, 5).map((el) => el.outerHTML.slice(0, 120)) };
  });
  expect(overflow.width).toBe(page.viewportSize()?.width ?? overflow.width);
  expect(overflow.scroll, overflow.wide.join("\n")).toBeLessThanOrEqual(overflow.width);
}

async function withMember<T>(browser: Browser, origin: string, key: string, run: (api: APIRequestContext) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ baseURL: origin });
  try {
    const page = await context.newPage();
    await signIn(page, key);
    return await run(page.request);
  } finally {
    await context.close();
  }
}

async function sendRequest(api: APIRequestContext, origin: string, mentorId: string, topicId: string): Promise<string> {
  const res = await api.post("/api/requests", {
    data: { mentorId, kind: "mentorship", topicId, why: WHY, format: "one-time", mode: "online" },
    headers: { origin },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const capacityLine = (page: Page) => page.getByTestId("capacity-line");

test.describe("mentor screens (read-only)", () => {
  test("the dashboard, the inbox, a request and the mentees read right at every width", async ({ page }) => {
    await signIn(page, "layla-haddad");

    // The dashboard: two waiting, one of three taken.
    await page.goto("/network/mentor");
    await expect(page.getByRole("heading", { level: 1, name: "2 people are waiting to hear from you." })).toBeVisible();
    await expect(capacityLine(page)).toHaveText(/1 of 3 active/);
    await expectNoHorizontalOverflow(page);

    // The inbox: waiting requests oldest first, with days left.
    await page.goto("/network/mentor/requests");
    await expect(page.getByRole("heading", { level: 1, name: "People who asked for your time." })).toBeVisible();
    await expect(capacityLine(page)).toHaveText(/1 of 3 active/);
    const rows = page.getByRole("list", { name: "Requests" }).getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Hamza Ali");
    await expect(rows.nth(1)).toContainText("Leen Saleh");
    await expect(rows.nth(0)).toContainText(/\d+ days left/);
    await expectNoHorizontalOverflow(page);

    // A waiting request: the student's details and both answers.
    await rows.nth(0).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/network/mentor/requests/${HAMZA_TO_LAYLA}$`));
    const drawer = page.getByRole("dialog", { name: "Hamza Ali" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Leadership and management");
    await expect(drawer).toContainText("I am leading a student project team");
    await expect(drawer.getByRole("button", { name: "Accept" })).toBeEnabled();
    await expect(drawer.getByRole("button", { name: "Decline" })).toBeEnabled();
    await expectNoHorizontalOverflow(page);
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/network\/mentor\/requests$/);

    // Active and past tabs.
    await page.getByRole("button", { name: /^Active/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Sumaya Osman");
    await page.getByRole("button", { name: /^Past/ }).click();
    await expect(rows.filter({ hasText: "Idris Fofana" })).toContainText("Completed");

    // Mentees: Sumaya active with what Layla shared; Idris completed.
    await page.goto("/network/mentor/mentees");
    await expect(page.getByRole("heading", { level: 1, name: "People you said yes to." })).toBeVisible();
    const active = page.getByRole("region", { name: /^Active/ });
    await expect(active.getByRole("article")).toHaveCount(1);
    await expect(active.getByRole("article").first()).toContainText("Sumaya Osman");
    await expect(active.getByRole("article").first()).toContainText("Scheduling link");
    await expect(page.getByRole("region", { name: /^Completed/ })).toContainText("Idris Fofana");
    await expectNoHorizontalOverflow(page);

    // One relationship.
    await page.goto(`/network/mentor/mentees/${SUMAYA_WITH_LAYLA}`);
    await expect(page.getByRole("heading", { level: 1, name: "Sumaya Osman" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark as completed" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Home's mentoring card says the same.
    await page.goto("/network/me");
    const card = page.getByRole("region", { name: "Requests waiting for you" });
    await expect(card).toContainText("Hamza Ali");
    await expect(card.getByTestId("capacity-line")).toHaveText(/1 of 3 active/);
  });

  test("the mentee of a request is sent to their own view of it", async ({ page }) => {
    await signIn(page, "amina-rahman");
    await page.goto(`/network/mentor/requests/${AMINA_TO_ZAINAB}`);
    await expect(page).toHaveURL(new RegExp(`/network/me/requests/${AMINA_TO_ZAINAB}$`));
  });
});

test.describe.serial("Layla and Tariq answer Amina", () => {
  let toLayla = "";
  let toTariq = "";

  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "These answer requests; they run once, in the desktop project.");
  });

  test.beforeAll(async ({ browser }, testInfo) => {
    if (testInfo.project.name !== "desktop-1280") return;
    const origin = testInfo.project.use.baseURL ?? "http://127.0.0.1:8787";
    await withMember(browser, origin, "amina-rahman", async (api) => {
      toLayla = await sendRequest(api, origin, LAYLA, "professional-licensure");
      toTariq = await sendRequest(api, origin, TARIQ, "internships-and-first-jobs");
    });
    // Layla starts using email (her sign-in address) besides LinkedIn and her scheduling link.
    await withMember(browser, origin, "layla-haddad", async (api) => {
      const res = await api.patch("/api/me/settings", {
        data: { contact: { methods: ["mest", "email", "linkedin", "booking"] } },
        headers: { origin },
      });
      expect(res.status(), await res.text()).toBe(200);
    });
  });

  test.afterAll(async ({}, testInfo) => {
    if (testInfo.project.name === "desktop-1280") await reseed();
  });

  test("Layla accepts, sharing email", async ({ page }) => {
    await signIn(page, "layla-haddad");
    await page.goto(`/network/mentor/requests/${toLayla}`);
    const drawer = page.getByRole("dialog", { name: "Amina Rahman" });
    await expect(drawer).toContainText("BS Civil Engineering, junior");
    await expect(drawer).toContainText("Professional licensure");
    await expect(drawer).toContainText(WHY);
    await drawer.getByRole("button", { name: "Accept" }).click();

    // The methods she uses, prefilled with what members already see.
    const email = drawer.getByRole("checkbox", { name: /^Email/ });
    const linkedin = drawer.getByRole("checkbox", { name: /^LinkedIn/ });
    const booking = drawer.getByRole("checkbox", { name: /^Scheduling link/ });
    await expect(email).not.toBeChecked();
    await expect(linkedin).toBeChecked();
    await expect(booking).toBeChecked();
    await expect(drawer.getByRole("checkbox", { name: /Requests through MEST/ })).toHaveCount(0);
    await expect(drawer.getByText("Meet in public places; MEST does not supervise meetings.")).toBeVisible();

    // At least one: unticking everything is caught before sending.
    await linkedin.locator("xpath=ancestor::label").click();
    await booking.locator("xpath=ancestor::label").click();
    await drawer.getByRole("button", { name: "Accept and share" }).click();
    await expect(drawer.getByRole("alert")).toContainText("Choose at least one way");

    await email.locator("xpath=ancestor::label").click();
    await expect(email).toBeChecked();
    await drawer.getByLabel("A short note").fill("Happy to help, Amina. Email me two times that suit you.");
    await drawer.getByRole("button", { name: "Accept and share" }).click();

    await expect(drawer.getByRole("status")).toContainText("Amina can now see how to reach you");
    await expect(drawer.getByText("Accepted", { exact: true })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Open relationship" })).toBeVisible();

    await page.goto("/network/mentor");
    await expect(capacityLine(page)).toHaveText(/2 of 3 active/);
  });

  test("Amina's request shows Accepted and the email address", async ({ page }) => {
    await signIn(page, "amina-rahman");
    await page.goto(`/network/me/requests/${toLayla}`);
    await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
    const reach = page.getByRole("region", { name: "How to reach Layla" });
    await expect(reach.getByRole("link", { name: seedEmail("layla-haddad") })).toHaveAttribute(
      "href",
      `mailto:${seedEmail("layla-haddad")}`,
    );
    // Only what Layla handed over.
    await expect(reach.getByRole("listitem")).toHaveCount(1);
    await expect(reach).not.toContainText("linkedin.com");
  });

  test("another member gets 404 on that request", async ({ page }) => {
    await signIn(page, "hamza-ali");
    const res = await page.request.get(`/api/requests/${toLayla}`);
    expect(res.status()).toBe(404);
    await page.goto(`/network/mentor/requests/${toLayla}`);
    await expect(page.getByRole("heading", { level: 1, name: "This request is not available." })).toBeVisible();
    await expect(page.getByText(/Amina/)).toHaveCount(0);
  });

  test("Layla marks it complete and her capacity line drops by one", async ({ page }) => {
    await signIn(page, "layla-haddad");
    await page.goto("/network/mentor/requests");
    await expect(capacityLine(page)).toHaveText(/2 of 3 active/);

    await page.goto("/network/mentor/mentees");
    const card = page.getByRole("region", { name: /^Active/ }).getByRole("article").filter({ hasText: "Amina Rahman" });
    await expect(card).toContainText("Email");
    await card.getByRole("link", { name: "Open" }).click();
    await expect(page).toHaveURL(new RegExp(`/network/mentor/mentees/${toLayla}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Amina Rahman" })).toBeVisible();

    await page.getByRole("button", { name: "Mark as completed" }).click();
    const dialog = page.getByRole("dialog", { name: "Mark this as completed?" });
    await dialog.getByRole("button", { name: "Mark as completed" }).click();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark as completed" })).toHaveCount(0);

    await page.goto("/network/mentor/requests");
    await expect(capacityLine(page)).toHaveText(/1 of 3 active/);
    const mine = await (await page.request.get("/api/me/mentorship")).json();
    expect(mine.activeCount).toBe(1);
  });

  test("Tariq, who uses only requests through MEST, adds a method before accepting", async ({ page }) => {
    await signIn(page, "tariq-mansour");
    await page.goto(`/network/mentor/requests/${toTariq}`);
    const drawer = page.getByRole("dialog", { name: "Amina Rahman" });
    await drawer.getByRole("button", { name: "Accept" }).click();

    // Nothing to hand over yet: no checkboxes, no accept, a way to add one.
    await expect(drawer).toContainText("Requests through MEST is not a way to reach you directly");
    await expect(drawer.getByRole("checkbox")).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Accept and share" })).toHaveCount(0);
    await drawer.getByRole("link", { name: "Add a contact method" }).click();

    await expect(page).toHaveURL(/\/network\/settings\/privacy\?back=/);
    await expect(page.getByRole("heading", { level: 1, name: "Who sees you and how they reach you." })).toBeVisible();
    await page.getByRole("checkbox", { name: "Use Email" }).check();
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Privacy and contact saved." })).toBeVisible();
    await page.getByRole("link", { name: "Back to the request" }).click();

    await expect(page).toHaveURL(new RegExp(`/network/mentor/requests/${toTariq}$`));
    const back = page.getByRole("dialog", { name: "Amina Rahman" });
    await back.getByRole("button", { name: "Accept" }).click();
    const email = back.getByRole("checkbox", { name: /^Email/ });
    await email.locator("xpath=ancestor::label").click();
    await back.getByRole("button", { name: "Accept and share" }).click();
    await expect(back.getByRole("status")).toContainText("Amina can now see how to reach you");

    const detail = await (await page.request.get(`/api/requests/${toTariq}`)).json();
    expect(detail).toMatchObject({ status: "accepted", relationship: { sharedMethods: ["email"] } });
  });
});
