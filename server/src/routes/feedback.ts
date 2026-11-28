import { Hono } from "hono";
import { leaveFeedbackSchema } from "@shared/schemas/feedback";
import { pageQuerySchema } from "@shared/schemas/common";
import type { AdminFeedbackResponse, FeedbackResponse } from "@shared/types/feedback";
import { requireAdmin, requireMember, requireUser, userIdOf } from "../auth/middleware";
import { withUser } from "../db/tx";
import { AppError, domainErrorCode } from "../http/errors";
import { validate } from "../http/validate";
import { getFeedback, leaveFeedback, listFeedbackComments } from "../services/feedback";

/**
 * Post-completion feedback (Task 32), as two sub-apps for the aggregator:
 *
 * - `requestFeedbackRoutes` at `/requests`: `GET /:id/feedback` (where the
 *   caller stands, and their own answer) and `POST /:id/feedback` (the two
 *   questions, once, after completion). `:id` is the request id, as on the
 *   request pages. Only the two parties reach it; anyone else, an
 *   administrator included, gets 404.
 * - `adminFeedbackRoutes` at `/admin`: `GET /feedback?page&size`, the
 *   comments with no author attached.
 *
 * `409 { code }` answers `not_completed` and `feedback_exists`
 * (`FeedbackErrorCode`).
 */

const notFound = () => new AppError(404, "not_found", "request not visible to the caller");

export function createRequestFeedbackRoutes(): Hono {
  const app = new Hono();
  app.use("/:id/feedback", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.get("/:id/feedback", requireUser, async (c) => {
    const state = await withUser(userIdOf(c), (db) => getFeedback(db, c.req.param("id")));
    if (!state) throw notFound();
    return c.json<FeedbackResponse>(state);
  });

  app.post("/:id/feedback", requireMember, validate(leaveFeedbackSchema), async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const state = await withUser(userIdOf(c), async (db) => {
      if (!(await getFeedback(db, id))) throw notFound();
      try {
        return await leaveFeedback(db, id, input);
      } catch (error) {
        if (domainErrorCode(error) === "not_found") throw notFound();
        throw error;
      }
    });
    return c.json<FeedbackResponse>(state, 201);
  });

  return app;
}

export function createAdminFeedbackRoutes(): Hono {
  const app = new Hono();
  app.use("/feedback", requireAdmin);

  app.get("/feedback", validate(pageQuerySchema, "query"), async (c) => {
    const page = c.req.valid("query");
    const list = await withUser(userIdOf(c), (db) => listFeedbackComments(db, page));
    c.header("Cache-Control", "no-store");
    return c.json<AdminFeedbackResponse>(list);
  });

  return app;
}

export const requestFeedbackRoutes = createRequestFeedbackRoutes();
export const adminFeedbackRoutes = createAdminFeedbackRoutes();
