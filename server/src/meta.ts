import { withUser } from "./db/tx";
import { env } from "./env";
import { safeErrorSummary } from "./http/errors";
import { UUID_PATTERN } from "./services/directory";

/**
 * Server-injected document metadata (A6, 02 section 6). `index.html` carries
 * a `<!--meta-->` placeholder right after its `<title>`. A public, approved
 * directory profile at `/network/directory/:id` gets its own title,
 * description, canonical link and Open Graph tags, replacing the landing
 * page's; every other network page, and any profile that is members-only,
 * hidden, pending or unknown, keeps the default tags with `robots: noindex`.
 * The landing page at `/` keeps its tags and stays indexable.
 *
 * The profile is read as a visitor (`withUser(null)`), so the row policies
 * guarantee nothing a visitor could not see reaches a crawler.
 */

export const META_PLACEHOLDER = "<!--meta-->";

const APP_NAME = "MEST Network";
const DESCRIPTION_CHARS = 150;
const NOINDEX = '<meta name="robots" content="noindex" />';

/** The landing page's tags a profile page replaces (og:image:* describe the same image and stay). */
const REPLACED_TAGS = /[ \t]*<meta\s+(?:name|property)="(?:description|og:type|og:title|og:description|og:url|og:image)"[^>]*>[ \t]*\r?\n?/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Puts `tags` where the placeholder is (before `</head>` if a build lost it). */
function insert(html: string, tags: string): string {
  if (html.includes(META_PLACEHOLDER)) return html.replace(META_PLACEHOLDER, () => tags);
  return html.replace("</head>", () => `${tags}\n  </head>`);
}

/** `/`: the landing page as built, indexable, without the placeholder. */
export function landingHtml(indexHtml: string): string {
  return indexHtml.replace(META_PLACEHOLDER, "");
}

/** Every `/network/*` page except a public profile: the default tags, noindex. */
export function noindexHtml(indexHtml: string): string {
  return insert(indexHtml, NOINDEX);
}

export interface PublicProfileMeta {
  id: string;
  firstName: string;
  lastName: string;
  title: string;
  bio: string | null;
}

/** The first 150 characters of the bio on one line. */
export function describe(bio: string | null): string {
  const flat = (bio ?? "").replace(/\s+/g, " ").trim();
  return Array.from(flat).slice(0, DESCRIPTION_CHARS).join("").trimEnd();
}

/** The index page with a public profile's tags in place of the landing page's. */
export function profileHtml(indexHtml: string, profile: PublicProfileMeta, origin: string): string {
  const base = new URL(origin).origin;
  const title = escapeHtml(`${profile.firstName} ${profile.lastName}, ${profile.title} · ${APP_NAME}`);
  const description = escapeHtml(describe(profile.bio));
  const url = escapeHtml(`${base}/network/directory/${profile.id}`);
  const tags = [
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="profile" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${escapeHtml(`${base}/og.jpg`)}" />`,
  ].join("\n    ");
  const withoutDefaults = indexHtml
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`)
    .replace(REPLACED_TAGS, "");
  return insert(withoutDefaults, tags);
}

/** The profile's public fields when a visitor may see it, otherwise null. */
export async function findPublicProfile(profileId: string): Promise<PublicProfileMeta | null> {
  if (!UUID_PATTERN.test(profileId)) return null;
  const row = await withUser(null, (db) =>
    db.maybeOne<{ id: string; first_name: string; last_name: string; title: string; bio: string | null }>(
      `SELECT e.id, e.first_name, e.last_name, e.title, e.bio
         FROM directory_entries e
        WHERE e.id = $1 AND e.visibility = 'public'`,
      [profileId],
    ),
  );
  return row ? { id: row.id, firstName: row.first_name, lastName: row.last_name, title: row.title, bio: row.bio } : null;
}

/**
 * `index.html` for `/network/directory/:id`: indexable with the profile's
 * tags when it is a public, approved directory entry; the default tags with
 * `noindex` otherwise, including when the lookup fails.
 */
export async function renderMeta(profileId: string, indexHtml: string, origin: string = env.APP_ORIGIN): Promise<string> {
  let profile: PublicProfileMeta | null = null;
  try {
    profile = await findPublicProfile(profileId);
  } catch (error) {
    console.error("[meta] profile lookup failed", safeErrorSummary(error));
  }
  return profile ? profileHtml(indexHtml, profile, origin) : noindexHtml(indexHtml);
}
