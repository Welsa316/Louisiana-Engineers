import {
  PREFERENCE_FOOTER, compose, count, firstName, formatDay, requestPath, text,
  type RenderedEmail, type TemplateContext, type TemplateData,
} from "./registry";

/** "2:30 PM", as `meeting_payload` writes it; anything else is dropped. */
export function meetingTime(value: unknown): string {
  const raw = text(value).trim();
  return /^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/.test(raw) ? raw : "";
}

/** "online" or "in person"; anything else is dropped. */
export function meetingMode(value: unknown): string {
  return value === "online" ? "online" : value === "in-person" ? "in person" : "";
}

/** The request page for the recipient's side, from the payload link's side when it names one. */
export function meetingFallbackPath(data: TemplateData): string {
  const side = text(data.link).startsWith("/network/mentor/") ? "mentor" : "me";
  return requestPath(side, data.requestId);
}

/**
 * To the proposer when the other party chooses one of their times
 * (`choose_time`). Payload: `meeting_payload(m, proposer)`: `requestId`,
 * `meetingId`, `otherFirstName`, `startsOn` (YYYY-MM-DD), `startsAtTime`
 * ("2:30 PM", Louisiana time), `durationMin`, `mode` and `link`. The place
 * and the agenda are the pair's own words and stay in the app.
 */
export function renderMeetingScheduled(data: TemplateData, context: TemplateContext): RenderedEmail {
  const other = firstName(data.otherFirstName, "The other member");
  const day = formatDay(data.startsOn);
  const time = meetingTime(data.startsAtTime);
  const minutes = count(data.durationMin);
  const mode = meetingMode(data.mode);

  const when = day ? `You meet on ${day}${time ? ` at ${time} (Louisiana time)` : ""}` : "";
  const details = [minutes ? `for ${minutes} minutes` : "", mode].filter(Boolean).join(", ");

  return compose({
    subject: `${other} chose a time to meet`,
    heading: `${other} chose a time to meet`,
    paragraphs: [
      `${other} chose one of the times you proposed.`,
      when ? `${when}${details ? `, ${details}` : ""}.` : "",
      "Open the mentorship in MEST Network for the place and agenda, or to cancel if your plans change.",
    ],
    button: "Open the mentorship",
    link: data.link,
    fallbackPath: meetingFallbackPath(data),
    footer: PREFERENCE_FOOTER,
    context,
  });
}
