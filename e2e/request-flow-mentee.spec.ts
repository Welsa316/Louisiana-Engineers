import { expect, test, type Browser, type Page } from "@playwright/test";
import { seedRequestId } from "../server/seed/requests";
import { seedEmail, seedUserId } from "../server/seed/users";
import { reseed } from "./reseed";

/**
 * The mentee's side of a mentorship request against the seed (Task 22).
 * Amina Rahman starts with no pending request: an accepted one with Zainab
 * Qureshi, a declined one from Fatima Noor and an expired one to Layla
 * Haddad. She sends Layla a request through the form; a second one to
 * Layla is refused as a duplicate, both before the form opens and when the
 * server refuses it at send; an introduction to Ibrahim Okafor (networking,
 * not mentoring) goes through; with three waiting, a fourth is refused with
 * the cap message; a request to Fatima, who is paused, is refused and her
 * profile says she is paused.
 *
 * The sends write requests, so they run once per run, in the desktop
 * project, in order, and re-seed afterwards. The phone project checks the
 * screens read-only against the seeded requests.
 */

const LAYLA = seedUserId("layla-haddad");
const OMAR = seedUserId("omar-siddiqui");
const MARIAM = seedUserId("mariam-toure");
const FATIMA = seedUserId("fatima-noor");
const IBRAHIM = seedUserId("ibrahim-okafor");
const ACCEPTED_WITH_ZAINAB = seedRequestId("req-1001");
const DECLINED_BY_FATIMA = seedRequestId("req-1002");
const EXPIRED_TO_LAYLA = seedRequestId("req-1009");

const WHY =
  "I am a junior in civil engineering applying for coastal internships, and your work on licensure is where I want to end up.";

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

/** The option cards are labels around visually hidden radios; click the card, as a person would. */
async function pick(page: Page, name: string | RegExp) {
  const radio = page.getByRole("radio", { name });
  await radio.locator("xpath=ancestor::label").click();
  await expect(radio).toBeChecked();
}

/** A request sent straight to the API, as another tab of the same member would. */
async function postRequest(page: Page, origin: string, body: Record<string, unknown>) {
  return page.request.post("/api/requests", { data: body, headers: { origin } });
}

function mentorshipBody(mentorId: string, topicId: string): Record<string, unknown> {
  return { mentorId, kind: "mentorship", topicId, why: WHY, format: "one-time", mode: "online" };
}

/** Walks the mentorship form from the topic step to the review step. */
async function fillMentorshipForm(page: Page, firstName: string, topic: string | RegExp) {
  await expect(page.getByRole("heading", { level: 1, name: `What do you want to ask ${firstName} about?` })).toBeVisible();
  await pick(page, topic);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Say why." })).toBeVisible();
  // Too short: the step says so and stays put.
  await page.getByLabel(`What made you choose ${firstName}?`).fill("Hello there.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "at least 30 characters" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Say why." })).toBeVisible();
  await page.getByLabel(`What made you choose ${firstName}?`).fill(WHY);
  await page.getByLabel("What would make this a success for you?").fill("A clear plan for the next two summers.");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "How would you like to meet?" })).toBeVisible();
  await page.getByLabel("Scheduling preferences").fill("Weekday evenings after 6 PM");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Review and send." })).toBeVisible();
}

async function withContext<T>(browser: Browser, origin: string, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ baseURL: origin });
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
}

test.describe("mentee request screens (read-only)", () => {
  test("the form, the lists and the seeded requests read right at every width", async ({ page }) => {
    await signIn(page, "amina-rahman");

    // Layla's profile offers the request; the form opens on her topics.
    await page.goto(`/network/me/discover/${LAYLA}`);
    await page.getByRole("link", { name: "Request mentorship" }).click();
    await expect(page).toHaveURL(new RegExp(`/network/me/requests/new\\?mentor=${LAYLA}$`));
    await expect(page.getByRole("heading", { level: 1, name: "What do you want to ask Layla about?" })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(4);
    await expectNoHorizontalOverflow(page);

    // My requests: one open (accepted by Zainab), two closed.
    await page.goto("/network/me/requests");
    await expect(page.getByRole("heading", { level: 1, name: "Where each request stands." })).toBeVisible();
    const rows = page.getByRole("list", { name: "Requests" }).getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Zainab Qureshi");
    await expect(rows.first()).toContainText("Accepted");
    await page.getByRole("button", { name: /^Closed/ }).click();
    await expect(page).toHaveURL(/show=closed/);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Fatima Noor" })).toContainText("Declined");
    await expect(rows.filter({ hasText: "Layla Haddad" })).toContainText("No reply");
    await expectNoHorizontalOverflow(page);

    // Accepted: the methods Zainab handed over, and nothing to withdraw.
    await page.goto(`/network/me/requests/${ACCEPTED_WITH_ZAINAB}`);
    await expect(page.getByRole("heading", { level: 1, name: /Zainab Qureshi/ })).toBeVisible();
    const reach = page.getByRole("region", { name: "How to reach Zainab" });
    await expect(reach.getByRole("link", { name: /@/ })).toHaveAttribute("href", /^mailto:/);
    await expect(page.getByRole("button", { name: "Withdraw" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark as completed" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Declined: the reason and other mentors.
    await page.goto(`/network/me/requests/${DECLINED_BY_FATIMA}`);
    await expect(page.getByText("No capacity right now")).toBeVisible();
    await expect(page.getByRole("region", { name: "Others you could ask" })).toBeVisible();

    // Expired: no reply in time, said kindly, and other mentors.
    await page.goto(`/network/me/requests/${EXPIRED_TO_LAYLA}`);
    await expect(page.getByText(/^No reply within 14 days\./)).toBeVisible();
    const others = page.getByRole("region", { name: "Others you could ask" });
    await expect(others.getByRole("link").first()).toBeVisible();
    // "Others" means someone other than the mentor who did not answer.
    await expect(others.getByRole("link", { name: /Layla Haddad/ })).toHaveCount(0);

    // Saved: the seeded saves, as cards.
    const saved = await page.request.get("/api/me/saved");
    expect(saved.ok()).toBe(true);
    const savedTotal = (await saved.json()).total as number;
    expect(savedTotal).toBeGreaterThan(0);
    await page.goto("/network/me/saved");
    await expect(page.getByRole("heading", { level: 1, name: "People you want to come back to." })).toBeVisible();
    await expect(page.getByRole("list", { name: "Saved profiles" }).getByRole("listitem")).toHaveCount(savedTotal);
    await expectNoHorizontalOverflow(page);
  });

  test("another member cannot open Amina's request", async ({ page }) => {
    await signIn(page, "hamza-ali");
    await page.goto(`/network/me/requests/${ACCEPTED_WITH_ZAINAB}`);
    await expect(page.getByRole("heading", { level: 1, name: "This request is not available." })).toBeVisible();
    await expect(page.getByText(/Zainab/)).toHaveCount(0);
  });
});

test.describe.serial("Amina's requests", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "These send requests; they run once, in the desktop project.");
  });

  test.afterAll(async ({}, testInfo) => {
    if (testInfo.project.name === "desktop-1280") await reseed();
  });

  test("Amina sends a request to Layla", async ({ page }) => {
    await signIn(page, "amina-rahman");
    await page.goto(`/network/me/discover/${LAYLA}`);
    await page.getByRole("link", { name: "Request mentorship" }).click();
    await fillMentorshipForm(page, "Layla", "Professional licensure");

    const review = page.getByRole("region", { name: "Your request to Layla" });
    await expect(review).toContainText("Professional licensure");
    await expect(review).toContainText(WHY);
    await expect(review).toContainText("Weekday evenings after 6 PM");
    await page.getByRole("button", { name: "Send request" }).click();

    // The new request's detail page, pending, with its expiry date.
    await expect(page).toHaveURL(/\/network\/me\/requests\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("status").filter({ hasText: "Request sent to Layla." })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /Layla Haddad/ })).toBeVisible();
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
    await expect(page.getByText(/Waiting for Layla\. Expires /)).toBeVisible();

    const pending = await page.request.get("/api/requests?role=mentee&status=pending");
    const items = (await pending.json()).items as { counterparty: { id: string }; topicId: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ counterparty: { id: LAYLA }, topicId: "professional-licensure" });

    // Her profile now points at the request instead of offering another.
    await page.goto(`/network/me/discover/${LAYLA}`);
    await expect(page.getByRole("link", { name: /^Request pending since / })).toBeVisible();
    await expect(page.getByRole("link", { name: "Request mentorship" })).toHaveCount(0);
  });

  test("a second request to Layla shows the duplicate message", async ({ page, baseURL }) => {
    const origin = baseURL ?? "http://127.0.0.1:8787";
    await signIn(page, "amina-rahman");

    // Opening the form again does not start a second request.
    await page.goto(`/network/me/requests/new?mentor=${LAYLA}`);
    await expect(page.getByRole("heading", { level: 1, name: "You already have a request with Layla." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open your request" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send request" })).toHaveCount(0);

    // The server refuses it too.
    const again = await postRequest(page, origin, mentorshipBody(LAYLA, "professional-licensure"));
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: "duplicate" });

    // And a refusal at send time (another tab got there first) shows the same message.
    await page.goto(`/network/me/discover/${OMAR}`);
    await page.getByRole("link", { name: "Request mentorship" }).click();
    await fillMentorshipForm(page, "Omar", "Technical interviews");
    const first = await postRequest(page, origin, mentorshipBody(OMAR, "technical-interviews"));
    expect(first.status()).toBe(201);
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You already have a request with Omar." })).toBeVisible();
  });

  test("an introduction request to Ibrahim succeeds", async ({ page }) => {
    await signIn(page, "amina-rahman");
    await page.goto(`/network/me/discover/${IBRAHIM}`);
    // Networking only: no mentorship offer, an introduction instead.
    await expect(page.getByRole("link", { name: "Request mentorship" })).toHaveCount(0);
    await page.getByRole("link", { name: "Request an introduction" }).click();
    await expect(page).toHaveURL(new RegExp(`/network/me/requests/new\\?mentor=${IBRAHIM}&kind=introduction$`));

    await expect(page.getByRole("heading", { level: 1, name: "Say why." })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Professional licensure" })).toHaveCount(0);
    await page.getByLabel("What made you choose Ibrahim?").fill(WHY);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "How would you like to meet?" })).toBeVisible();
    // An introduction is a single conversation; only the place is a choice.
    await expect(page.getByRole("radio", { name: "Recurring" })).toHaveCount(0);
    await pick(page, "In person");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("region", { name: "Your request to Ibrahim" })).toContainText("Introduction");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Request sent to Ibrahim." })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /Ibrahim Okafor/ })).toBeVisible();
    await expect(page.getByText(/^Introduction · sent /)).toBeVisible();

    const res = await page.request.get("/api/requests?role=mentee&status=pending");
    const items = (await res.json()).items as { counterparty: { id: string }; kind: string; topicId: string | null }[];
    expect(items.find((r) => r.counterparty.id === IBRAHIM)).toMatchObject({ kind: "introduction", topicId: null });
  });

  test("a fourth pending request shows the cap message", async ({ page }) => {
    await signIn(page, "amina-rahman");
    const mine = await (await page.request.get("/api/me/mentorship")).json();
    expect(mine.pendingOutgoing).toBe(3);

    await page.goto(`/network/me/discover/${MARIAM}`);
    await page.getByRole("link", { name: "Request mentorship" }).click();
    await fillMentorshipForm(page, "Mariam", "Choosing a major");
    await page.getByRole("button", { name: "Send request" }).click();

    const capHeading = page.getByRole("heading", { level: 1, name: "You have 3 requests waiting." });
    await expect(capHeading).toBeVisible();
    // The refusal replaced the steps in place, so focus moves to it for screen readers.
    await expect(capHeading).toBeFocused();
    await expect(page.getByText("Withdraw one or wait for an answer, then come back.")).toBeVisible();
    await page.getByRole("link", { name: "See my requests" }).click();
    await expect(page.getByRole("list", { name: "Requests" }).getByRole("listitem")).toHaveCount(4);

    const res = await page.request.get("/api/requests?role=mentee&status=pending");
    expect((await res.json()).total).toBe(3);
  });

  test("a request to Fatima, who is paused, is refused and her profile shows Paused", async ({ page, browser, baseURL }) => {
    const origin = baseURL ?? "http://127.0.0.1:8787";
    await signIn(page, "amina-rahman");

    await page.goto(`/network/me/discover/${FATIMA}`);
    await expect(page.getByRole("button", { name: "Mentorship paused until January 15" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Request mentorship" })).toHaveCount(0);

    await page.goto(`/network/me/requests/new?mentor=${FATIMA}`);
    await expect(page.getByRole("heading", { level: 1, name: "Fatima is not taking requests right now." })).toBeVisible();
    await expect(page.getByText(/Fatima paused mentoring until January 15\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send request" })).toHaveCount(0);

    const refused = await postRequest(page, origin, mentorshipBody(FATIMA, "graduate-school"));
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "mentor_unavailable" });

    // A visitor reads the same pause.
    await withContext(browser, origin, async (visitor) => {
      const res = await visitor.request.get(`/api/mentors/${FATIMA}/availability`);
      expect(await res.json()).toEqual({ state: "paused", resumeOn: "2027-01-15" });
    });
  });

  test("Amina withdraws a pending request", async ({ page }) => {
    await signIn(page, "amina-rahman");
    const res = await page.request.get("/api/requests?role=mentee&status=pending");
    const omar = ((await res.json()).items as { id: string; counterparty: { id: string } }[]).find(
      (r) => r.counterparty.id === OMAR,
    );
    expect(omar).toBeDefined();

    await page.goto(`/network/me/requests/${omar!.id}`);
    await page.getByRole("button", { name: "Withdraw" }).click();
    const dialog = page.getByRole("dialog", { name: "Withdraw this request?" });
    await dialog.getByRole("button", { name: "Withdraw" }).click();
    await expect(page.getByText("Canceled", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Withdraw" })).toHaveCount(0);

    const after = await (await page.request.get("/api/me/mentorship")).json();
    expect(after.pendingOutgoing).toBe(2);
  });
});
