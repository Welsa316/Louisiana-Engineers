import {
  PREFERENCE_FOOTER, compose, firstName, formatDay, requestNoun, requestPath,
  type RenderedEmail, type TemplateContext, type TemplateData,
} from "./registry";

/**
 * To the mentee when a request runs out without a reply (`expire_request`).
 * Payload: `request_payload(r)` plus `link`.
 */
export function renderRequestExpired(data: TemplateData, context: TemplateContext): RenderedEmail {
  const mentor = firstName(data.mentorFirstName, "the mentor");
  const noun = requestNoun(data.kind);
  const expires = formatDay(data.expiresOn);

  return compose({
    subject: `Your ${noun} to ${mentor} expired`,
    heading: `Your ${noun} to ${mentor} expired`,
    paragraphs: [
      `There was no reply${expires ? ` by ${expires}` : " in time"}, so your ${noun} expired.`,
      "Mentors are volunteers and sometimes miss a request. You can ask someone else who offers the same topic.",
    ],
    button: "Open the request",
    link: data.link,
    fallbackPath: requestPath("me", data.requestId),
    footer: PREFERENCE_FOOTER,
    context,
  });
}
