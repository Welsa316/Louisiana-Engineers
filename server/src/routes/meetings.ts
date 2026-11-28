import { Hono, type Context } from "hono";
import type { z } from "zod";
import { chooseTimeSchema, meetingOutcomeSchema, proposeTimesSchema } from "@shared/schemas/meetings";
import type { Meeting, MeetingLogResponse, MeetingsResponse, ProposeTimesResponse, SlotsResponse } from "@shared/types/meetings";
import { requireMember, requireUser, userIdOf } from "../auth/middleware";
import { withUser, type Db } from "../db/tx";
import { AppError, domainErrorCode } from "../http/errors";
import { validate } from "../http/validate";
import {
  cancelMeeting,
  chooseTime,
  getMeeting,
  listRelationshipMeetings,
  listSlots,
  meetingListQuerySchema,
  meetingLog,
  meetingLogQuerySchema,
  proposeTimes,
  recordOutcome,
  relationshipOf,
  slotInRelationship,
  slotListQuerySchema,
} from "../services/meetings";
import { readListQuery } from "../services/requests";

/**
 * Scheduling (Task 30), as two sub-apps for the aggregator:
 *
 * - `relationshipMeetingRoutes` at `/relationships`: `GET` and `POST`
 *   `/:requestId/slots` (propose one to three times) and `/:requestId/meetings`
 *   (choose one of the other party's times). `:requestId` is the accepted
 *   request's id, as on the request pages.
 * - `meetingRoutes` at `/meetings`: `GET /` (the caller's meetings log, both
 *   roles), `POST /:id/cancel` and `POST /:id/outcome` ("Did you meet?").
 *
 * Only the two parties of the relationship reach any of it; anyone else,
 * an administrator included, gets 404 as if it did not exist. Domain
 * refusals from the SQL functions answer `409 { code }`; `mest.not_found`
 * and `mest.forbidden` answer 404 and 403.
 */

const notFound = () => new AppError(404, "not_found", "relationship or meeting not visible to the caller");

/** Runs a write, mapping the functions' "not yours" refusals to HTTP statuses. */
async function transition<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === "not_found") throw notFound();
    if (code === "forbidden") throw new AppError(403, "forbidden", "not this party's action");
    throw error;
  }
}

function parseQuery<S extends z.ZodTypeAny>(c: Context, schema: S): z.output<S> {
  const parsed = schema.safeParse(readListQuery(c.req.url));
  if (!parsed.success) throw new AppError(400, "validation", "invalid query", { issues: parsed.error.issues });
  return parsed.data;
}

/** The caller's relationship for `:requestId`, or 404. */
async function relationshipOr404(db: Db, c: Context): Promise<string> {
  const id = await relationshipOf(db, c.req.param("requestId") ?? "");
  if (!id) throw notFound();
  return id;
}

async function meetingOr404(db: Db, id: string): Promise<Meeting> {
  const meeting = await getMeeting(db, id);
  if (!meeting) throw notFound();
  return meeting;
}

function noStore(app: Hono): void {
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
}

export function createRelationshipMeetingRoutes(): Hono {
  const app = new Hono();
  noStore(app);

  app.get("/:requestId/slots", requireUser, async (c) => {
    const query = parseQuery(c, slotListQuerySchema);
    const page = await withUser(userIdOf(c), async (db) => listSlots(db, await relationshipOr404(db, c), query));
    return c.json<SlotsResponse>(page);
  });

  app.post("/:requestId/slots", requireMember, validate(proposeTimesSchema), async (c) => {
    const input = c.req.valid("json");
    const proposal = await withUser(userIdOf(c), async (db) =>
      transition(proposeTimes(db, await relationshipOr404(db, c), input)),
    );
    return c.json<ProposeTimesResponse>(proposal, 201);
  });

  app.get("/:requestId/meetings", requireUser, async (c) => {
    const query = parseQuery(c, meetingListQuerySchema);
    const page = await withUser(userIdOf(c), async (db) => listRelationshipMeetings(db, await relationshipOr404(db, c), query));
    return c.json<MeetingsResponse>(page);
  });

  app.post("/:requestId/meetings", requireMember, validate(chooseTimeSchema), async (c) => {
    const input = c.req.valid("json");
    const meeting = await withUser(userIdOf(c), async (db) => {
      const relationshipId = await relationshipOr404(db, c);
      if (!(await slotInRelationship(db, relationshipId, input.slotId))) throw notFound();
      const id = await transition(chooseTime(db, input));
      return meetingOr404(db, id);
    });
    return c.json<Meeting>(meeting, 201);
  });

  return app;
}

export function createMeetingRoutes(): Hono {
  const app = new Hono();
  noStore(app);

  app.get("/", requireUser, async (c) => {
    const query = parseQuery(c, meetingLogQuerySchema);
    const page = await withUser(userIdOf(c), (db) => meetingLog(db, query));
    return c.json<MeetingLogResponse>(page);
  });

  app.post("/:id/cancel", requireMember, async (c) => {
    const id = c.req.param("id");
    const meeting = await withUser(userIdOf(c), async (db) => {
      await meetingOr404(db, id);
      await transition(cancelMeeting(db, id));
      return meetingOr404(db, id);
    });
    return c.json<Meeting>(meeting);
  });

  app.post("/:id/outcome", requireMember, validate(meetingOutcomeSchema), async (c) => {
    const id = c.req.param("id");
    const { met } = c.req.valid("json");
    const meeting = await withUser(userIdOf(c), async (db) => {
      await meetingOr404(db, id);
      await transition(recordOutcome(db, id, met));
      return meetingOr404(db, id);
    });
    return c.json<Meeting>(meeting);
  });

  return app;
}

export const relationshipMeetingRoutes = createRelationshipMeetingRoutes();
export const meetingRoutes = createMeetingRoutes();
