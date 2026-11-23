import { Hono, type Context } from "hono";
import { devLoginSchema, magicLinkSchema } from "@shared/schemas/auth";
import {
  SIGN_IN_FAILED_PATH,
  type DevLastLinkResponse,
  type DevLoginResponse,
  type MeResponse,
  type SessionUser,
} from "@shared/types/auth";
import type { ApprovalState, ProfileKind } from "@shared/types/common";
import { consumeMagicLink, devLinks, devSignIn, endSession, requestMagicLink, type SignIn } from "../auth/magic-link";
import { allowedOrigins, originAllowed, originCheck, sessionUserId } from "../auth/middleware";
import { clearSessionCookie, cookieIsSecure, isSecretShaped, readSessionCookie, setSessionCookie } from "../auth/session";
import { withUser } from "../db/tx";
import { env, type Env } from "../env";
import { AppError } from "../http/errors";
import { validate } from "../http/validate";

/**
 * `/api/auth/*`: magic-link sign-in, sign-out and the current session
 * (section 5.1). Mounted by the aggregator at `/auth`.
 */

export interface AuthRouteOptions {
  nodeEnv?: Env["NODE_ENV"];
  /** Read the client IP from `X-Forwarded-For` (only behind a trusted proxy). */
  trustProxy?: boolean;
  appOrigin?: string;
}

export function createAuthRoutes(options: AuthRouteOptions = {}): Hono {
  const nodeEnv = options.nodeEnv ?? env.NODE_ENV;
  const trustProxy = options.trustProxy ?? env.TRUST_PROXY;
  const appOrigin = options.appOrigin ?? env.APP_ORIGIN;
  const secure = cookieIsSecure(nodeEnv, appOrigin);
  const origins = allowedOrigins(appOrigin, nodeEnv);
  const testMode = nodeEnv === "test";

  const signedInResponse = (c: Context, signIn: SignIn) => {
    setSessionCookie(c, signIn.session.value, secure);
    return c.redirect(signIn.redirect, 303);
  };

  const app = new Hono();

  app.post("/magic-link", originCheck(origins), validate(magicLinkSchema), async (c) => {
    const { email } = c.req.valid("json");
    const result = await requestMagicLink({ email, ip: clientIp(c, trustProxy), appOrigin });
    if (!result.ok) throw new AppError(429, "rate_limited", "magic link rate limit");
    if (testMode) devLinks.set(email.toLowerCase(), result.link);
    return c.json({}, 202);
  });

  // Opening the link only shows a form; mail scanners that prefetch it use nothing up.
  app.get("/callback", (c) => {
    const token = c.req.query("token");
    if (!isSecretShaped(token)) return c.redirect(SIGN_IN_FAILED_PATH, 302);
    return c.html(continuePage(token), 200, {
      "Cache-Control": "no-store",
      // Same-origin keeps the token out of any Referer while leaving the
      // form's Origin header intact (no-referrer would send Origin: null).
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Robots-Tag": "noindex",
    });
  });

  app.post("/callback", async (c) => {
    // A form navigation: every failure lands on the sign-in screen, never JSON.
    if (!originAllowed(c, origins)) return c.redirect(SIGN_IN_FAILED_PATH, 303);
    const token = await readToken(c);
    const signIn = token
      ? await consumeMagicLink(token, { previousCookie: readSessionCookie(c), userAgent: c.req.header("user-agent") })
      : null;
    if (!signIn) return c.redirect(SIGN_IN_FAILED_PATH, 303);
    return signedInResponse(c, signIn);
  });

  app.post("/signout", originCheck(origins), async (c) => {
    await endSession(readSessionCookie(c));
    clearSessionCookie(c, secure);
    return c.json({});
  });

  app.get("/me", async (c) => {
    c.header("Cache-Control", "no-store");
    const id = await sessionUserId(c);
    const user = id ? await loadSessionUser(id) : null;
    return c.json<MeResponse>({ user });
  });

  if (testMode) {
    // Test-only shortcuts for end-to-end specs. Never registered outside NODE_ENV=test.
    app.post("/dev-login", validate(devLoginSchema), async (c) => {
      const { email } = c.req.valid("json");
      const signIn = await devSignIn(email, {
        previousCookie: readSessionCookie(c),
        userAgent: c.req.header("user-agent"),
      });
      setSessionCookie(c, signIn.session.value, secure);
      return c.json<DevLoginResponse>({ userId: signIn.userId, redirect: signIn.redirect });
    });

    app.get("/dev-last-link", (c) => {
      const email = (c.req.query("email") ?? "").trim().toLowerCase();
      const link = devLinks.get(email);
      if (!link) throw new AppError(404, "not_found", "no link for that address");
      return c.json<DevLastLinkResponse>({ link });
    });
  }

  return app;
}

/** The auth area as the API mounts it, configured from the environment. */
export const authRoutes = createAuthRoutes();

/* ------------------------------------------------------------ helpers */

async function loadSessionUser(id: string): Promise<SessionUser | null> {
  // Runs as the user: the owner policies on profiles and account_deletions apply.
  const row = await withUser(id, (db) =>
    db.maybeOne<{ kind: ProfileKind | null; approval_state: ApprovalState; is_admin: boolean; deleting: boolean }>(
      `SELECT p.kind,
              p.approval_state,
              is_admin() AS is_admin,
              EXISTS (
                SELECT 1 FROM account_deletions d
                 WHERE d.profile_id = p.id AND d.canceled_at IS NULL AND d.executed_at IS NULL
              ) AS deleting
         FROM profiles p
        WHERE p.id = app_uid()`,
    ),
  );
  if (!row) return null;
  return {
    id,
    kind: row.kind,
    approvalState: row.approval_state,
    isAdmin: row.is_admin,
    mentorStatus: null,
    hasDeletionScheduled: row.deleting,
  };
}

/** The token from the continue form (urlencoded), or from a JSON body. */
async function readToken(c: Context): Promise<string | null> {
  const type = c.req.header("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await c.req.json()) as { token?: unknown };
      return typeof body.token === "string" ? body.token : null;
    }
    const body = await c.req.parseBody();
    return typeof body.token === "string" ? body.token : null;
  } catch {
    return null;
  }
}

/**
 * The client address for the per-IP limit. Behind a trusted proxy it is the
 * first `X-Forwarded-For` entry; otherwise the socket's peer address (absent
 * when the app is called in-process, as in tests).
 */
export function clientIp(c: Context, trustProxy: boolean): string | null {
  if (trustProxy) {
    const first = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (first && isIp(first)) return first;
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  const address = incoming?.socket?.remoteAddress;
  return address && isIp(address) ? address.replace(/^::ffff:/, "") : null;
}

function isIp(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || (/^[0-9a-fA-F:.]+$/.test(value) && value.includes(":"));
}

function continuePage(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Continue to MEST Network</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f4fa; --card: #ffffff; --ink: #1f1a2e; --muted: #5a5470; --accent: #3b2470; --on-accent: #ffffff; --focus: #3b2470; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0e0b16; --card: #1a1526; --ink: #f2eff8; --muted: #b9b2cc; --accent: #c9b6ff; --on-accent: #1a1030; --focus: #c9b6ff; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: 100%; max-width: 440px; padding: 32px; border-radius: 12px; background: var(--card); }
  .brand { margin: 0 0 24px; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.25; letter-spacing: -0.01em; }
  p { margin: 0 0 24px; color: var(--muted); }
  button { width: 100%; min-height: 48px; padding: 12px 20px; border: 0; border-radius: 8px; background: var(--accent); color: var(--on-accent); font: inherit; font-weight: 600; cursor: pointer; }
  button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
</style>
</head>
<body>
<main>
<p class="brand">MEST Network</p>
<h1>Finish signing in</h1>
<p>Select the button to sign in. This link works once.</p>
<form method="post" action="/api/auth/callback">
<input type="hidden" name="token" value="${token}">
<button type="submit">Continue to MEST Network</button>
</form>
</main>
</body>
</html>`;
}
