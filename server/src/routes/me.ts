import { Hono } from "hono";
import { z } from "zod";
import { onboardingSchema } from "@shared/schemas/onboarding";
import { profilePatchSchema } from "@shared/schemas/profile";
import { settingsPatchSchema } from "@shared/schemas/settings";
import { profileKinds } from "@shared/types/common";
import type { OwnProfile, OwnSettings, PreviewResponse, TouchResponse } from "@shared/types/me";
import { requireMember, requireUser, userIdOf } from "../auth/middleware";
import { withUser } from "../db/tx";
import { validate } from "../http/validate";
import {
  completeOnboarding,
  getOwnProfile,
  getOwnSettings,
  patchProfile,
  patchSettings,
  previewProfile,
  setKind,
  touch,
} from "../services/profiles";

/**
 * `/api/me/*`: the signed-in member's own profile, settings, kind and
 * preview (Task 12). Mounted by the aggregator at `/me`. Reads need a
 * session (a member in a deletion grace period can still read their own
 * profile); writes need a member in good standing.
 */

const kindSchema = z.object({ kind: z.enum(profileKinds) }).strict();
const previewQuerySchema = z.object({ as: z.enum(["visitor", "member"]) });

export function createMeRoutes(): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.get("/profile", requireUser, async (c) => {
    const profile = await withUser(userIdOf(c), getOwnProfile);
    return c.json<OwnProfile>(profile);
  });

  app.post("/onboarding", requireMember, validate(onboardingSchema), async (c) => {
    const payload = c.req.valid("json");
    const profile = await withUser(userIdOf(c), (db) => completeOnboarding(db, payload));
    return c.json<OwnProfile>(profile);
  });

  app.patch("/profile", requireMember, validate(profilePatchSchema), async (c) => {
    const patch = c.req.valid("json");
    const profile = await withUser(userIdOf(c), (db) => patchProfile(db, patch));
    return c.json<OwnProfile>(profile);
  });

  app.get("/settings", requireUser, async (c) => {
    const settings = await withUser(userIdOf(c), getOwnSettings);
    return c.json<OwnSettings>(settings);
  });

  app.patch("/settings", requireMember, validate(settingsPatchSchema), async (c) => {
    const patch = c.req.valid("json");
    const settings = await withUser(userIdOf(c), (db) => patchSettings(db, patch));
    return c.json<OwnSettings>(settings);
  });

  app.post("/kind", requireMember, validate(kindSchema), async (c) => {
    const { kind } = c.req.valid("json");
    const profile = await withUser(userIdOf(c), (db) => setKind(db, kind));
    return c.json<OwnProfile>(profile);
  });

  app.post("/touch", requireUser, async (c) => {
    const result = await withUser(userIdOf(c), touch);
    return c.json<TouchResponse>(result);
  });

  app.get("/preview", requireUser, validate(previewQuerySchema, "query"), async (c) => {
    const { as } = c.req.valid("query");
    const preview = await withUser(userIdOf(c), (db) => previewProfile(db, as));
    return c.json<PreviewResponse>(preview);
  });

  return app;
}

export const meRoutes = createMeRoutes();
