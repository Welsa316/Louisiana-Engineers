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
});
