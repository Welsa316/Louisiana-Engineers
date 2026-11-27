import { Hono, type Context } from "hono";
import { z } from "zod";
import { adminResolveReportSchema } from "@shared/schemas/admin";
import { pageQuerySchema, uuidSchema } from "@shared/schemas/common";
import { reportSchema } from "@shared/schemas/request";
import { reportStatuses, requestStatuses } from "@shared/types/common";
import type { AdminReportResolved, AdminReportsResponse, AdminRequestsResponse, ReportCreated } from "@shared/types/reports";
import { requireAdmin, requireMember, userIdOf } from "../auth/middleware";
import { withUser, type Db } from "../db/tx";
import { AppError, domainErrorCode } from "../http/errors";
import { validate } from "../http/validate";
import { UUID_PATTERN } from "../services/directory";
import { fileReport, getReport, listAdminRequests, listReports, resolveReport } from "../services/reports";

/**
 * Reports and moderation (Task 24), as two sub-apps for the aggregator:
 *
 * - `profileReportRoutes` at `/profiles`: `POST /:id/report` for members
 *   (`requireMember`). A profile the caller cannot see answers 404, the
 *   daily limit `409 { code: 'rate_limited' }`.
 * - `adminReportRoutes` at `/admin`, behind `requireAdmin`:
 *   `GET /reports?status=open|resolved|dismissed&page&size`,
 *   `POST /reports/:id/resolve { status, note?, action }` and
 *   `GET /requests?profile&status&page&size` (the masked `admin_requests`
 *   view).
 *
 * Every change is a SQL function that checks the caller again
 * (`report_profile`, `admin_resolve_report`); other `mest.<code>`
 * refusals answer 409 through the error handler.
 */

const notFound = (what: string) => new AppError(404, "not_found", `${what} not visible to the caller`);

/** The functions' "no such thing for you" refusals are 404s, not 409s. */
async function mapNotFound<T>(what: string, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (domainErrorCode(error) === "not_found") throw notFound(what);
    throw error;
  }
}

const idOf = (c: Context) => c.req.param("id") ?? "";

export function createProfileReportRoutes(): Hono {
  const app = new Hono();

  app.post("/:id/report", requireMember, validate(reportSchema), async (c) => {
    const id = idOf(c);
    if (!UUID_PATTERN.test(id)) throw notFound("profile");
    const input = c.req.valid("json");
    const reportId = await withUser(userIdOf(c), (db) => mapNotFound("profile", fileReport(db, id, input)));
    return c.json<ReportCreated>({ id: reportId }, 201);
  });

  return app;
}

const idParam = z.object({ id: uuidSchema });
const reportsQuery = pageQuerySchema.extend({ status: z.enum(reportStatuses).default("open") });
const requestsQuery = pageQuerySchema.extend({
  profile: uuidSchema.optional(),
  status: z.enum(requestStatuses).optional(),
});

export function createAdminReportRoutes(): Hono {
  const app = new Hono();

  /** Runs `fn` as the administrator `requireAdmin` let through. */
  const as = <T>(c: Context, fn: (db: Db) => Promise<T>) => withUser(userIdOf(c), fn);

  app.use("/reports", requireAdmin);
  app.use("/reports/*", requireAdmin);
  app.use("/requests", requireAdmin);

  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.get("/reports", validate(reportsQuery, "query"), async (c) => {
    const { status, page, size } = c.req.valid("query");
    return c.json<AdminReportsResponse>(await as(c, (db) => listReports(db, status, { page, size })));
  });

  app.post("/reports/:id/resolve", validate(idParam, "param"), validate(adminResolveReportSchema), async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const report = await as(c, async (db) => {
      await mapNotFound("report", resolveReport(db, id, input));
      return getReport(db, id);
    });
    if (!report) throw notFound("report");
    return c.json<AdminReportResolved>(report);
  });

  app.get("/requests", validate(requestsQuery, "query"), async (c) => {
    const { profile, status, page, size } = c.req.valid("query");
    return c.json<AdminRequestsResponse>(await as(c, (db) => listAdminRequests(db, { profile, status }, { page, size })));
  });

  return app;
}

export const profileReportRoutes = createProfileReportRoutes();
export const adminReportRoutes = createAdminReportRoutes();
