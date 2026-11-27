import { PREFERENCE_FOOTER, compose, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/** To the professional when an administrator verifies their affiliation. Payload: `link`. */
export function renderProfileVerified(data: TemplateData, context: TemplateContext): RenderedEmail {
  return compose({
    subject: "Your affiliation is verified",
    heading: "Your affiliation is verified",
    paragraphs: [
      "An administrator verified your title and organization.",
      "Your profile in the MEST Network directory now shows them as verified.",
    ],
    button: "View your profile",
    link: data.link,
    fallbackPath: "/network/me",
    footer: PREFERENCE_FOOTER,
    context,
  });
}
