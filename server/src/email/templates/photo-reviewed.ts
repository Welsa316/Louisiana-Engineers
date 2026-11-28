import { PREFERENCE_FOOTER, compose, firstName, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/**
 * To the member when an administrator approves or rejects their profile
 * photo (`admin_review_photo`, Task 33). Payload: `firstName`, `decision`
 * (`approved` or `rejected`) and `link`. No reason is given: the decision
 * is the whole message.
 */
export function renderPhotoReviewed(data: TemplateData, context: TemplateContext): RenderedEmail {
  const name = firstName(data.firstName, "there");
  const approved = data.decision === "approved";
  return compose({
    subject: approved ? "Your profile photo is approved" : "Your profile photo was not approved",
    heading: approved ? "Your photo is approved" : "Your photo was not approved",
    paragraphs: approved
      ? [
          `Hi ${name},`,
          "An administrator approved your profile photo. It now shows on your profile in place of your initials.",
          "You can change or remove it in Settings at any time.",
        ]
      : [
          `Hi ${name},`,
          "An administrator did not approve your profile photo, so your initials show on your profile instead.",
          "A clear photo of you, on your own, works best. You can upload a different one in Settings.",
        ],
    button: "Open your profile settings",
    link: data.link,
    fallbackPath: "/network/settings/profile",
    footer: PREFERENCE_FOOTER,
    context,
  });
}
