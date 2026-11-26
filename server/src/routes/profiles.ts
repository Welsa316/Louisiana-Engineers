import { Hono, type Context } from "hono";
import type { ProfileContactResponse, ProfileView, SaveResponse } from "@shared/types/directory";
import { requireMember, sessionUserId, userIdOf } from "../auth/middleware";
import { withUser } from "../db/tx";
import { AppError, domainErrorCode } from "../http/errors";
import { releaseContact } from "../services/contact";
import { getProfile, profileAccess, saveProfile, unsaveProfile, UUID_PATTERN } from "../services/directory";

/**
 * `/api/profiles/:id`: one profile, its contact methods and the save toggle.
 * `profile_access` decides between the profile, `403 { code: 'members_only' }`
 * and `404`, so a members-only profile is announced to a visitor without
 * leaking anything else about it. Mount at `/profiles`.
 */

const notFound = () => new AppError(404, "not_found", "profile not visible to the caller");

/** `save_profile` refuses an unsavable profile with `mest.not_found`; that is a 404, not a 409. */
async function asNotFound<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (domainErrorCode(error) === "not_found") throw notFound();
    throw error;
  }
}

const idOf = (c: Context) => c.req.param("id") ?? "";

export function createProfileRoutes(): Hono {
  const app = new Hono();

  app.get("/:id", async (c) => {
    const id = idOf(c);
    const viewer = await sessionUserId(c);
    const profile = await withUser(viewer, async (db) => {
      const access = await profileAccess(db, id);
      if (access === "members_only") throw new AppError(403, "members_only", "members-only profile");
      if (access === "none") throw notFound();
      return getProfile(db, id);
    });
    if (!profile) throw notFound();
    return c.json<ProfileView>(profile);
  });

  app.get("/:id/contact", requireMember, async (c) => {
    const id = idOf(c);
    const methods = await withUser(userIdOf(c), async (db) => {
      if ((await profileAccess(db, id)) !== "visible") throw notFound();
      return releaseContact(db, id);
    });
    return c.json<ProfileContactResponse>({ methods });
  });

  app.post("/:id/save", requireMember, async (c) => {
    const id = idOf(c);
    await withUser(userIdOf(c), async (db) => {
      if ((await profileAccess(db, id)) !== "visible") throw notFound();
      await asNotFound(saveProfile(db, id));
    });
    return c.json<SaveResponse>({ saved: true });
  });

  app.delete("/:id/save", requireMember, async (c) => {
    const id = idOf(c);
    await withUser(userIdOf(c), async (db) => {
      // A profile that has since gone out of sight can still be removed from the list.
      if (UUID_PATTERN.test(id)) await unsaveProfile(db, id);
    });
    return c.json<SaveResponse>({ saved: false });
  });

  return app;
}

export const profileRoutes = createProfileRoutes();
