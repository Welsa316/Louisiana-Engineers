import { ACCOUNT_FOOTER, compose, firstName, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/**
 * To a member when an administrator restricts their account
 * (`admin_resolve_report`, Task 24). Payload contract: `firstName`, `action`
 * (`suspend_requests` or `hide_profile`) and `link`. Never says who reported
 * them or why.
 */
export function renderModerationAction(data: TemplateData, context: TemplateContext): RenderedEmail {
  const name = firstName(data.firstName, "there");
  const what =
    data.action === "suspend_requests"
      ? "An administrator paused mentorship requests on your account. For now you cannot send or accept requests."
      : data.action === "hide_profile"
        ? "An administrator hid your profile from the MEST Network directory."
        : "An administrator changed what your MEST Network account can do.";
  return compose({
    subject: "A change to your MEST Network account",
    heading: "A change to your MEST Network account",
    paragraphs: [`Hi ${name},`, what, "Sign in to MEST Network to see where your account stands."],
    button: "Open MEST Network",
    link: data.link,
    fallbackPath: "/network/me",
    footer: ACCOUNT_FOOTER,
    context,
  });
}
