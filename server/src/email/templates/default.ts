import { appLink, htmlLayout, text, type RenderedEmail, type TemplateContext, type TemplateData } from "./registry";

/**
 * Any notification without a template of its own: the in-app title as the
 * subject, the body, and a link back into the app. Uses only `title`, `body`
 * and `link`, which `create_notification` puts in every outbox payload.
 */
export function renderDefault(data: TemplateData, context: TemplateContext): RenderedEmail {
  const title = text(data.title).trim() || "You have a new notification";
  const body = text(data.body).trim();
  const href = appLink(data.link, context.appOrigin);
  const footer = "You receive this because you have a MEST Network account. You can choose which emails you get in Settings.";

  return {
    subject: title,
    text: [title, body, `Open MEST Network: ${href}`, footer].filter((line) => line !== "").join("\n\n"),
    html: htmlLayout({
      heading: title,
      paragraphs: [body],
      button: { label: "Open MEST Network", href },
      footer,
    }),
  };
}
