import { PREFERENCE_FOOTER, compose, firstName, text, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/**
 * To the professional when an administrator asks for changes. Payload:
 * `firstName`, `notes` (the administrator's notes to them, or null) and
 * `link`.
 */
export function renderProfileDeclined(data: TemplateData, context: TemplateContext): RenderedEmail {
  const name = firstName(data.firstName, "there");
  const notes = text(data.notes).trim();
  return compose({
    subject: "Your MEST Network profile needs changes",
    heading: "Your profile needs changes",
    paragraphs: [
      `Hi ${name},`,
      notes
        ? "An administrator reviewed your profile and asked for these changes before it is listed:"
        : "An administrator reviewed your profile and asked for changes before it is listed.",
      notes,
      "Edit your profile in MEST Network to make them.",
    ],
    button: "Edit your profile",
    link: data.link,
    fallbackPath: "/network/me",
    footer: PREFERENCE_FOOTER,
    context,
  });
}
