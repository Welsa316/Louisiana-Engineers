import { PREFERENCE_FOOTER, compose, firstName, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/** To the professional when an administrator approves their profile. Payload: `firstName`, `link`. */
export function renderProfileApproved(data: TemplateData, context: TemplateContext): RenderedEmail {
  const name = firstName(data.firstName, "there");
  return compose({
    subject: "Your MEST Network profile is approved",
    heading: "Your profile is approved",
    paragraphs: [
      `Hi ${name},`,
      "Your profile is now listed in the MEST Network directory. Members can find you by your discipline and expertise.",
      "You can change what you share, and whether you take mentorship requests, in Settings at any time.",
    ],
    button: "View your profile",
    link: data.link,
    fallbackPath: "/network/me",
    footer: PREFERENCE_FOOTER,
    context,
  });
}
