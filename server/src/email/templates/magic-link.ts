import { htmlLayout, text, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/**
 * The sign-in link. The payload is `{ link }`, the full callback URL with the
 * raw token; the outbox row's payload is emptied once the email is sent.
 */
export function renderMagicLink(data: TemplateData, _context: TemplateContext): RenderedEmail {
  const link = text(data.link);
  const subject = "Your sign-in link for MEST Network";
  const intro = "Use the link below to sign in to MEST Network. It works once and expires in 15 minutes.";
  const footer = "If you did not ask to sign in, you can ignore this email. Nobody can sign in without this link.";

  return {
    subject,
    text: [intro, link, footer].join("\n\n"),
    html: htmlLayout({
      heading: "Sign in to MEST Network",
      paragraphs: [intro],
      button: { label: "Sign in", href: link },
      footer,
    }),
  };
}
