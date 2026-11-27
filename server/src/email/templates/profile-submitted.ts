import { PREFERENCE_FOOTER, compose, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/**
 * To every administrator when a professional profile enters an empty review
 * queue (`open_profile_review` through `notify_admins`). Payload: `link`
 * only; the profile itself is read in the queue.
 */
export function renderProfileSubmitted(data: TemplateData, context: TemplateContext): RenderedEmail {
  return compose({
    subject: "A profile is waiting for review",
    heading: "A profile is waiting for review",
    paragraphs: [
      "A professional submitted a profile to the MEST Network directory.",
      "It is listed once an administrator approves it in the review queue.",
    ],
    button: "Open the review queue",
    link: data.link,
    fallbackPath: "/network/admin/queue",
    footer: PREFERENCE_FOOTER,
    context,
  });
}
