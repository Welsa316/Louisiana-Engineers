import { Hono } from "hono";
import { z } from "zod";
import { pageQuerySchema, uuidSchema } from "@shared/schemas/common";
import type { MarkAllReadResponse, MarkReadResponse, NotificationsResponse } from "@shared/types/notifications";
import { requireUser, userIdOf } from "../auth/middleware";
import { withUser } from "../db/tx";
import { validate } from "../http/validate";
import { listNotifications, markAllRead, markRead } from "../services/notifications";

/**
 * `/api/notifications/*`: the signed-in account's own in-app notifications
 * (Task 18). Every route needs a session rather than full membership: a
 * suspended member or one in a deletion grace period is sent `account`
 * notices and must be able to read them. Mounted by the aggregator at
 * `/notifications`.
 */

const listQuery = pageQuerySchema.extend({
  unread: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((value) => value === "1" || value === "true"),
});
const idParam = z.object({ id: uuidSchema });

export function createNotificationRoutes(): Hono {
  const app = new Hono();

  app.use("*", requireUser);
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.get("/", validate(listQuery, "query"), async (c) => {
    const { unread, page, size } = c.req.valid("query");
    const list = await withUser(userIdOf(c), (db) => listNotifications(db, { unreadOnly: unread, page, size }));
    return c.json<NotificationsResponse>(list);
  });

  app.post("/read-all", async (c) => {
    const result = await withUser(userIdOf(c), markAllRead);
    return c.json<MarkAllReadResponse>(result);
  });

  app.post("/:id/read", validate(idParam, "param"), async (c) => {
    const { id } = c.req.valid("param");
    const result = await withUser(userIdOf(c), (db) => markRead(db, id));
    return c.json<MarkReadResponse>(result);
  });

  return app;
}

export const notificationRoutes = createNotificationRoutes();
