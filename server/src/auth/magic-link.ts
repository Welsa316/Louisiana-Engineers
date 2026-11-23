import type { SignInRedirect } from "@shared/types/auth";
import { withSystem, type Db } from "../db/tx";
import { createSession, deleteSession, isSecretShaped, newSecret, sha256Hex, type NewSession } from "./session";

/**
 * Magic-link sign-in (section 5.1). `requestMagicLink` stores the sha256 of
 * a fresh token and queues the email; `consumeMagicLink` uses the token once
 * and signs the person in. Everything here runs inside `withSystem`: no
 * `app.user_id` exists yet, which is the auth module's documented exception.
 */

export const MAGIC_LINK_TTL_MINUTES = 15;

export interface MagicLinkRequest {
  email: string;
  /** The client address for the per-IP limit; null when unknown. */
  ip: string | null;
  /** The app origin the link points at. */
  appOrigin: string;
}

export type MagicLinkResult = { ok: true; link: string } | { ok: false; reason: "rate_limited" };

export function callbackLink(appOrigin: string, token: string): string {
  const url = new URL("/api/auth/callback", appOrigin);
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Checks the hourly limits (per address and per IP, `config.magic_links_per_hour`),
 * then stores the token hash and queues the `magic-link` email. The link is
 * returned so test mode can keep it; callers must never send it to the client.
 */
export async function requestMagicLink(input: MagicLinkRequest): Promise<MagicLinkResult> {
  return withSystem(async (db) => {
    // Serialize requests for one address so concurrent sends cannot both
    // slip under the limit.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('magic-link:' || lower($1), 0))", [input.email]);

    const { limit } = await db.one<{ limit: number }>(
      "SELECT (value #>> '{}')::int AS limit FROM config WHERE key = 'magic_links_per_hour'",
    );
    const counts = await db.one<{ by_email: number; by_ip: number }>(
      `SELECT count(*) FILTER (WHERE email = $1)::int AS by_email,
              count(*) FILTER (WHERE $2::inet IS NOT NULL AND ip = $2::inet)::int AS by_ip
         FROM auth_tokens
        WHERE purpose = 'magic-link'
          AND created_at > now() - interval '1 hour'
          AND (email = $1 OR ($2::inet IS NOT NULL AND ip = $2::inet))`,
      [input.email, input.ip],
    );
    if (counts.by_email >= limit || counts.by_ip >= limit) return { ok: false, reason: "rate_limited" } as const;

    const token = newSecret();
    await db.query(
      `INSERT INTO auth_tokens (email, token_hash, purpose, expires_at, ip)
       VALUES ($1, $2, 'magic-link', now() + make_interval(mins => $3), $4::inet)`,
      [input.email, sha256Hex(token), MAGIC_LINK_TTL_MINUTES, input.ip],
    );
    const link = callbackLink(input.appOrigin, token);
    await db.query("SELECT enqueue_email($1, 'magic-link', $2::jsonb)", [input.email, JSON.stringify({ link })]);
    return { ok: true, link } as const;
  });
}

export interface SignIn {
  userId: string;
  session: NewSession;
  redirect: SignInRedirect;
}

export interface SignInContext {
  /** The cookie the browser already had; its session is replaced (rotation). */
  previousCookie?: string | null;
  userAgent?: string | null;
}

/**
 * Uses a magic-link token once and signs its address in. Returns null for an
 * unknown, used, expired or malformed token. The UPDATE is the single-use
 * guard: of two concurrent submits, only one gets the row back.
 */
export async function consumeMagicLink(token: string, context: SignInContext = {}): Promise<SignIn | null> {
  if (!isSecretShaped(token)) return null;
  return withSystem(async (db) => {
    const row = await db.maybeOne<{ email: string }>(
      `UPDATE auth_tokens
          SET used_at = now()
        WHERE token_hash = $1
          AND purpose = 'magic-link'
          AND used_at IS NULL
          AND expires_at > now()
        RETURNING email::text AS email`,
      [sha256Hex(token)],
    );
    if (!row) return null;
    return signInEmail(db, row.email, context);
  });
}

/**
 * Finds or creates the account for a verified address and starts a session.
 * Shared by the magic-link callback, test-mode `dev-login` and Google
 * sign-in (Task 6). A new address gets a `users` row with
 * `email_verified_at` set and a `profiles` row with `kind` null.
 */
export async function signInEmail(db: Db, email: string, context: SignInContext = {}): Promise<SignIn> {
  const user = await db.one<{ id: string }>(
    `INSERT INTO users (email, email_verified_at, last_sign_in_at)
     VALUES ($1, now(), now())
     ON CONFLICT (email) DO UPDATE
        SET last_sign_in_at = now(),
            email_verified_at = coalesce(users.email_verified_at, now())
     RETURNING id`,
    [email],
  );
  return startSession(db, user.id, context);
}

/** Replaces the browser's previous session (if any) with a new one and picks the landing page. */
export async function startSession(db: Db, userId: string, context: SignInContext = {}): Promise<SignIn> {
  await db.query("INSERT INTO profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [userId]);
  await deleteSession(db, context.previousCookie);
  const session = await createSession(db, userId, context.userAgent ?? null);
  return { userId, session, redirect: await landingPath(db, userId) };
}

/**
 * Where a signed-in person goes: the grace screen while a deletion is open
 * (before anything else, so a leaving member is never sent into onboarding),
 * onboarding while `kind` is null, otherwise their home.
 */
export async function landingPath(db: Db, userId: string): Promise<SignInRedirect> {
  const row = await db.one<{ kind: string | null; deleting: boolean }>(
    `SELECT p.kind,
            EXISTS (
              SELECT 1 FROM account_deletions d
               WHERE d.profile_id = p.id AND d.canceled_at IS NULL AND d.executed_at IS NULL
            ) AS deleting
       FROM profiles p
      WHERE p.id = $1`,
    [userId],
  );
  if (row.deleting) return "/network/scheduled-for-deletion";
  if (row.kind === null) return "/network/onboarding";
  return "/network/me";
}

/** Test mode only: signs an address in directly, as if its link had been used. */
export function devSignIn(email: string, context: SignInContext = {}): Promise<SignIn> {
  return withSystem((db) => signInEmail(db, email, context));
}

/** Ends the session a cookie belongs to. */
export function endSession(cookie: string | null | undefined): Promise<void> {
  return withSystem((db) => deleteSession(db, cookie));
}

/**
 * Test mode keeps the last raw link per address in memory, because the
 * database stores only hashes. Read through `GET /api/auth/dev-last-link`.
 */
export const devLinks = new Map<string, string>();
