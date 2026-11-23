import { createHash, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/tx";
import { env, type Env } from "../env";

/**
 * Sessions: the cookie carries 32 random bytes; the `sessions` row is keyed
 * by their sha256, so a database read never yields a usable cookie. Rows are
 * written and read inside `withSystem` by this module only (the pre-identity
 * exception in section 3 of the architecture doc).
 */

export const SESSION_COOKIE = "mest_session";
export const SESSION_DAYS = 30;
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

/** 32 random bytes as base64url without padding: 43 characters. */
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function isSecretShaped(value: string | undefined | null): value is string {
  return typeof value === "string" && SECRET_SHAPE.test(value);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface NewSession {
  /** The raw cookie value. */
  value: string;
  expiresAt: Date;
}

/** Creates a session row for `userId` and returns the cookie value for it. */
export async function createSession(db: Db, userId: string, userAgent: string | null): Promise<NewSession> {
  const value = newSecret();
  const row = await db.one<{ expires_at: Date }>(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4)
     RETURNING expires_at`,
    [sha256Hex(value), userId, SESSION_DAYS, userAgent ? userAgent.slice(0, 300) : null],
  );
  // Housekeeping: this account's expired sessions go with every new one.
  await db.query("DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()", [userId]);
  return { value, expiresAt: row.expires_at };
}

/** The user a cookie value belongs to, or null for an unknown, expired or deleted one. */
export async function findSessionUserId(db: Db, value: string | undefined | null): Promise<string | null> {
  if (!isSecretShaped(value)) return null;
  const row = await db.maybeOne<{ user_id: string }>(
    `SELECT s.user_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now() AND u.deleted_at IS NULL`,
    [sha256Hex(value)],
  );
  return row?.user_id ?? null;
}

export async function deleteSession(db: Db, value: string | undefined | null): Promise<void> {
  if (!isSecretShaped(value)) return;
  await db.query("DELETE FROM sessions WHERE id = $1", [sha256Hex(value)]);
}

/* ------------------------------------------------------------- cookie */

/**
 * `Secure` is set outside development. A test run served over plain http
 * (Playwright against http://127.0.0.1) is treated like development, since a
 * browser would drop a Secure cookie there; production always sets it.
 */
export function cookieIsSecure(nodeEnv: Env["NODE_ENV"] = env.NODE_ENV, appOrigin: string = env.APP_ORIGIN): boolean {
  if (nodeEnv === "production") return true;
  if (nodeEnv === "development") return false;
  return new URL(appOrigin).protocol === "https:";
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function setSessionCookie(c: Context, value: string, secure: boolean): void {
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(c: Context, secure: boolean): void {
  deleteCookie(c, SESSION_COOKIE, { httpOnly: true, secure, sameSite: "Lax", path: "/" });
}
