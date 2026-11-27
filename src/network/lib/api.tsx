/**
 * The one way the network app talks to the API. Requests carry the session
 * cookie, JSON bodies are encoded for the caller, and every non-2xx answer
 * becomes an `ApiError` holding the server's `code` (see
 * server/src/http/errors.ts): `unauthenticated`, `not_member`, `not_admin`,
 * `validation` (with `issues`), `rate_limited`, a domain code from a
 * `mest.<code>` SQL exception, or `network` when the request never landed.
 */

export interface ApiIssue {
  path: (string | number)[];
  message: string;
  code?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiIssue[];
  /** Any other fields the server put on the error body. */
  readonly body: Record<string, unknown>;

  constructor(status: number, code: string, issues: ApiIssue[] = [], body: Record<string, unknown> = {}) {
    super(`API ${status} ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.body = body;
  }
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

/** A plain object or array body is sent as JSON; anything `fetch` accepts is sent as is. */
export type ApiInit = Omit<RequestInit, "body"> & { body?: BodyInit | Record<string, unknown> | unknown[] | null };

/** `/auth/me` and `/api/auth/me` both mean `/api/auth/me`. */
export function apiUrl(path: string): string {
  if (path === "/api" || path.startsWith("/api/") || path.startsWith("/api?")) return path;
  return `/api${path.startsWith("/") ? path : `/${path}`}`;
}

function isRawBody(body: unknown): body is BodyInit {
  return (
    typeof body === "string" ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof ReadableStream !== "undefined" && body instanceof ReadableStream)
  );
}

/**
 * Calls the API and returns the parsed JSON body (`undefined` for an empty
 * answer). Throws `ApiError` for every failure, including a network error.
 */
export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const { body, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  headers.set("Accept", "application/json");

  let payload: BodyInit | null | undefined;
  if (body === undefined || body === null) {
    payload = body;
  } else if (isRawBody(body)) {
    payload = body;
  } else {
    payload = JSON.stringify(body);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path), { credentials: "include", ...rest, headers, body: payload });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "network");
  }

  const text = await res.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    const code = typeof record.code === "string" ? record.code : `http_${res.status}`;
    const issues = Array.isArray(record.issues) ? (record.issues as ApiIssue[]) : [];
    throw new ApiError(res.status, code, issues, record);
  }

  return data as T;
}
