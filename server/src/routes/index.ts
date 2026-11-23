import { Hono } from "hono";
import { authRoutes } from "./auth";
import { configRoutes } from "./config";

/**
 * Every API area, mounted under `/api` by `createApp`. Each area lives in its
 * own `server/src/routes/<area>.ts` exporting a Hono sub-app; this file only
 * mounts them, one `api.route(...)` line per area, and is edited only when
 * areas are integrated. Unknown `/api/*` paths are answered by `createApp`.
 *
 * The Origin rule for non-GET requests is applied per route by the auth
 * guards (`requireUser` and stronger) and by the auth routes themselves,
 * so the test-only `dev-login` route can stay exempt.
 */
export function createApiRoutes(): Hono {
  const api = new Hono();
  api.route("/auth", authRoutes);
  api.route("/config", configRoutes);
  return api;
}
