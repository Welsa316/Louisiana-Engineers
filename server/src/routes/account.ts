import { Hono } from "hono";
import { deletionRequestSchema } from "@shared/schemas/account";
import type { DeletionResponse } from "@shared/types/account";
import { requireUser, userIdOf } from "../auth/middleware";
import { withUser } from "../db/tx";
import { validate } from "../http/validate";
import { cancelDeletion, getDeletion, requestDeletion } from "../services/account";

/**
 * Account deletion (Task 26). Mount at `/me`, beside the other `/me`
 * sub-apps, so the paths are `/api/me/deletion`:
 *
 * - `GET /deletion` → `{ deletion }`, the caller's open deletion or null
 *   (the grace screen's date).
 * - `POST /deletion { confirmName }` → `{ deletion }`: hides the profile,
 *   closes waiting requests and schedules the sweep 14 days out.
 * - `DELETE /deletion` → `{ deletion: null }`: keeps the account.
 *
 * `requireUser`, not `requireMember`: a member in the grace period is no
 * longer a member (that is the point), and a suspended member may still
 * leave. The SQL functions check the caller themselves.
 */
export function createAccountRoutes(): Hono {
  const app = new Hono();

  app.get("/deletion", requireUser, async (c) => {
    const body = await withUser(userIdOf(c), (db) => getDeletion(db));
    c.header("Cache-Control", "no-store");
    return c.json<DeletionResponse>(body);
  });

  app.post("/deletion", requireUser, validate(deletionRequestSchema), async (c) => {
    const { confirmName } = c.req.valid("json");
    const body = await withUser(userIdOf(c), (db) => requestDeletion(db, confirmName));
    return c.json<DeletionResponse>(body);
  });

  app.delete("/deletion", requireUser, async (c) => {
    const body = await withUser(userIdOf(c), (db) => cancelDeletion(db));
    return c.json<DeletionResponse>(body);
  });

  return app;
}

export const accountRoutes = createAccountRoutes();
