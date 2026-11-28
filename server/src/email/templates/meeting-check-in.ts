import { meetingFallbackPath } from "./meeting-scheduled";
import {
  PREFERENCE_FOOTER, compose, firstName, formatDay,
  type RenderedEmail, type TemplateContext, type TemplateData,
} from "./registry";

/**
 * To both parties a day after a meeting's start (`meeting_prompt`), unless
 * someone already answered or it was canceled. Payload:
 * `meeting_payload(m, recipient)`: `requestId`, `meetingId`,
 * `otherFirstName`, `startsOn` (YYYY-MM-DD) and `link`; the time, length and
 * mode are there too but this email does not need them.
 */
export function renderMeetingCheckIn(data: TemplateData, context: TemplateContext): RenderedEmail {
  const other = firstName(data.otherFirstName, "the other member");
  const day = formatDay(data.startsOn);

  return compose({
    subject: `Did you meet ${other}?`,
    heading: `Did you meet ${other}?`,
    paragraphs: [
      day ? `You had a meeting with ${other} planned for ${day}.` : `You had a meeting with ${other} planned.`,
      "Tell us whether it happened: it takes one tap, and it helps MEST see how mentorships are going.",
    ],
    button: "Answer in MEST Network",
    link: data.link,
    fallbackPath: meetingFallbackPath(data),
    footer: PREFERENCE_FOOTER,
    context,
  });
}
