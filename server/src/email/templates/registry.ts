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
 * The named templates live one per file and register in `all.ts`; anything
 * that renders mail imports `all.ts` once. Each named template reads only the
 * payload keys it documents and writes its own copy, so it never echoes the
 * in-app `title` or `body` or any key it was not written to use
 * (server/test/email/privacy.test.ts holds every template to that).
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

/** A payload value as a non-negative whole number, or null. */
export function count(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A `YYYY-MM-DD` payload date as "March 4, 2026"; anything else is empty. */
export function formatDay(value: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
  if (!match) return "";
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${MONTHS[month - 1]} ${day}, ${match[1]}`;
}

/** A first name from the payload, or the fallback when it is missing. */
export function firstName(value: unknown, fallback: string): string {
  return text(value).trim() || fallback;
}

/** "mentorship request" or "introduction request", as `request_noun` says it in SQL. */
export function requestNoun(kind: unknown): string {
  return kind === "introduction" ? "introduction request" : "mentorship request";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request page for one side, from the payload's `requestId`, or that side's list. */
export function requestPath(side: "me" | "mentor", requestId: unknown): string {
  const id = text(requestId);
  return UUID.test(id) ? `/network/${side}/requests/${id}` : `/network/${side}/requests`;
}

/** The mentor's page for one relationship (where the mentor's feedback form is). */
export function menteePath(requestId: unknown): string {
  const id = text(requestId);
  return UUID.test(id) ? `/network/mentor/mentees/${id}` : "/network/mentor/mentees";
}

/** True for an in-app path or an absolute link on the app origin (what appLink keeps). */
function isOnApp(raw: string, appOrigin: string): boolean {
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) return true;
  try {
    return new URL(raw).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

/** Footer for emails a member can turn off in Settings. */
export const PREFERENCE_FOOTER =
  "You receive this because you have a MEST Network account. You can choose which emails you get in Settings, under Notifications.";

/** Footer for account emails, which are always sent. */
export const ACCOUNT_FOOTER =
  "This is an account email from MEST Network. Account emails are always sent, whatever your notification settings.";

/**
 * Builds the text and html of one email from the same parts, so the two
 * never say different things. The link is made absolute on the app origin
 * (an outside link falls back to `fallbackPath`).
 */
export function compose(options: {
  subject: string;
  heading: string;
  paragraphs: string[];
  button: string;
  link: unknown;
  fallbackPath: string;
  footer: string;
  context: TemplateContext;
}): RenderedEmail {
  const raw = text(options.link);
  // An unusable link (missing, or off the app) goes to the template's own page.
  const href = appLink(isOnApp(raw, options.context.appOrigin) ? raw : options.fallbackPath, options.context.appOrigin);
  const paragraphs = options.paragraphs.filter((p) => p.trim() !== "");
  return {
    subject: options.subject,
    text: [options.heading, ...paragraphs, `${options.button}: ${href}`, options.footer].join("\n\n"),
    html: htmlLayout({
      heading: options.heading,
      paragraphs,
      button: { label: options.button, href },
      footer: options.footer,
    }),
  };
}

registerTemplate("default", renderDefault);
registerTemplate("magic-link", renderMagicLink);
