import { timingSafeEqual } from "node:crypto";
import { decodeIdToken, generateCodeVerifier, generateState, Google } from "arctic";
import { z } from "zod";
import { withSystem, type Db } from "../db/tx";
import { startSession, type SignIn, type SignInContext } from "./magic-link";

/**
 * Google sign-in (section 5.1) through `arctic`. `beginGoogleSignIn` makes
 * the state and PKCE verifier the browser keeps in a short cookie;
 * `completeGoogleSignIn` checks the state, exchanges the code, requires a
 * verified address and signs the person in with the magic-link callback's
 * session logic. Account writes run inside `withSystem`: no `app.user_id`
 * exists yet, which is the auth module's documented exception.
 */

export interface GoogleConfig {
  clientId?: string;
  clientSecret?: string;
}

/** The cookie that carries `state.verifier` between the redirect and the callback. */
export const GOOGLE_STATE_COOKIE = "mest_google_oauth";
export const GOOGLE_STATE_MINUTES = 10;
/** Only the address and the stable subject are needed; no name or picture is read. */
const SCOPES = ["openid", "email"];
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export function googleRedirectUri(appOrigin: string): string {
  return new URL("/api/auth/google/callback", appOrigin).toString();
}

/** Google is available only when both client values are configured. */
export function googleClient(config: GoogleConfig | null | undefined, appOrigin: string): Google | null {
  if (!config?.clientId || !config.clientSecret) return null;
  return new Google(config.clientId, config.clientSecret, googleRedirectUri(appOrigin));
}

export interface GoogleStart {
  url: URL;
  /** The value for `GOOGLE_STATE_COOKIE`. */
  cookie: string;
}

export function beginGoogleSignIn(google: Google): GoogleStart {
  const state = generateState();
  const verifier = generateCodeVerifier();
  return { url: google.createAuthorizationURL(state, verifier, SCOPES), cookie: `${state}.${verifier}` };
}

export interface GoogleCallback {
  code: string | undefined;
  state: string | undefined;
  /** The `GOOGLE_STATE_COOKIE` value the browser sent back. */
  cookie: string | undefined;
}

/**
 * The claims this module relies on. The ID token arrives straight from
 * Google's token endpoint over TLS in exchange for our code and client
 * secret, so its signature is not re-checked (OpenID Connect Core 3.1.3.7);
 * the issuer, audience and expiry still are, so a token minted for another
 * client is refused.
 */
const claimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  sub: z.string().min(1).max(255),
  email: z.string().email().max(254),
  email_verified: z.literal(true),
});

/**
 * Returns the sign-in, or null when anything fails: a state that does not
 * match the cookie, a missing code, a refused exchange, a token for another
 * client, or an address Google has not verified.
 */
export async function completeGoogleSignIn(
  google: Google,
  clientId: string,
  callback: GoogleCallback,
  context: SignInContext = {},
): Promise<SignIn | null> {
  const stored = parseStateCookie(callback.cookie);
  if (!stored || !callback.code || !callback.state || !sameSecret(stored.state, callback.state)) return null;

  let idToken: string;
  try {
    const tokens = await google.validateAuthorizationCode(callback.code, stored.verifier);
    idToken = tokens.idToken();
  } catch {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = decodeIdToken(idToken);
  } catch {
    return null;
  }
  const parsed = claimsSchema.safeParse(decoded);
  if (!parsed.success) return null;
  const claims = parsed.data;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!ISSUERS.has(claims.iss) || !audiences.includes(clientId) || claims.exp * 1000 <= Date.now()) return null;

  return withSystem(async (db) => {
    const userId = await linkGoogleAccount(db, claims.sub, claims.email);
    if (!userId) return null;
    return startSession(db, userId, context);
  });
}

/**
 * The account for a Google subject: the live row already linked to it, else
 * the row with that verified address if it has no Google link yet (which is
 * then linked), else a new row. A row already linked to a different subject
 * is never re-linked: an address can move between Google accounts, so that
 * would hand the account to whoever holds the address now; the sign-in fails
 * instead (null). A deleted account's tombstone gives up the subject rather
 * than being signed back in. The address on a linked row is left alone when
 * the Google address changes; the subject is the stable identity.
 */
async function linkGoogleAccount(db: Db, sub: string, email: string): Promise<string | null> {
  // Serialize sign-ins for one subject so two concurrent callbacks cannot both create a row.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('google:' || $1, 0))", [sub]);

  const linked = await db.maybeOne<{ id: string }>(
    `UPDATE users
        SET last_sign_in_at = now(),
            email_verified_at = coalesce(email_verified_at, now())
      WHERE google_sub = $1 AND deleted_at IS NULL
      RETURNING id`,
    [sub],
  );
  if (linked) return linked.id;

  await db.query("UPDATE users SET google_sub = NULL WHERE google_sub = $1 AND deleted_at IS NOT NULL", [sub]);
  const user = await db.maybeOne<{ id: string }>(
    `INSERT INTO users (email, email_verified_at, google_sub, last_sign_in_at)
     VALUES ($1, now(), $2, now())
     ON CONFLICT (email) DO UPDATE
        SET google_sub = EXCLUDED.google_sub,
            last_sign_in_at = now(),
            email_verified_at = coalesce(users.email_verified_at, now())
      WHERE users.google_sub IS NULL
     RETURNING id`,
    [email, sub],
  );
  return user?.id ?? null;
}

/** arctic's state and verifier are base64url, so a dot separates them unambiguously. */
const STATE_COOKIE_SHAPE = /^([A-Za-z0-9_-]{20,128})\.([A-Za-z0-9_-]{43,128})$/;

function parseStateCookie(value: string | undefined): { state: string; verifier: string } | null {
  const match = value ? STATE_COOKIE_SHAPE.exec(value) : null;
  return match ? { state: match[1], verifier: match[2] } : null;
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
