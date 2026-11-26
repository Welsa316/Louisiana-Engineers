import { expect, test, type Browser, type Page } from "@playwright/test";
import { seedEmail, seedUserId } from "../server/seed/users";
import { reseed } from "./reseed";

/**
 * Member settings against the seed (Task 16). Layla Haddad pauses her
 * mentorship with a resume date and everyone reading her profile sees it
 * paused; she turns on her phone number, shows it to signed-in members, and
 * a member gets it while a visitor does not; her own preview as a visitor
 * leaves it out and her preview as a member shows it.
 *
 * The changes write seeded rows, so they run once per run, in the desktop
 * project, and re-seed afterwards so every other spec sees the seed as it
 * was. The phone project checks the settings screens read-only.
 */

const LAYLA = seedUserId("layla-haddad");
const PHONE_TYPED = "504 555 0142";
const PHONE_STORED = "+15045550142";

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
    return { scroll: document.documentElement.scrollWidth - width, wide: wide.slice(0, 5).map((el) => el.outerHTML.slice(0, 120)) };
  });
  expect(overflow.scroll, overflow.wide.join("\n")).toBeLessThanOrEqual(0);
}

/** A calendar date `days` from today, as the date input and the API write it. */
function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function withContext<T>(browser: Browser, origin: string, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ baseURL: origin });
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
}

test.describe("member settings", () => {
  test("every section is reachable and none overflows", async ({ page }, testInfo) => {
    await signIn(page, "layla-haddad");
    const phone = testInfo.project.name === "mobile-375";

    await page.goto("/network/settings");
    const nav = page.getByRole("navigation", { name: "Settings sections" });
    await expect(nav.getByRole("link")).toHaveText([
      /^Profile/,
      /^Privacy and contact/,
      /^Mentorship/,
      /^Notifications/,
      /^Preview/,
      /^Account/,
    ]);
    if (phone) {
      // A phone gets the list of sections first; each opens its own screen.
      await expect(page.getByRole("heading", { level: 1, name: "Profile and settings" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save profile" })).toBeHidden();
    } else {
      // A wider screen opens on the profile with the sections beside it.
      await expect(page.getByRole("button", { name: "Save profile" })).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);

    for (const [link, heading] of [
      ["Privacy and contact", "Who sees you and how they reach you."],
      ["Mentorship", "Your time, your rules."],
      ["Notifications", "What we email you."],
      ["Preview", "See your profile as others do."],
      ["Profile", "How you appear in the directory."],
    ] as const) {
      if (phone) await page.goto("/network/settings");
      await nav.getByRole("link", { name: new RegExp(`^${link}`) }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      if (phone) {
        await expect(nav).toBeHidden();
        await expect(page.getByRole("link", { name: "All settings" })).toBeVisible();
      } else {
        await expect(nav.getByRole("link", { name: new RegExp(`^${link}`) })).toHaveAttribute("aria-current", "page");
      }
      await expectNoHorizontalOverflow(page);
    }
  });

  test("a student has no directory or mentorship settings to change", async ({ page }) => {
    await signIn(page, "amina-rahman");
    await page.goto("/network/settings/privacy");
    await expect(page.getByText("Students are never listed in the directory.")).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Public/ })).toHaveCount(0);
    await page.goto("/network/settings/mentorship");
    await expect(page.getByText("Mentorship is offered by professionals.")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("Layla pauses mentorship and shares her phone with members only", async ({ page, browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "These change seeded rows; they run once, in the desktop project.");
    const origin = baseURL ?? "http://127.0.0.1:8787";
    const resumeOn = daysFromToday(30);

    try {
      await signIn(page, "layla-haddad");

      // Pause with a resume date.
      await page.goto("/network/settings/mentorship");
      await expect(page.getByText("Your profile shows: Taking requests")).toBeVisible();
      // The option card is the radio's label; the radio itself is visually hidden.
      const paused = page.getByRole("radio", { name: /^Paused/ });
      await paused.locator("xpath=ancestor::label").click();
      await expect(paused).toBeChecked();
      await page.getByLabel("Resume on").fill(resumeOn);
      await expect(page.getByText(/Your profile will show: Not taking new requests right now, until/)).toBeVisible();
      await page.getByRole("button", { name: "Save mentorship" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Mentorship settings saved." })).toBeVisible();
      await expect(page.getByText(/Your profile shows: Not taking new requests right now, until/)).toBeVisible();

      // Everyone reading her profile sees the pause and the date.
      const shown = await withContext(browser, origin, async (visitor) => {
        const res = await visitor.request.get(`/api/profiles/${LAYLA}`);
        expect(res.ok()).toBe(true);
        return (await res.json()).mentorship;
      });
      expect(shown).toMatchObject({ status: "paused", pausedUntil: resumeOn });

      // Turn the phone on and show it to signed-in members.
      await page.goto("/network/settings/privacy");
      const usePhone = page.getByRole("checkbox", { name: "Use Phone or text" });
      const sharePhone = page.getByRole("checkbox", { name: "Show Phone or text to signed-in members" });
      // Members can only be shown a method that is in use.
      await expect(sharePhone).toBeDisabled();
      await usePhone.check();
      // A chosen phone needs its number.
      await page.getByRole("button", { name: "Save privacy and contact" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Add the phone number to share" })).toBeVisible();
      await page.getByLabel("Phone number").fill(PHONE_TYPED);
      await sharePhone.check();
      await page.getByRole("button", { name: "Save privacy and contact" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Privacy and contact saved." })).toBeVisible();

      // A signed-in member gets the number; a visitor gets nothing.
      const memberContact = await withContext(browser, origin, async (member) => {
        await signIn(member, "amina-rahman");
        const res = await member.request.get(`/api/profiles/${LAYLA}/contact`);
        expect(res.ok()).toBe(true);
        return (await res.json()).methods as { method: string; value: string }[];
      });
      expect(memberContact).toContainEqual({ method: "phone", value: PHONE_STORED });
      const visitorStatus = await withContext(browser, origin, async (visitor) => {
        const res = await visitor.request.get(`/api/profiles/${LAYLA}/contact`);
        return res.status();
      });
      expect(visitorStatus).toBe(401);

      // Her own preview: as a visitor, paused and no phone; as a member, the phone.
      await page.goto("/network/settings/preview");
      const viewer = page.getByRole("group", { name: "Preview as" });
      await viewer.getByRole("button", { name: "Visitor" }).click();
      const preview = page.getByRole("region", { name: "Profile preview" });
      await expect(preview.getByRole("heading", { name: /Layla Haddad/ })).toBeVisible();
      await expect(preview.getByText("Paused", { exact: true })).toBeVisible();
      await expect(preview.getByText("Sign in to see how to reach Layla.")).toBeVisible();
      await expect(preview.getByText(PHONE_STORED)).toHaveCount(0);

      await viewer.getByRole("button", { name: "Member" }).click();
      await expect(preview.getByText(PHONE_STORED)).toBeVisible();
      await expect(preview.getByText("Sign in to see how to reach Layla.")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    } finally {
      await reseed();
    }
  });
});
