import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import pg from "pg";
import { ZodError } from "zod";

/**
 * An error the API answers with `status` and `{ code, ...extra }`. The
 * message is for logs and is never sent, so it may name ids or detail the
 * client should not see.
 */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly extra?: Record<string, unknown>;

  constructor(status: ContentfulStatusCode, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Domain errors raised by SQL functions as `RAISE EXCEPTION 'mest.<code>'`.
 * Returns the code, or null for any other error.
 */
export function domainErrorCode(error: unknown): string | null {
  if (!(error instanceof pg.DatabaseError)) return null;
  const match = /^mest\.([a-z][a-z0-9_]*)/.exec(error.message);
  return match ? match[1] : null;
}

const HTTP_CODES: Partial<Record<number, string>> = {
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  413: "too_large",
  415: "unsupported_media_type",
  429: "rate_limited",
};

/**
 * The API's one error handler. Every error leaves as JSON with a `code`:
 * `AppError` as thrown; a `mest.<code>` Postgres exception as 409; a zod
 * error or a malformed body as `400 { code: 'validation', issues }`; anything
 * else is logged and answered `500 { code: 'internal' }` with no detail.
 */
export const apiErrorHandler: ErrorHandler = (error, c) => {
  if (error instanceof AppError) {
    return c.json({ ...error.extra, code: error.code }, error.status);
  }

  const domain = domainErrorCode(error);
  if (domain) return c.json({ code: domain }, 409);

  if (error instanceof ZodError) {
    return c.json({ code: "validation", issues: error.issues }, 400);
  }

  if (error instanceof HTTPException && error.status < 500) {
    if (error.status === 400) {
      return c.json({ code: "validation", issues: [{ path: [], message: error.message }] }, 400);
    }
    return c.json({ code: HTTP_CODES[error.status] ?? "http_error" }, error.status as ContentfulStatusCode);
  }

  logUnhandled(c, error);
  return c.json({ code: "internal" }, 500);
};

function logUnhandled(c: Context, error: unknown): void {
  console.error(`[http] ${c.req.method} ${redactPath(c.req.path)} failed`, safeErrorSummary(error));
}

/**
 * Paths with a secret segment, and what a log writes instead. The calendar
 * feed's address is its key (`/api/calendar/<token>.ics`), so a log line
 * must never carry it.
 */
const SECRET_PATHS: { pattern: RegExp; replace: string }[] = [
  { pattern: /^\/api\/calendar\/[^/]+?(\.ics)?$/i, replace: "/api/calendar/<redacted>$1" },
];

/** A request path as a log may write it, with secret segments replaced by `<redacted>`. */
export function redactPath(path: string): string {
  for (const { pattern, replace } of SECRET_PATHS) {
    if (pattern.test(path)) return path.replace(pattern, replace);
  }
  return path;
}

/**
 * What an error log may carry. A Postgres error's `detail` and `where` can
 * quote row values (`Key (email)=(...)`), so only the code, constraint,
 * message and stack are kept.
 */
export function safeErrorSummary(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: typeof error };
  const pg = error as Error & { code?: string; constraint?: string; table?: string };
  return {
    name: error.name,
    message: error.message,
    ...(pg.code ? { code: pg.code } : {}),
    ...(pg.constraint ? { constraint: pg.constraint } : {}),
    ...(pg.table ? { table: pg.table } : {}),
    stack: error.stack,
  };
}

/** Unknown paths under `/api` answer JSON, unlike the rest of the site. */
export const apiNotFound: NotFoundHandler = (c) => c.json({ code: "not_found" }, 404);
