import { expect, test, type Page } from "@playwright/test";
import { seedEmail, seedUserId } from "../server/seed/users";
import { reseed } from "./reseed";

/**
 * The member home's profile banner says what is actually true of the
 * profile: listed (and to whom), approved but hidden by its owner, or sent
 * back with notes and a way to resubmit. Each test changes seeded rows and
 * re-seeds afterwards.
 */

async function signIn(page: Page, key: string) {
  const res = await page.request.post("/api/auth/dev-login", { data: { email: seedEmail(key) } });
  expect(res.ok()).toBe(true);
}

test.describe("member home", () => {
  test.afterEach(async () => {
    await reseed();
  });

  test("a listed profile says who can find it, and a hidden one says it is hidden", async ({ page, baseURL }) => {
    await signIn(page, "layla-haddad");
    await page.goto("/network/me");
    await expect(page.getByText("Your profile is listed.")).toBeVisible();
    await expect(page.getByText("Anyone can find it in the directory.")).toBeVisible();

    const hide = await page.request.patch("/api/me/settings", {
      data: { visibility: "hidden" },
      headers: { origin: baseURL ?? "http://127.0.0.1:8787" },
    });
    expect(hide.ok()).toBe(true);
    await page.reload();
    await expect(page.getByText("Your profile is approved but hidden.")).toBeVisible();
    await expect(page.getByText("Your profile is listed.")).toHaveCount(0);
  });

  test("a declined professional reads the notes and can update and resubmit", async ({ page, baseURL }) => {
    const origin = baseURL ?? "http://127.0.0.1:8787";
    await signIn(page, "admin");
    const pending = await page.request.get("/api/admin/reviews?status=pending&size=50");
    const reviews = (await pending.json()) as { items: { id: string; profileId: string }[] };
    const musa = reviews.items.find((r) => r.profileId === seedUserId("musa-grant"));
    expect(musa, "the seed opens a review for Musa Grant").toBeTruthy();
    const decline = await page.request.post(`/api/admin/reviews/${musa!.id}`, {
      data: { decision: "declined", notes: "Please describe your engineering work, then submit again." },
      headers: { origin },
    });
    expect(decline.ok()).toBe(true);

    await signIn(page, "musa-grant");
    await page.goto("/network/me");
    await expect(page.getByText("Your profile needs changes before it is listed.")).toBeVisible();
    await expect(page.getByTestId("review-notes")).toHaveText("Please describe your engineering work, then submit again.");
    await expect(page.getByRole("link", { name: "Update and resubmit" })).toHaveAttribute("href", "/network/onboarding");
  });
});
