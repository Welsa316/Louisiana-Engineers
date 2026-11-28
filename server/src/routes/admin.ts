import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  adminReviewSchema,
  adminTagDecisionSchema,
  adminVerifiedSchema,
  adminVocabularySchema,
  configPatchSchema,
} from "@shared/schemas/admin";
import { pageQuerySchema, slugSchema, uuidSchema } from "@shared/schemas/common";
import { disciplineGroups } from "@shared/taxonomy";
import { adminReviewStatuses } from "@shared/types/admin";
import { fieldLimits } from "@shared/limits";
import { approvalStates, mentorStatuses, profileKinds, tagStatuses } from "@shared/types/common";
import { requireAdmin, userIdOf } from "../auth/middleware";
import { withUser, type Db } from "../db/tx";
import { validate } from "../http/validate";
import * as admin from "../services/admin";

/**
 * `/api/admin/*`: the administration area (03 section 8). Every route is
 * behind `requireAdmin` (401 without a session, 403 `not_admin` otherwise,
 * and the Origin rule on writes), runs as the administrator through
 * `withUser`, and changes state only through the `admin_*` SQL functions,
 * which check `is_admin()` again and audit. Lists are paged `?page&size`
 * and answer `{ items, total }`. Mounted by the aggregator at `/admin`.
 */

const idParam = z.object({ id: uuidSchema });
const reviewsQuery = pageQuerySchema.extend({ status: z.enum(adminReviewStatuses).default("pending") });
const membersQuery = pageQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  kind: z.enum(profileKinds).optional(),
  approval: z.enum(approvalStates).optional(),
  mentorStatus: z.enum(mentorStatuses).optional(),
  verified: z
    .enum(["1", "0", "true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "1" || v === "true")),
  region: z
    .string()
    .max(fieldLimits.slug.max)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "expected a region slug")
    .optional(),
});
const tagsQuery = pageQuerySchema.extend({ status: z.enum(tagStatuses).optional() });
/** `regionId` null or left out grants every region; `admin_grant` keeps it within the caller's own scope. */
const grantSchema = z.object({ profileId: uuidSchema, regionId: slugSchema.nullable().optional() });
const vocabularySchema = adminVocabularySchema.extend({ groupName: z.enum(disciplineGroups as [string, ...string[]]).optional() });

export function createAdminRoutes(): Hono {
  const app = new Hono();
  app.use("*", requireAdmin);

  /** Runs `fn` as the administrator `requireAdmin` let through. */
  const as = <T>(c: Context, fn: (db: Db) => Promise<T>) => withUser(userIdOf(c), fn);

  app.get("/dashboard", async (c) => c.json(await as(c, admin.dashboard)));

  /* Review queue */

  app.get("/reviews", validate(reviewsQuery, "query"), async (c) => {
    const { status, page, size } = c.req.valid("query");
    return c.json(await as(c, (db) => admin.listReviews(db, status, { page, size })));
  });

  app.get("/reviews/:id", validate(idParam, "param"), async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await as(c, (db) => admin.getReview(db, id)));
  });

  app.post("/reviews/:id", validate(idParam, "param"), validate(adminReviewSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { decision, notes } = c.req.valid("json");
    await as(c, (db) => admin.decideReview(db, id, decision, notes));
    return c.json({ ok: true });
  });

  /* Profile actions */

  app.post("/profiles/:id/verified", validate(idParam, "param"), validate(adminVerifiedSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { method } = c.req.valid("json");
    await as(c, (db) => admin.setVerified(db, id, method));
    return c.json({ ok: true });
  });

  app.post("/profiles/:id/hide", validate(idParam, "param"), async (c) => {
    const { id } = c.req.valid("param");
    await as(c, (db) => admin.hideProfile(db, id));
    return c.json({ ok: true });
  });

  app.post("/profiles/:id/restore", validate(idParam, "param"), async (c) => {
    const { id } = c.req.valid("param");
    await as(c, (db) => admin.restoreProfile(db, id));
    return c.json({ ok: true });
  });

  /* Members */

  app.get("/members", validate(membersQuery, "query"), async (c) => {
    const { page, size, ...filters } = c.req.valid("query");
    return c.json(await as(c, (db) => admin.listMembers(db, filters, { page, size })));
  });

  /* Administrators */

  app.get("/admins", validate(pageQuerySchema, "query"), async (c) => {
    const viewer = userIdOf(c);
    const { page, size } = c.req.valid("query");
    return c.json(await withUser(viewer, (db) => admin.listAdmins(db, viewer, { page, size })));
  });

  app.post("/admins", validate(grantSchema), async (c) => {
    const { profileId, regionId } = c.req.valid("json");
    await as(c, (db) => admin.grantAdmin(db, profileId, regionId ?? null));
    return c.json({ ok: true });
  });

  app.delete("/admins/:id", validate(idParam, "param"), async (c) => {
    const { id } = c.req.valid("param");
    await as(c, (db) => admin.revokeAdmin(db, id));
    return c.json({ ok: true });
  });

  /* Expertise tags */

  app.get("/tags", validate(tagsQuery, "query"), async (c) => {
    const { status, page, size } = c.req.valid("query");
    return c.json(await as(c, (db) => admin.listTags(db, status, { page, size })));
  });

  app.post("/tags/:id", validate(idParam, "param"), validate(adminTagDecisionSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { decision } = c.req.valid("json");
    await as(c, (db) => admin.decideTag(db, id, decision));
    return c.json({ ok: true });
  });

  /* Vocabulary */

  app.get("/vocabulary", async (c) => c.json(await as(c, admin.vocabulary)));

  app.post("/vocabulary", validate(vocabularySchema), async (c) => {
    const entry = c.req.valid("json");
    await as(c, (db) =>
      admin.addVocabulary(db, {
        kind: entry.kind,
        id: entry.id,
        label: entry.label,
        groupName: entry.groupName as (typeof disciplineGroups)[number] | undefined,
      }),
    );
    return c.json({ ok: true });
  });

  /* Configuration */

  app.get("/config", async (c) => c.json(await as(c, admin.readConfig)));

  app.patch("/config", validate(configPatchSchema), async (c) => {
    const patch = c.req.valid("json");
    return c.json(await as(c, (db) => admin.updateConfig(db, patch)));
  });

  return app;
}

export const adminRoutes = createAdminRoutes();
