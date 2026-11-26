import { Hono } from "hono";
import type { DirectoryResponse } from "@shared/types/directory";
import { sessionUserId } from "../auth/middleware";
import { withUser } from "../db/tx";
import { AppError } from "../http/errors";
import { directoryQuerySchema, readDirectoryQuery, searchDirectory } from "../services/directory";

/**
 * `/api/directory`: the directory list for whoever is asking. A visitor gets
 * public profiles; a signed-in member gets members-only ones as well (the
 * row policies decide). Mount at `/directory`.
 */
export function createDirectoryRoutes(): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const parsed = directoryQuerySchema.safeParse(readDirectoryQuery(c.req.url));
    if (!parsed.success) {
      throw new AppError(400, "validation", "invalid directory query", { issues: parsed.error.issues });
    }
    const viewer = await sessionUserId(c);
    const result = await withUser(viewer, (db) => searchDirectory(db, parsed.data));
    return c.json<DirectoryResponse>(result);
  });

  return app;
}

export const directoryRoutes = createDirectoryRoutes();
