import { declineReasonOptions } from "@shared/taxonomy";
import {
  PREFERENCE_FOOTER, compose, firstName, requestNoun, requestPath,
  type RenderedEmail, type TemplateContext, type TemplateData,
} from "./registry";

/**
 * To the mentee when the mentor declines (`respond_to_request`) or leaves
 * (account deletion declines with `member_left`). Payload:
 * `request_payload(r)` plus `reason` (a decline reason id) and `link`. The
 * mentor's note is never part of it.
 */
export function renderRequestDeclined(data: TemplateData, context: TemplateContext): RenderedEmail {
  const mentor = firstName(data.mentorFirstName, "The mentor");
  const noun = requestNoun(data.kind);
  const left = data.reason === "member_left";
  // "Other" says nothing useful on its own, so only the specific reasons are named.
  const reason = declineReasonOptions.find((option) => option.id === data.reason && option.id !== "other")?.label;

  return compose({
    subject: left ? `Your ${noun} to ${mentor} was closed` : `${mentor} declined your ${noun}`,
    heading: left ? `Your ${noun} to ${mentor} was closed` : `${mentor} declined your ${noun}`,
    paragraphs: [
      left ? `${mentor} left MEST Network, so your ${noun} was closed.` : `${mentor} is not able to take on your ${noun}.`,
      reason ? `Reason given: ${reason}.` : "",
      "Mentors decline for many reasons. You can send a request to someone else in the directory.",
    ],
    button: "Open the request",
    link: data.link,
    fallbackPath: requestPath("me", data.requestId),
    footer: PREFERENCE_FOOTER,
    context,
  });
}
