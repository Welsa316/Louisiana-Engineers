import {
  PREFERENCE_FOOTER, compose, firstName, requestPath,
  type RenderedEmail, type TemplateContext, type TemplateData,
} from "./registry";

/**
 * To the party who did not mark a relationship completed
 * (`complete_relationship`, migration 0015), inviting their feedback.
 * Payload: `request_payload(r)` plus `otherFirstName` (who marked it),
 * `recipientRole` (`mentee` or `mentor`) and `link`. The answers stay in the
 * app; the email asks for them and carries nothing else.
 */
export function renderFeedbackInvite(data: TemplateData, context: TemplateContext): RenderedEmail {
  const other = firstName(data.otherFirstName, "The other member");
  const noun = data.kind === "introduction" ? "introduction" : "mentorship";
  const side = data.recipientRole === "mentor" ? "mentor" : "me";

  return compose({
    subject: `${other} marked your ${noun} as completed`,
    heading: `${other} marked your ${noun} as completed`,
    paragraphs: [
      "Thank you for taking part.",
      `How did it go? Two short questions help MEST improve mentoring: how helpful it was, and anything you want to add. ${other} never sees your answers.`,
    ],
    button: "Share your feedback",
    link: data.link,
    fallbackPath: requestPath(side, data.requestId),
    footer: PREFERENCE_FOOTER,
    context,
  });
}
