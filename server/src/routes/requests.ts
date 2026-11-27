import { Hono, type Context } from "hono";
import { createRequestSchema, respondSchema } from "@shared/schemas/request";
import type {
  MentorAvailability,
  MyMentorship,
  RequestDetail,
  RequestsResponse,
  SuggestedMentorsResponse,
} from "@shared/types/requests";
import { requireMember, requireUser, sessionUserId, userIdOf } from "../auth/middleware";
import { withUser, type Db } from "../db/tx";
import { AppError, domainErrorCode } from "../http/errors";
import { validate } from "../http/validate";
import { UUID_PATTERN } from "../services/directory";
import {
  cancelRequest,
  completeRelationship,
  createRequest,
  getRequest,
  listRequests,
  mentorAvailability,
  myMentorship,
  readListQuery,
  requestListQuerySchema,
  respondToRequest,
  suggestedMentors,
  suggestedQuerySchema,
} from "../services/requests";

/**
 * Mentorship requests (Task 19), as three sub-apps for the aggregator:
 *
 * - `requestRoutes` at `/requests`: list, create, read, cancel, respond,
 *   complete. `:id` is always the request id. Only the two parties can read
 *   a request; anyone else gets 404, as if it did not exist.
 * - `mentorRoutes` at `/mentors`: `GET /:id/availability`, for anyone who
 *   can see the profile (a visitor's buttons need it too).
 * - `meMentorshipRoutes` at `/me`: `GET /mentorship` and
 *   `GET /suggested-mentors`, beside the `/me` routes of Task 12.
 *
 * Domain refusals from the SQL functions answer `409 { code }` through the
 * error handler; `mest.not_found` and `mest.forbidden` answer 404 and 403.
 */

const notFound = () => new AppError(404, "not_found", "request not visible to the caller");

const idOf = (c: Context) => c.req.param("id") ?? "";

/** Runs a transition, mapping the functions' "not yours" refusals to HTTP statuses. */
async function transition(work: Promise<void>): Promise<void> {
  try {
    await work;
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === "not_found") throw notFound();
    if (code === "forbidden") throw new AppError(403, "forbidden", "not this party's action");
    throw error;
  }
}

/** The request as the caller now sees it, or 404. */
async function detailOr404(db: Db, id: string): Promise<RequestDetail> {
  const detail = await getRequest(db, id);
  if (!detail) throw notFound();
  return detail;
}

function guardId(id: string): void {
  if (!UUID_PATTERN.test(id)) throw notFound();
}

export function createRequestRoutes(): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.get("/", requireUser, async (c) => {
    const parsed = requestListQuerySchema.safeParse(readListQuery(c.req.url));
    if (!parsed.success) throw new AppError(400, "validation", "invalid query", { issues: parsed.error.issues });
    const page = await withUser(userIdOf(c), (db) => listRequests(db, parsed.data));
    return c.json<RequestsResponse>(page);
  });

  app.post("/", requireMember, validate(createRequestSchema), async (c) => {
    const input = c.req.valid("json");
    const detail = await withUser(userIdOf(c), async (db) => {
      const id = await createRequest(db, input);
      return detailOr404(db, id);
    });
    return c.json<RequestDetail>(detail, 201);
  });

  app.get("/:id", requireUser, async (c) => {
    const id = idOf(c);
    const detail = await withUser(userIdOf(c), (db) => detailOr404(db, id));
    return c.json<RequestDetail>(detail);
  });

  app.post("/:id/cancel", requireMember, async (c) => {
    const id = idOf(c);
    guardId(id);
    const detail = await withUser(userIdOf(c), async (db) => {
      await transition(cancelRequest(db, id));
      return detailOr404(db, id);
    });
    return c.json<RequestDetail>(detail);
  });

  app.post("/:id/respond", requireMember, validate(respondSchema), async (c) => {
    const id = idOf(c);
    guardId(id);
    const answer = c.req.valid("json");
    const detail = await withUser(userIdOf(c), async (db) => {
      await transition(respondToRequest(db, id, answer));
      return detailOr404(db, id);
    });
    return c.json<RequestDetail>(detail);
  });

  app.post("/:id/complete", requireMember, async (c) => {
    const id = idOf(c);
    guardId(id);
    const detail = await withUser(userIdOf(c), async (db) => {
      await transition(completeRelationship(db, id));
      return detailOr404(db, id);
    });
    return c.json<RequestDetail>(detail);
  });

  return app;
}

export function createMentorRoutes(): Hono {
  const app = new Hono();

  app.get("/:id/availability", async (c) => {
    const id = idOf(c);
    const viewer = await sessionUserId(c);
    const availability = await withUser(viewer, (db) => mentorAvailability(db, id));
    if (!availability) throw new AppError(404, "not_found", "profile not visible to the caller");
    return c.json<MentorAvailability>(availability);
  });

  return app;
}

export function createMeMentorshipRoutes(): Hono {
  const app = new Hono();

  app.get("/mentorship", requireUser, async (c) => {
    const summary = await withUser(userIdOf(c), myMentorship);
    c.header("Cache-Control", "no-store");
    return c.json<MyMentorship>(summary);
  });

  app.get("/suggested-mentors", requireMember, validate(suggestedQuerySchema, "query"), async (c) => {
    const { topic } = c.req.valid("query");
    const suggestions = await withUser(userIdOf(c), (db) => suggestedMentors(db, topic));
    c.header("Cache-Control", "no-store");
    return c.json<SuggestedMentorsResponse>(suggestions);
  });

  return app;
}

export const requestRoutes = createRequestRoutes();
export const mentorRoutes = createMentorRoutes();
export const meMentorshipRoutes = createMeMentorshipRoutes();
