import { ACCOUNT_FOOTER, compose, firstName, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/**
 * To a member who kept their account during the grace period
 * (`cancel_account_deletion`, Task 26; always sent). Payload contract:
 * `firstName` and `link`.
 */
export function renderDeletionCanceled(data: TemplateData, context: TemplateContext): RenderedEmail {
  const name = firstName(data.firstName, "there");
  return compose({
    subject: "Your MEST Network account will not be deleted",
    heading: "Your account will not be deleted",
    paragraphs: [
      `Hi ${name},`,
      "You chose to keep your MEST Network account, so the deletion is canceled.",
      "Your profile visibility and mentorship settings are back to what they were.",
    ],
    button: "Open MEST Network",
    link: data.link,
    fallbackPath: "/network/me",
    footer: ACCOUNT_FOOTER,
    context,
  });
}
