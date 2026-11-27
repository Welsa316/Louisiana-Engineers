import { reportReasonOptions } from "@shared/taxonomy";
import { PREFERENCE_FOOTER, compose, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/**
 * To every administrator when a member reports a profile (`report_profile`,
 * Task 24). Payload contract: `reason` (a `report_reason` id) and `link`.
 * Neither the reporter, the reported member nor the report's detail is in
 * the email; administrators read those in the reports queue.
 */
export function renderReportReceived(data: TemplateData, context: TemplateContext): RenderedEmail {
  const reason = reportReasonOptions.find((option) => option.id === data.reason)?.label;
  return compose({
    subject: "A profile was reported",
    heading: "A profile was reported",
    paragraphs: [
      reason ? `A member reported a profile. Reason: ${reason}.` : "A member reported a profile.",
      "Review the report in the reports queue.",
    ],
    button: "Open the reports",
    link: data.link,
    fallbackPath: "/network/admin/reports",
    footer: PREFERENCE_FOOTER,
    context,
  });
}
