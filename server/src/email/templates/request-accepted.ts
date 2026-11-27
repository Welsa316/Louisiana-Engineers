import {
  PREFERENCE_FOOTER, compose, firstName, requestNoun, requestPath,
  type RenderedEmail, type TemplateContext, type TemplateData,
} from "./registry";

/**
 * To the mentee when the mentor accepts (`respond_to_request`). Payload:
 * `request_payload(r)` plus `link`. The contact details the mentor shared
 * are shown in the app only, never in the email.
 */
export function renderRequestAccepted(data: TemplateData, context: TemplateContext): RenderedEmail {
  const mentor = firstName(data.mentorFirstName, "Your mentor");
  const noun = requestNoun(data.kind);

  return compose({
    subject: `${mentor} accepted your ${noun}`,
    heading: `${mentor} accepted your ${noun}`,
    paragraphs: [
      `Good news: ${mentor} accepted your ${noun}.`,
      `Open the request in MEST Network to see how to reach ${mentor}. For your privacy, contact details are shown there and never in email.`,
    ],
    button: "Open the request",
    link: data.link,
    fallbackPath: requestPath("me", data.requestId),
    footer: PREFERENCE_FOOTER,
    context,
  });
}
