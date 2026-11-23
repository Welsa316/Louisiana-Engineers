import type { Context, MiddlewareHandler } from "hono";
import { withSystem, withUser } from "../db/tx";
import { env, type Env } from "../env";
import { AppError } from "../http/errors";
import { findSessionUserId, readSessionCookie } from "./session";

/**
 * Request identity and the three guards from section 5.2. The session is
 * resolved once per request, lazily, by whichever guard or handler asks
 * first, so any area's sub-app can use the guards on its own (route tests
 * mount a single sub-app with `testApp`). Roles are never cached: member and
 * admin checks ask the SQL helpers, which the policies ask again inside the
 * request's own transaction.
 */

const resolved = new WeakMap<Request, Promise<string | null>>();
const settled = new WeakMap<Request, string | null>();

/** The signed-in user's id, or null for a visitor. Looks the session up once per request. */
export function sessionUserId(c: Context): Promise<string | null> {
  const key = c.req.raw;
  let pending = resolved.get(key);
  if (!pending) {
    const cookie = readSessionCookie(c);
    pending = cookie
      ? withSystem((db) => findSessionUserId(db, cookie)).then((id) => {
          settled.set(key, id);
          return id;
        })
      : Promise.resolve(null).then((id) => {
          settled.set(key, id);
          return id;
        });
    resolved.set(key, pending);
  }
  return pending;
}

/** The id `requireUser` (or a stronger guard) established. Throws when no guard ran. */
export function userIdOf(c: Context): string {
  const id = settled.get(c.req.raw);
  if (!id) throw new AppError(401, "unauthenticated", "userIdOf called without requireUser");
  return id;
}

/* ------------------------------------------------------------- origin */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Origins allowed to send non-GET requests: the app origin, plus the Vite
 * dev server (which proxies `/api` to this server) in development.
 */
export function allowedOrigins(appOrigin: string = env.APP_ORIGIN, nodeEnv: Env["NODE_ENV"] = env.NODE_ENV): Set<string> {
  const origins = new Set([new URL(appOrigin).origin]);
  if (nodeEnv === "development") {
    origins.add("http://127.0.0.1:5173");
    origins.add("http://localhost:5173");
  }
  return origins;
}

/** True for safe methods, and for others whose `Origin` header is an allowed origin. */
export function originAllowed(c: Context, origins: Set<string> = allowedOrigins()): boolean {
  if (SAFE_METHODS.has(c.req.method)) return true;
  const origin = c.req.header("origin");
  return origin !== undefined && origins.has(origin);
}

/** Every non-GET request must carry an `Origin` matching `APP_ORIGIN`; otherwise `403 { code: 'bad_origin' }`. */
export function originCheck(origins: Set<string> = allowedOrigins()): MiddlewareHandler {
  return async (c, next) => {
    if (!originAllowed(c, origins)) throw new AppError(403, "bad_origin", `origin refused for ${c.req.method} ${c.req.path}`);
    await next();
  };
}

/* ------------------------------------------------------------- guards */

async function signedIn(c: Context): Promise<string> {
  if (!originAllowed(c)) throw new AppError(403, "bad_origin", `origin refused for ${c.req.method} ${c.req.path}`);
  const id = await sessionUserId(c);
  if (!id) throw new AppError(401, "unauthenticated", "no session");
  return id;
}

/** `401 { code: 'unauthenticated' }` without a valid session. Also enforces the Origin rule on non-GET requests. */
export const requireUser: MiddlewareHandler = async (c, next) => {
  await signedIn(c);
  await next();
};

/** `requireUser`, then `403 { code: 'not_member' }` unless `is_member()` (verified, not suspended, not deleting). */
export const requireMember: MiddlewareHandler = async (c, next) => {
  const id = await signedIn(c);
  const { ok } = await withUser(id, (db) => db.one<{ ok: boolean }>("SELECT is_member() AS ok"));
  if (!ok) throw new AppError(403, "not_member", "signed in but not a member");
  await next();
};

/** `requireUser`, then `403 { code: 'not_admin' }` unless `is_admin()`. */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const id = await signedIn(c);
  const { ok } = await withUser(id, (db) => db.one<{ ok: boolean }>("SELECT is_admin() AS ok"));
  if (!ok) throw new AppError(403, "not_admin", "not an administrator");
  await next();
};
