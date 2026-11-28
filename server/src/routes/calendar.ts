import { Hono } from "hono";
import type { CalendarFeedResponse, CreatedCalendarFeedResponse } from "@shared/types/calendar";
import { requireMember, requireUser, userIdOf } from "../auth/middleware";
import { withUser } from "../db/tx";
import { env } from "../env";
import { AppError } from "../http/errors";
import {
  calendarEvents,
  createCalendarFeed,
  feedUrls,
  ownCalendarFeed,
  renderCalendar,
  revokeCalendarFeed,
} from "../services/calendar";

/**
 * The calendar feed (Task 37), as two sub-apps for the aggregator:
 *
 * - `meCalendarRoutes`, mounted at `/me`: `GET /api/me/calendar` (is the
 *   feed on), `POST` (turn it on or give it a new address; the answer holds
 *   the address, the only time it is shown) and `DELETE` (turn it off).
 * - `calendarRoutes`, mounted at `/calendar`: `GET /api/calendar/:token.ics`,
 *   the feed for a calendar app. No session: the address is the key, and an
 *   unknown, revoked or malformed one answers 404.
 *
 * Every answer is `Cache-Control: no-store`, so neither the address nor the
 * meetings behind it sit in a shared cache.
 */

/**
 * `no-store` on `path` only: the `/me` sub-app shares its mount with other
 * areas, whose own cache headers a `*` middleware here would overwrite.
 */
function noStore(app: Hono, path: string): void {
  app.use(path, async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
}

export function createMeCalendarRoutes(): Hono {
  const app = new Hono();
  noStore(app, "/calendar");

  app.get("/calendar", requireUser, async (c) => {
    const feed = await withUser(userIdOf(c), (db) => ownCalendarFeed(db));
    return c.json<CalendarFeedResponse>({ feed });
  });

  app.post("/calendar", requireMember, async (c) => {
    const { token, feed } = await withUser(userIdOf(c), (db) => createCalendarFeed(db));
    return c.json<CreatedCalendarFeedResponse>({ feed, ...feedUrls(env.APP_ORIGIN, token) }, 201);
  });

  app.delete("/calendar", requireMember, async (c) => {
    await withUser(userIdOf(c), (db) => revokeCalendarFeed(db));
    return c.json<CalendarFeedResponse>({ feed: null });
  });

  return app;
}

const notFound = () => new AppError(404, "not_found", "no calendar feed at this address");

export function createCalendarRoutes(): Hono {
  const app = new Hono();
  noStore(app, "*");

  app.get("/:file", async (c) => {
    const file = c.req.param("file");
    if (!file.endsWith(".ics")) throw notFound();
    const events = await withUser(null, (db) => calendarEvents(db, file.slice(0, -".ics".length)));
    if (!events) throw notFound();
    c.header("Content-Type", "text/calendar; charset=utf-8");
    c.header("Content-Disposition", 'inline; filename="mest-mentorship.ics"');
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Robots-Tag", "noindex");
    c.header("Referrer-Policy", "no-referrer");
    return c.body(renderCalendar(events, { origin: env.APP_ORIGIN }));
  });

  return app;
}

export const meCalendarRoutes = createMeCalendarRoutes();
export const calendarRoutes = createCalendarRoutes();
