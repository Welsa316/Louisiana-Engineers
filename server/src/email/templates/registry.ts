import { env } from "../../env";
import { renderDefault } from "./default";
import { renderMagicLink } from "./magic-link";

/**
 * Email templates by name. An outbox row stores a template name and its
 * payload; the sender renders it here at send time. Notification callers
 * name their template (`request-received`, `profile-approved`, ...) before it
 * exists: an unregistered name renders through `default`, which uses the
 * `title`, `body` and `link` every notification payload carries.
 *
 * A template receives only its payload. It must never be handed `why`,
 * `goals`, `scheduling_note`, `mentor_note`, an email address or a phone
 * number (the SQL functions strip those keys before a payload is stored).
 */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export type TemplateData = Record<string, unknown>;

export interface TemplateContext {
  /** Where the app is served from, for absolute links. */
  appOrigin: string;
}

export type TemplateRender = (data: TemplateData, context: TemplateContext) => RenderedEmail;

const templates = new Map<string, TemplateRender>();

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function registerTemplate(name: string, render: TemplateRender): void {
  if (!NAME.test(name)) throw new Error(`invalid template name: ${name}`);
  templates.set(name, render);
}

export function hasTemplate(name: string): boolean {
  return templates.has(name);
}

export function renderTemplate(name: string, data: TemplateData, context?: Partial<TemplateContext>): RenderedEmail {
  const render = templates.get(name) ?? templates.get("default");
  if (!render) throw new Error("the default template is not registered");
  return render(data, { appOrigin: context?.appOrigin ?? env.APP_ORIGIN });
}

/* ------------------------------------------------------------ helpers */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A payload value as display text; anything that is not a string or number is empty. */
export function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * An in-app path made absolute against the app origin. Only paths on the
 * app itself and absolute links to the app origin are allowed; anything
 * else becomes the network home, so a payload cannot point mail elsewhere.
 */
export function appLink(link: unknown, appOrigin: string): string {
  const origin = new URL(appOrigin).origin;
  const raw = text(link);
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) return `${origin}${raw}`;
  try {
    const url = new URL(raw);
    if (url.origin === origin) return url.toString();
  } catch {
    // not an absolute URL
  }
  return `${origin}/network`;
}

/** The shared HTML shell: one column, one button, no images or tracking. */
export function htmlLayout(options: { heading: string; paragraphs: string[]; button?: { label: string; href: string }; footer: string }): string {
  const paragraphs = options.paragraphs
    .filter((p) => p.trim() !== "")
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1f1a2e;">${escapeHtml(p)}</p>`)
    .join("");
  const button = options.button
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(options.button.href)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#3b2470;color:#ffffff;font-weight:600;text-decoration:none;">${escapeHtml(options.button.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5a5470;word-break:break-all;">${escapeHtml(options.button.href)}</p>`
    : "";
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(options.heading)}</title></head>` +
    `<body style="margin:0;padding:24px;background:#f6f4fa;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">` +
    `<div style="max-width:560px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px;">` +
    `<p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#5a5470;">MEST Network</p>` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1f1a2e;">${escapeHtml(options.heading)}</h1>` +
    paragraphs +
    button +
    `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#5a5470;">${escapeHtml(options.footer)}</p>` +
    `</div></body></html>`
  );
}

registerTemplate("default", renderDefault);
registerTemplate("magic-link", renderMagicLink);
