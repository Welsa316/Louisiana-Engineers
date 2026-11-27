import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Onboarding (03 section 5) for new accounts: a student finishes with the
 * keyboard alone and lands on Home approved; a professional who offers
 * mentoring resumes a saved draft after a reload, submits, lands on
 * `/network/me?submitted=1` and is pending review. The draft lives in this
 * browser only while it is needed: it is gone after submitting and after
 * signing out.
 *
 * Every test signs in a fresh address through the test-only dev-login
 * route, so nothing here changes seeded rows. The professional's
 * submission would otherwise sit in the approval queue the administration
 * spec counts, so an administrator declines it (and rejects the tag it
 * proposed) once the test has looked at it.
 */

const DRAFT_PREFIX = "mest-onboarding-";

/** Left behind by the professional test, for the administrator to clear. */
let pendingCleanup: { reviewId: string; tagIds: string[] } | null = null;

test.afterEach(async ({ playwright, baseURL }) => {
  if (!pendingCleanup || !baseURL) return;
  const { reviewId, tagIds } = pendingCleanup;
  pendingCleanup = null;
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  try {
    expect((await admin.post("/api/auth/dev-login", { data: { email: "admin@example.test" } })).ok()).toBe(true);
    const decline = await admin.post(`/api/admin/reviews/${reviewId}`, {
      data: { decision: "declined", notes: "Test submission from the onboarding spec." },
    });
    expect(decline.ok()).toBe(true);
    for (const id of tagIds) {
      expect((await admin.post(`/api/admin/tags/${id}`, { data: { decision: "rejected" } })).ok()).toBe(true);
    }
  } finally {
    await admin.dispose();
  }
});

async function signInNew(page: Page, label: string, projectName: string): Promise<string> {
  const email = `onb-${label}-${projectName}-${Date.now()}@example.test`;
  const res = await page.request.post("/api/auth/dev-login", { data: { email } });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { redirect: string };
  expect(body.redirect).toBe("/network/onboarding");
  return email;
}

async function draftKeys(page: Page): Promise<string[]> {
  return page.evaluate(
    (prefix) => Object.keys(window.localStorage).filter((key) => key.startsWith(prefix)),
    DRAFT_PREFIX,
  );
}

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => el === document.activeElement);
}

/** Presses Tab until `target` has focus, proving it is reachable by keyboard in order. */
async function tabTo(page: Page, target: Locator, maxPresses = 60): Promise<void> {
  for (let i = 0; i < maxPresses; i += 1) {
    if (await isFocused(target)) return;
    await page.keyboard.press("Tab");
  }
  if (!(await isFocused(target))) throw new Error(`Tab never reached ${target.toString()}`);
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

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

test.describe("onboarding", () => {
  test("a new student completes onboarding with the keyboard only", async ({ page }, testInfo) => {
    await signInNew(page, "student", testInfo.project.name);
    await page.goto("/network/onboarding");
    await expect(heading(page, "Tell us who you are.")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Step 1: the path and the mission statement.
    const student = page.getByRole("radio", { name: /^Student/ });
    await tabTo(page, student);
    await page.keyboard.press("Space");
    await expect(student).toBeChecked();
    const mission = page.getByRole("checkbox", { name: /I share this mission/ });
    await tabTo(page, mission);
    await page.keyboard.press("Space");
    await expect(mission).toBeChecked();
    await tabTo(page, page.getByRole("button", { name: "Continue" }));
    await page.keyboard.press("Enter");

    // Step 2: the new step starts at its heading.
    const basics = heading(page, "Start with the basics.");
    await expect(basics).toBeFocused();

    // Continuing with nothing filled in lists what to fix and links to it.
    await tabTo(page, page.getByRole("button", { name: "Continue" }));
    await page.keyboard.press("Enter");
    const problems = page.getByRole("alert").filter({ hasText: "things to fix before you continue" });
    await expect(problems).toBeFocused();
    await expect(problems).toContainText("First name: Required");
    await expect(problems).toContainText("Last name: Required");
    await expect(problems).toContainText("General location: Required");
    await page.keyboard.press("Tab");
    await expect(problems.getByRole("link", { name: "First name: Required" })).toBeFocused();
    await page.keyboard.press("Enter");
    const firstName = page.getByLabel(/^First name/);
    await expect(firstName).toBeFocused();
    await expect(firstName).toHaveAttribute("aria-invalid", "true");

    await page.keyboard.type("Amina");
    await tabTo(page, page.getByLabel(/^Last name/));
    await page.keyboard.type("Rahman");
    await tabTo(page, page.getByLabel(/^General location/));
    await page.keyboard.type("New Orleans, LA");
    // Fixed fields drop out of the list as they are fixed.
    await expect(problems).toHaveCount(0);
    await expect(firstName).not.toHaveAttribute("aria-invalid", "true");
    await page.keyboard.press("Enter");

    // Step 3: studies.
    await expect(heading(page, "What would help right now?")).toBeFocused();
    const firstLevel = page.getByRole("radio", { name: "High school students" });
    await tabTo(page, firstLevel);
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: "Undergraduates" })).toBeChecked();
    await tabTo(page, page.getByLabel(/^Program/));
    await page.keyboard.type("BS Civil Engineering, junior");
    await tabTo(page, page.getByLabel(/^School or institution/));
    await page.keyboard.type("A New Orleans university");
    await tabTo(page, page.getByLabel(/^What are you working toward/));
    await page.keyboard.type("Land a coastal engineering internship for next summer.");
    const topic = page.getByRole("button", { name: "Internships and first jobs" });
    await tabTo(page, topic);
    await page.keyboard.press("Space");
    await expect(topic).toHaveAttribute("aria-pressed", "true");
    await tabTo(page, page.getByLabel(/^Fields that interest you/));
    await page.keyboard.type("Coastal engineering");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Remove interest Coastal engineering" })).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Continue" }));
    await page.keyboard.press("Enter");

    // Step 4: review shows what a requested mentor sees, and that nobody else sees anything.
    await expect(heading(page, "Check your profile.")).toBeFocused();
    await expect(page.getByText("Student profiles are never listed or searchable")).toBeAttached();
    await expectNoHorizontalOverflow(page);
    expect(await draftKeys(page)).toHaveLength(1);

    await tabTo(page, page.getByRole("button", { name: "Finish" }));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/network\/me$/);

    const res = await page.request.get("/api/me/profile");
    expect(res.ok()).toBe(true);
    const profile = (await res.json()) as {
      kind: string;
      approvalState: string;
      missionAcceptedAt: string | null;
      student: { level: string; topicsNeeded: string[]; interests: string[] } | null;
    };
    expect(profile.kind).toBe("student");
    expect(profile.approvalState).toBe("approved");
    expect(profile.missionAcceptedAt).not.toBeNull();
    expect(profile.student).toMatchObject({
      level: "undergrad",
      topicsNeeded: ["internships-and-first-jobs"],
      interests: ["Coastal engineering"],
    });
    expect(await draftKeys(page)).toEqual([]);

    // Finished members are sent home rather than shown onboarding again.
    await page.goto("/network/onboarding");
    await expect(page).toHaveURL(/\/network\/me$/);
  });

  test("a new professional who mentors resumes a draft, submits and waits for review", async ({ page }, testInfo) => {
    await signInNew(page, "pro", testInfo.project.name);
    await page.goto("/network/onboarding");

    await page.getByText("Professional", { exact: true }).click();
    await page.getByText("I share this mission").click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(heading(page, "Start with the basics.")).toBeVisible();
    await page.getByLabel(/^First name/).fill("Nadia");
    await page.getByLabel(/^Last name/).fill("Karimi");
    await page.getByLabel(/^Credentials/).fill("PE");
    await page.getByLabel(/^General location/).fill("Metairie, LA");
    const bio = page.getByLabel(/^Short biography/);
    await bio.fill("Too short.");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText("Short biography: Use at least 120 characters");
    await bio.fill(
      "I design drainage and flood protection for parishes around the lake, and I lead a small team of civil engineers. I like helping students find their first internship.",
    );
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(heading(page, "What you do.")).toBeVisible();
    await page.getByLabel(/^Discipline/).selectOption("civil");
    await page.getByLabel(/^Job title/).fill("Senior Drainage Engineer");
    await page.getByLabel(/^Company or institution/).fill("Self-employed");
    await page.getByLabel(/^Years of experience/).fill("12");
    const expertise = page.getByLabel(/^Areas of expertise/);
    // A label nobody has proposed before, so it is this member's own proposed tag.
    const proposed = `Stormwater modeling ${Date.now() % 1_000_000}`;
    await expertise.fill(proposed);
    await expertise.press("Enter");
    await expertise.fill("Permitting");
    await expertise.press("Enter");

    // Leaving and coming back resumes the same step with the same answers.
    expect(await draftKeys(page)).toHaveLength(1);
    await page.reload();
    await expect(heading(page, "What you do.")).toBeVisible();
    await expect(page.getByLabel(/^Job title/)).toHaveValue("Senior Drainage Engineer");
    await expect(page.getByRole("button", { name: "Remove area of expertise Permitting" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(heading(page, "How do you want to take part?")).toBeVisible();
    await page.locator("#onb-participation").getByText("Mentorship", { exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(heading(page, "Mentorship, on your terms.")).toBeVisible();
    await page.getByRole("button", { name: "Internships and first jobs" }).click();
    await page.getByRole("button", { name: "Undergraduates" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(heading(page, "Who can see your profile.")).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Public/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /^Members only/ })).not.toBeChecked();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(heading(page, "How people reach you.")).toBeVisible();
    // Phone starts off, and nothing is shown to members until it is in use.
    await expect(page.getByRole("checkbox", { name: "Phone or text: I use this" })).not.toBeChecked();
    const showEmail = page.getByRole("checkbox", { name: "Email: show to signed-in members" });
    await expect(showEmail).toBeDisabled();
    await page.getByRole("checkbox", { name: "Email: I use this" }).check();
    await showEmail.check();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(heading(page, "Almost there.")).toBeVisible();
    await expect(page.getByText("Sign in to see how to reach Nadia.")).toBeAttached();
    await expect(page.getByText("Email: The address you sign in with")).toBeAttached();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Submit for review" }).click();

    await expect(page).toHaveURL(/\/network\/me\?submitted=1$/);
    const res = await page.request.get("/api/me/profile");
    expect(res.ok()).toBe(true);
    const profile = (await res.json()) as {
      kind: string;
      approvalState: string;
      visibility: string;
      review: { id: string; decision: string | null } | null;
      professional: {
        yearsExperience: number;
        participation: string[];
        expertise: { id: string; label: string; status: string }[];
      } | null;
      settings: {
        mentorship: { status: string; topics: string[]; audience: string[] } | null;
        contact: { methods: string[]; shareWithMembers: string[]; phone: string | null } | null;
      };
    };
    if (profile.review) {
      pendingCleanup = {
        reviewId: profile.review.id,
        tagIds: (profile.professional?.expertise ?? []).filter((t) => t.status === "proposed").map((t) => t.id),
      };
    }
    expect(profile.kind).toBe("professional");
    expect(profile.approvalState).toBe("pending");
    expect(profile.visibility).toBe("public");
    expect(profile.review?.decision).toBeNull();
    expect(profile.professional?.yearsExperience).toBe(12);
    expect(profile.professional?.participation).toEqual(expect.arrayContaining(["directory", "networking", "mentoring"]));
    expect(profile.professional?.expertise.map((t) => t.label).sort()).toEqual(["Permitting", proposed].sort());
    expect(profile.settings.mentorship).toMatchObject({
      status: "active",
      topics: ["internships-and-first-jobs"],
      audience: ["undergrad"],
    });
    expect(profile.settings.contact).toMatchObject({ shareWithMembers: ["email"], phone: null });
    expect(profile.settings.contact?.methods.sort()).toEqual(["email", "mest"]);
    expect(await draftKeys(page)).toEqual([]);
  });

  test("signing out removes an unfinished draft from this device", async ({ page }, testInfo) => {
    await signInNew(page, "signout", testInfo.project.name);
    await page.goto("/network/onboarding");
    await page.getByText("Student", { exact: true }).click();
    await page.getByText("I share this mission").click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^First name/).fill("Idris");
    expect(await draftKeys(page)).toHaveLength(1);

    await page.goto("/network/signin");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    expect(await draftKeys(page)).toEqual([]);
  });
});
