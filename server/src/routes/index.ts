import { Hono } from "hono";

/**
 * Every API area, mounted under `/api` by `createApp`. Each area lives in its
 * own `server/src/routes/<area>.ts` exporting a Hono sub-app; this file only
 * mounts them, one `api.route(...)` line per area, and is edited only when
 * areas are integrated. Unknown `/api/*` paths are answered by `createApp`.
 */
export function createApiRoutes(): Hono {
  const api = new Hono();
  return api;
}
