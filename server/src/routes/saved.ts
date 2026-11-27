import { Hono } from "hono";
import { pageQuerySchema } from "@shared/schemas/common";
import type { SavedResponse } from "@shared/types/saved";
import { requireUser, userIdOf } from "../auth/middleware";
import { withUser } from "../db/tx";
import { validate } from "../http/validate";
import { listSaved } from "../services/saved";

/**
 * `GET /saved?page&size`: the caller's saved profiles (Task 22's Saved
 * page). Saving and unsaving stay on `/api/profiles/:id/save`. Mount at
 * `/me`, beside the other `/me` sub-apps, so the path is `/api/me/saved`.
 */
export function createSavedRoutes(): Hono {
  const app = new Hono();

  app.get("/saved", requireUser, validate(pageQuerySchema, "query"), async (c) => {
    const query = c.req.valid("query");
    const saved = await withUser(userIdOf(c), (db) => listSaved(db, query));
    c.header("Cache-Control", "no-store");
    return c.json<SavedResponse>(saved);
  });

  return app;
}

export const savedRoutes = createSavedRoutes();
