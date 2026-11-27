import { PREFERENCE_FOOTER, compose, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/**
 * To the member who filed a report once it is closed (`admin_resolve_report`,
 * Task 24). Payload contract: `status` (`resolved` or `dismissed`) and
 * `link`. Status only: never the administrator's note or the action taken.
 */
export function renderReportStatus(data: TemplateData, context: TemplateContext): RenderedEmail {
  const outcome =
    data.status === "resolved"
      ? "An administrator reviewed the profile you reported and resolved the report."
      : data.status === "dismissed"
        ? "An administrator reviewed the profile you reported and closed the report without action."
        : "An administrator reviewed the profile you reported.";
  return compose({
    subject: "Your report was reviewed",
    heading: "Your report was reviewed",
    paragraphs: [outcome, "Thank you for helping keep MEST Network a good place to learn from each other."],
    button: "Open MEST Network",
    link: data.link,
    fallbackPath: "/network/notifications",
    footer: PREFERENCE_FOOTER,
    context,
  });
}
