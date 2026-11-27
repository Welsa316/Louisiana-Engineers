import { ACCOUNT_FOOTER, compose, firstName, formatDay, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/**
 * To a member who asked to delete their account (`request_account_deletion`,
 * Task 26; always sent). Payload contract: `firstName`, `executeOn`
 * (`YYYY-MM-DD`, the day the deletion runs) and `link`.
 */
export function renderDeletionRequested(data: TemplateData, context: TemplateContext): RenderedEmail {
  const name = firstName(data.firstName, "there");
  const on = formatDay(data.executeOn);
  return compose({
    subject: "Your MEST Network account is scheduled for deletion",
    heading: "Your account is scheduled for deletion",
    paragraphs: [
      `Hi ${name},`,
      on ? `Your MEST Network account will be deleted on ${on}.` : "Your MEST Network account will be deleted in 14 days.",
      "Your profile is already hidden from the directory, and your open requests were closed.",
      "If you change your mind, sign in before then and choose Keep my account. If you did not ask for this, sign in and keep your account.",
    ],
    button: "Keep my account",
    link: data.link,
    fallbackPath: "/network/scheduled-for-deletion",
    footer: ACCOUNT_FOOTER,
    context,
  });
}
