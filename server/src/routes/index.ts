import { Hono } from "hono";
import { adminRoutes } from "./admin";
import { authRoutes } from "./auth";
import { configRoutes } from "./config";
import { directoryRoutes } from "./directory";
import { meRoutes } from "./me";
import { notificationRoutes } from "./notifications";
import { profileRoutes } from "./profiles";
import { meMentorshipRoutes, mentorRoutes, requestRoutes } from "./requests";

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
  api.route("/me", meRoutes);
  api.route("/me", meMentorshipRoutes);
  api.route("/directory", directoryRoutes);
  api.route("/profiles", profileRoutes);
  api.route("/requests", requestRoutes);
  api.route("/mentors", mentorRoutes);
  api.route("/notifications", notificationRoutes);
  api.route("/admin", adminRoutes);
  return api;
}
