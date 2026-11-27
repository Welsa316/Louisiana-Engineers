import {
  PREFERENCE_FOOTER, compose, firstName, formatDay, requestNoun, requestPath, text,
  type RenderedEmail, type TemplateContext, type TemplateData,
} from "./registry";

/**
 * To the mentor when a request arrives (`create_mentorship_request`).
 * Payload: `request_payload(r)` (requestId, kind, menteeFirstName,
 * mentorFirstName, topicLabel, createdOn, expiresOn) plus `link`. The
 * request's own words stay in the app.
 */
export function renderRequestReceived(data: TemplateData, context: TemplateContext): RenderedEmail {
  const mentee = firstName(data.menteeFirstName, "A member");
  const noun = requestNoun(data.kind);
  const topic = text(data.topicLabel).trim();
  const expires = formatDay(data.expiresOn);
  const about = data.kind === "introduction" || topic === "" ? "" : ` about ${topic}`;

  return compose({
    subject: `New ${noun} from ${mentee}`,
    heading: `New ${noun} from ${mentee}`,
    paragraphs: [
      `${mentee} sent you a ${noun}${about}.`,
      "Open it in MEST Network to read it and reply." +
        (expires ? ` If there is no reply, it expires on ${expires}.` : ""),
    ],
    button: "Open the request",
    link: data.link,
    fallbackPath: requestPath("mentor", data.requestId),
    footer: PREFERENCE_FOOTER,
    context,
  });
}
