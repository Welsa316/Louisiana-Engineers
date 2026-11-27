import {
  PREFERENCE_FOOTER, compose, count, firstName, formatDay, requestNoun, requestPath,
  type RenderedEmail, type TemplateContext, type TemplateData,
} from "./registry";

/**
 * To the mentor while a request is still pending (`send_request_reminder`,
 * day 5 and day 10). Payload: `request_payload(r)` plus `daysLeft`,
 * `reminder` (1 or 2) and `link`.
 */
export function renderRequestReminder(data: TemplateData, context: TemplateContext): RenderedEmail {
  const mentee = firstName(data.menteeFirstName, "A member");
  const noun = requestNoun(data.kind);
  const daysLeft = count(data.daysLeft);
  const expires = formatDay(data.expiresOn);
  const when =
    daysLeft !== null ? `It expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}.` : expires ? `It expires on ${expires}.` : "";

  return compose({
    subject: `${mentee}'s ${noun} is waiting for your reply`,
    heading: `${mentee}'s ${noun} is waiting for your reply`,
    paragraphs: [
      `${mentee} is still waiting to hear back. ${when}`.trim(),
      `If you cannot take it on, declining lets ${mentee} ask someone else sooner.`,
    ],
    button: "Reply to the request",
    link: data.link,
    fallbackPath: requestPath("mentor", data.requestId),
    footer: PREFERENCE_FOOTER,
    context,
  });
}
