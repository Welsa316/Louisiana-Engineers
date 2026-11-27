import { Hono } from "hono";
import type { DataExport } from "@shared/types/export";
import { requireUser, userIdOf } from "../auth/middleware";
import { withUser } from "../db/tx";
import { exportMyData } from "../services/export";

/**
 * `GET /export`: the signed-in member's data as a JSON attachment (Task 27,
 * ACC-7). A session is enough: a member in a deletion grace period, or one
 * who is suspended, can still take their data with them. Mount at `/me`,
 * beside the other `/me` sub-apps, so the path is `/api/me/export`.
 */
export function createExportRoutes(): Hono {
  const app = new Hono();

  app.get("/export", requireUser, async (c) => {
    const data = await withUser(userIdOf(c), exportMyData);
    const day = data.exportedAt.slice(0, 10);
    c.header("Cache-Control", "no-store");
    c.header("Content-Disposition", `attachment; filename="mest-network-export-${day}.json"`);
    return c.json<DataExport>(data);
  });

  return app;
}

export const exportRoutes = createExportRoutes();
