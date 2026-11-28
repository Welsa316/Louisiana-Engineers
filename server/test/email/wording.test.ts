import { describe, expect, it } from "vitest";
import "../../src/email/templates/all";
import { renderTemplate } from "../../src/email/templates/registry";

/** Copy that depends on the payload: an introduction reads differently from a mentorship request. */
describe("template wording", () => {
  it("request_received_uses_the_right_article_for_each_kind", () => {
    const base = { menteeFirstName: "Amina", topicLabel: "Graduate school", expiresOn: "2026-12-10" };
    const intro = renderTemplate("request-received", { ...base, kind: "introduction" }, { appOrigin: "http://x.test" });
    expect(intro.text).toContain("Amina sent you an introduction request.");
    expect(intro.text).not.toContain("a introduction");
    const mentorship = renderTemplate("request-received", { ...base, kind: "mentorship" }, { appOrigin: "http://x.test" });
    expect(mentorship.text).toContain("Amina sent you a mentorship request about Graduate school.");
  });

  it("moderation_action_says_plainly_when_an_account_was_removed", () => {
    const removed = renderTemplate("moderation-action", { firstName: "Bilal", action: "remove_account" }, { appOrigin: "http://x.test" });
    expect(removed.subject).toMatch(/removed/i);
    expect(removed.text).toMatch(/removed your MEST Network account/);
    expect(removed.text).not.toMatch(/Sign in to see where your account stands/);
  });

  it("photo_reviewed_says_which_decision_was_taken", () => {
    const approved = renderTemplate("photo-reviewed", { firstName: "Layla", decision: "approved" }, { appOrigin: "http://x.test" });
    expect(approved.subject).toBe("Your profile photo is approved");
    expect(approved.text).toContain("in place of your initials");
    const rejected = renderTemplate("photo-reviewed", { firstName: "Layla", decision: "rejected" }, { appOrigin: "http://x.test" });
    expect(rejected.subject).toBe("Your profile photo was not approved");
    expect(rejected.text).toContain("your initials show on your profile instead");
    expect(rejected.text).not.toContain("approved your profile photo");
  });
});
