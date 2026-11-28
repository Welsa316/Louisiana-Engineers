import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { closePool } from "../server/src/db/pool";
import { withSystem } from "../server/src/db/tx";
import { seedMeetings } from "../server/seed/meetings";
import { seedRequestId } from "../server/seed/requests";
import { seedEmail } from "../server/seed/users";
import { fmtMeetingSpan, louisianaDateAfter, louisianaToIso } from "../shared/meeting-time";
import type { Meeting, MeetingLogResponse, Slot, SlotsResponse } from "../shared/types/meetings";
import { reseed } from "./reseed";

/**
 * The scheduling screens (Task 31) against the seeded schedule
 * (server/seed/meetings.ts): Amina Rahman and Zainab Qureshi (req-1001)
 * met three days ago without saying so and meet again in five days;
 * Layla Haddad proposed three times to Sumaya Osman (req-1005); Layla met
 * Idris Fofana (req-1006, completed).
 *
 * The read-only checks run at 375 and 1280. The booking story runs once,
 * in the desktop project: Sumaya chooses one of Layla's times, Layla sees
 * it, cancels it and proposes two new times with the date and time
 * pickers, Sumaya sees them, and Amina answers "Did you meet?". The
 * schedule is put back before and after, so no other spec depends on it.
 */

const ZAINAB_WITH_AMINA = seedRequestId("req-1001");
const LAYLA_WITH_SUMAYA = seedRequestId("req-1005");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function resetSchedule(): Promise<void> {
  await reseed();
  try {
    await withSystem(seedMeetings);
  } finally {
    await closePool();
  }
}

async function signIn(page: Page, key: string) {
  const res = await page.request.post("/api/auth/dev-login", { data: { email: seedEmail(key) } });
  expect(res.ok(), await res.text()).toBe(true);
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

/** No serious or critical axe violation on the page as it stands. */
async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const found = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}) ${v.help} -> ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(found, found.join("\n")).toEqual([]);
}

async function openSlots(page: Page, requestId: string): Promise<Slot[]> {
  const res = await page.request.get(`/api/relationships/${requestId}/slots?status=proposed`);
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as SlotsResponse;
  return [...body.items].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

async function relationshipMeetings(page: Page, requestId: string): Promise<Meeting[]> {
  const res = await page.request.get(`/api/relationships/${requestId}/meetings`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: Meeting[] }).items;
}

// A browser far from Louisiana: the screens must still read and write
// Louisiana time, not the device's.
test.use({ timezoneId: "Asia/Tokyo" });

const span = (m: { startsAt: string; endsAt: string }) => fmtMeetingSpan(m.startsAt, m.endsAt);
const meetingsRegion = (page: Page) => page.getByRole("region", { name: "Meetings" });

test.beforeAll(async () => {
  // The global setup may predate the meetings seed; start from the listed schedule.
  await resetSchedule();
});

test.describe("scheduling screens (read-only)", () => {
  test("Amina sees the meeting to come, the one to answer, and her meetings log", async ({ page }) => {
    await signIn(page, "amina-rahman");
    const [next, past] = [...(await relationshipMeetings(page, ZAINAB_WITH_AMINA))].sort((a, b) =>
      b.startsAt.localeCompare(a.startsAt),
    );
    expect(next.status).toBe("upcoming");
    expect(past.awaitingOutcome).toBe(true);

    await page.goto(`/network/me/requests/${ZAINAB_WITH_AMINA}`);
    const meetings = meetingsRegion(page);
    await expect(meetings).toBeVisible();

    const ask = meetings.getByRole("group", { name: "Did you meet Zainab?" });
    await expect(ask).toContainText(span(past));
    await expect(ask.getByRole("button", { name: "Yes, we met" })).toBeVisible();
    await expect(ask.getByRole("button", { name: "No, it did not happen" })).toBeVisible();

    const upcoming = meetings.getByRole("article").filter({ hasText: "Next meeting" });
    await expect(upcoming).toContainText(span(next));
    await expect(upcoming).toContainText("Online");
    await expect(upcoming).toContainText("Video call; Zainab sends the link");
    await expect(upcoming).toContainText("Practice answers for structural internship interviews.");
    await expect(upcoming.getByRole("button", { name: "Cancel meeting" })).toBeVisible();
    await expect(meetings.getByRole("button", { name: "Propose times" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAxeClean(page);

    // The log: upcoming first, then what has happened.
    await page.goto("/network/me/meetings");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const rows = page.getByRole("list", { name: "Meetings" }).getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Zainab Qureshi");
    await expect(rows.first()).toContainText(span(next).split(" · ")[1]);
    await expect(rows.first()).toContainText("Upcoming");
    await expectNoHorizontalOverflow(page);
    await expectAxeClean(page);

    await page.getByRole("button", { name: /^Past/ }).click();
    await expect(page).toHaveURL(/show=past/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Zainab Qureshi");
    await expect(rows.first().getByRole("group", { name: "Did you meet Zainab?" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAxeClean(page);

    await rows.first().getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/network/me/requests/${ZAINAB_WITH_AMINA}$`));
  });

  test("Sumaya sees Layla's three times to choose from", async ({ page }) => {
    await signIn(page, "sumaya-osman");
    const slots = await openSlots(page, LAYLA_WITH_SUMAYA);
    expect(slots).toHaveLength(3);

    await page.goto(`/network/me/requests/${LAYLA_WITH_SUMAYA}`);
    const meetings = meetingsRegion(page);
    await expect(meetings.getByRole("heading", { name: "Layla proposed 3 times" })).toBeVisible();
    const choices = meetings.getByRole("radiogroup", { name: "Choose a time" }).getByRole("radio");
    await expect(choices).toHaveCount(3);
    for (const [i, slot] of slots.entries()) {
      await expect(choices.nth(i)).toHaveAccessibleName(new RegExp(`^${escape(span(slot))}`));
    }
    await expect(meetings.getByRole("button", { name: "Confirm this time" })).toBeVisible();
    await expect(page.getByText("Times are in Louisiana time").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAxeClean(page);
  });

  test("Layla's proposal waits, the dialog takes up to three times, and her log shows Idris", async ({ page }) => {
    await signIn(page, "layla-haddad");
    const slots = await openSlots(page, LAYLA_WITH_SUMAYA);

    await page.goto(`/network/mentor/mentees/${LAYLA_WITH_SUMAYA}`);
    const meetings = meetingsRegion(page);
    const waiting = meetings.getByRole("article").filter({ hasText: "Waiting for Sumaya to choose" });
    for (const slot of slots) await expect(waiting).toContainText(span(slot));
    await waiting.getByRole("button", { name: "Change the times" }).click();

    const dialog = page.getByRole("dialog", { name: "Propose times to meet" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Date")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Add another time" }).click();
    await dialog.getByRole("button", { name: "Add another time" }).click();
    await expect(dialog.getByLabel("Date")).toHaveCount(3);
    await expect(dialog.getByLabel("Start time")).toHaveCount(3);
    await expect(dialog.getByRole("button", { name: "Add another time" })).toHaveCount(0);
    await expect(dialog).toContainText("Up to three times");
    await expectNoHorizontalOverflow(page);
    await expectAxeClean(page);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/network/me/meetings?show=past");
    const rows = page.getByRole("list", { name: "Meetings" }).getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Idris Fofana");
    await expect(rows.first()).toContainText("Met");
    await expectNoHorizontalOverflow(page);
  });
});

test.describe.serial("Sumaya and Layla book, cancel and rebook; Amina answers", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "These change the schedule; they run once, in the desktop project.");
  });

  test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name === "desktop-1280") await resetSchedule();
  });

  test.afterAll(async ({}, testInfo) => {
    if (testInfo.project.name === "desktop-1280") await resetSchedule();
  });

  let chosen: Slot | null = null;

  test("Sumaya chooses Layla's second time, in person", async ({ page }) => {
    await signIn(page, "sumaya-osman");
    const slots = await openSlots(page, LAYLA_WITH_SUMAYA);
    chosen = slots[1];

    await page.goto(`/network/me/requests/${LAYLA_WITH_SUMAYA}`);
    const meetings = meetingsRegion(page);
    await meetings.getByRole("radio", { name: new RegExp(`^${escape(span(chosen))}`) }).check({ force: true });
    await meetings.getByRole("radio", { name: /^In person/ }).check({ force: true });
    await meetings.getByRole("textbox", { name: /^Where/ }).fill("The cafe on the ground floor of the engineering building");
    await meetings.getByRole("textbox", { name: /^What you want to cover/ }).fill("Which electives to take before the spring internship search.");
    await meetings.getByRole("button", { name: "Confirm this time" }).click();

    const next = meetings.getByRole("article").filter({ hasText: "Next meeting" });
    await expect(next).toContainText(span(chosen));
    await expect(next).toContainText("In person");
    await expect(next).toContainText("The cafe on the ground floor of the engineering building");
    await expect(meetings.getByRole("heading", { name: /Layla proposed/ })).toHaveCount(0);

    // The rest of Layla's proposal is declined.
    const all = (await (await page.request.get(`/api/relationships/${LAYLA_WITH_SUMAYA}/slots`)).json()) as SlotsResponse;
    expect(all.items.map((s) => [s.id === chosen!.id, s.status]).sort()).toEqual([
      [false, "declined"],
      [false, "declined"],
      [true, "chosen"],
    ]);
  });

  test("Layla sees it, cancels it and proposes two new times", async ({ page }) => {
    await signIn(page, "layla-haddad");
    await page.goto(`/network/mentor/mentees/${LAYLA_WITH_SUMAYA}`);
    const meetings = meetingsRegion(page);
    const next = meetings.getByRole("article").filter({ hasText: "Next meeting" });
    await expect(next).toContainText(span(chosen!));
    await expect(next).toContainText("Which electives to take before the spring internship search.");

    await next.getByRole("button", { name: "Cancel meeting" }).click();
    const confirm = page.getByRole("dialog", { name: "Cancel this meeting?" });
    await expect(confirm).toContainText("Sumaya");
    await confirm.getByRole("button", { name: "Cancel meeting" }).click();
    await expect(confirm).toBeHidden();
    await expect(meetings.getByRole("article").filter({ hasText: "Next meeting" })).toHaveCount(0);
    const earlier = meetings.getByRole("list", { name: "Earlier meetings" });
    await expect(earlier.getByRole("listitem").filter({ hasText: span(chosen!) })).toContainText("Canceled by you");

    await meetings.getByRole("button", { name: "Propose times" }).click();
    const dialog = page.getByRole("dialog", { name: "Propose times to meet" });
    const firstDay = louisianaDateAfter(new Date(), 9);
    const secondDay = louisianaDateAfter(new Date(), 10);

    // A time already gone is caught before sending.
    await dialog.getByLabel("Date").first().fill(louisianaDateAfter(new Date(), -1));
    await dialog.getByLabel("Start time").first().fill("09:00");
    await dialog.getByRole("button", { name: "Send times" }).click();
    await expect(dialog.getByRole("alert")).toContainText("in the future");

    await dialog.getByLabel("Date").first().fill(firstDay);
    await dialog.getByRole("button", { name: "Add another time" }).click();
    await dialog.getByLabel("Date").nth(1).fill(secondDay);
    await dialog.getByLabel("Start time").nth(1).fill("14:30");
    await dialog.getByLabel("Length").selectOption("60");
    await dialog.getByRole("button", { name: "Send times" }).click();
    await expect(dialog).toBeHidden();

    const proposed = [
      { startsAt: louisianaToIso(firstDay, "09:00")!, minutes: 60 },
      { startsAt: louisianaToIso(secondDay, "14:30")!, minutes: 60 },
    ].map((t) => ({ startsAt: t.startsAt, endsAt: new Date(Date.parse(t.startsAt) + t.minutes * 60_000).toISOString() }));
    const waiting = meetings.getByRole("article").filter({ hasText: "Waiting for Sumaya to choose" });
    for (const t of proposed) await expect(waiting).toContainText(span(t));

    const open = await openSlots(page, LAYLA_WITH_SUMAYA);
    expect(open.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt, proposedBy: s.proposedBy }))).toEqual(
      proposed.map((t) => ({ ...t, proposedBy: "me" })),
    );
  });

  test("Sumaya sees the two new times and who canceled", async ({ page }) => {
    await signIn(page, "sumaya-osman");
    await page.goto(`/network/me/requests/${LAYLA_WITH_SUMAYA}`);
    const meetings = meetingsRegion(page);
    await expect(meetings.getByRole("heading", { name: "Layla proposed 2 times" })).toBeVisible();
    await expect(meetings.getByRole("radiogroup", { name: "Choose a time" }).getByRole("radio")).toHaveCount(2);
    await expect(meetings.getByRole("list", { name: "Earlier meetings" })).toContainText("Canceled by Layla");
  });

  test("Amina answers that she and Zainab met", async ({ page }) => {
    await signIn(page, "amina-rahman");
    await page.goto(`/network/me/requests/${ZAINAB_WITH_AMINA}`);
    const meetings = meetingsRegion(page);
    await meetings.getByRole("group", { name: "Did you meet Zainab?" }).getByRole("button", { name: "Yes, we met" }).click();
    await expect(meetings.getByRole("group", { name: "Did you meet Zainab?" })).toHaveCount(0);
    await expect(meetings.getByRole("list", { name: "Earlier meetings" })).toContainText("You met");

    const log = (await (await page.request.get("/api/meetings?when=past")).json()) as MeetingLogResponse;
    expect(log.items.map((m) => ({ met: m.met, outcomeBy: m.outcomeBy, status: m.status }))).toEqual([
      { met: true, outcomeBy: "me", status: "completed" },
    ]);
    await page.goto("/network/me/meetings?show=past");
    await expect(page.getByRole("list", { name: "Meetings" }).getByRole("listitem").first()).toContainText("Met");
  });

  test("someone outside the mentorship gets 404 on its times and meetings", async ({ page }) => {
    await signIn(page, "hamza-ali");
    expect((await page.request.get(`/api/relationships/${LAYLA_WITH_SUMAYA}/slots`)).status()).toBe(404);
    expect((await page.request.get(`/api/relationships/${LAYLA_WITH_SUMAYA}/meetings`)).status()).toBe(404);
  });
});

/** A string as a literal inside a RegExp. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
