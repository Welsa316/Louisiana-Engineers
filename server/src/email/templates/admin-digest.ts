import { PREFERENCE_FOOTER, compose, count, formatDay, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/**
 * The weekly summary to each administrator (`admin_digest()`, Task 21).
 * Payload contract: `queueSize` (profiles waiting for review), `openReports`,
 * `requestsWaiting` (pending mentorship requests), `oldestWaitingOn`
 * (`YYYY-MM-DD`, the oldest of those requests) or `oldestWaitingDays`, and
 * `link`. Counts only; no names.
 */
export function renderAdminDigest(data: TemplateData, context: TemplateContext): RenderedEmail {
  const queue = count(data.queueSize) ?? 0;
  const reports = count(data.openReports) ?? 0;
  const waiting = count(data.requestsWaiting) ?? 0;
  const oldestOn = formatDay(data.oldestWaitingOn);
  const oldestDays = count(data.oldestWaitingDays);
  const oldest =
    waiting === 0
      ? ""
      : oldestOn
        ? `The oldest has been waiting since ${oldestOn}.`
        : oldestDays !== null
          ? `The oldest has been waiting ${oldestDays} ${oldestDays === 1 ? "day" : "days"}.`
          : "";
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return compose({
    subject: "Your weekly MEST Network summary",
    heading: "This week in MEST Network",
    paragraphs: [
      `Profiles waiting for review: ${queue}.`,
      `Open reports: ${reports}.`,
      `Mentorship requests waiting for a reply: ${waiting}. ${oldest}`.trim(),
      queue + reports === 0 ? "Nothing needs an administrator right now." : `${plural(queue + reports, "item needs", "items need")} an administrator.`,
    ],
    button: "Open administration",
    link: data.link,
    fallbackPath: "/network/admin",
    footer: PREFERENCE_FOOTER,
    context,
  });
}
