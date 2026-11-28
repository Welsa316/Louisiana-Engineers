import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { photoLimits } from "@shared/limits";
import { uuidSchema } from "@shared/schemas/common";
import { adminPhotoDecisionSchema, adminPhotosQuerySchema } from "@shared/schemas/photos";
import type { AdminPhoto, OwnPhotoResponse } from "@shared/types/photos";
import type { Paged } from "@shared/types/common";
import { requireAdmin, requireMember, requireUser, sessionUserId, userIdOf } from "../auth/middleware";
import { withUser } from "../db/tx";
import { AppError } from "../http/errors";
import { validate } from "../http/validate";
import { UUID_PATTERN } from "../services/directory";
import {
  deleteOwnPhoto,
  getOwnPhoto,
  getOwnPhotoBytes,
  getPhotoBytesForAdmin,
  getProfilePhotoBytes,
  listPhotos,
  reviewPhoto,
  setOwnPhoto,
  sniffImageType,
  type PhotoBytes,
} from "../services/photos";

/**
 * Profile photos (Task 33), as three sub-apps for the aggregator:
 *
 * - `mePhotoRoutes`, mounted at `/me`: `GET`, `POST` (multipart, field
 *   `photo`) and `DELETE /api/me/photo`, and the owner's own image at
 *   `GET /api/me/photo/image` in any state.
 * - `photoRoutes`, mounted at `/photos`: `GET /api/photos/:profileId`, the
 *   approved photo of a profile the caller may see (the profile's own rule),
 *   else 404. `Cache-Control: public` only when a visitor could see it too,
 *   `private` otherwise (members-only, counterparty, owner, administrator).
 * - `adminPhotoRoutes`, mounted at `/admin`: the queue at
 *   `GET /api/admin/photos`, any photo's image for review, and
 *   `POST /api/admin/photos/:id` with `{ decision }`.
 *
 * An upload is checked by its bytes (JPEG or WebP magic numbers), not the
 * type the browser declared, and by its size; the SQL function and the
 * table's CHECK constraints check both again.
 */

/** Room for the 200 000-byte photo plus the multipart framing; anything bigger is refused unread. */
const MAX_UPLOAD_BODY = photoLimits.maxBytes + 64 * 1024;


const tooLarge = () => new AppError(413, "too_large", "photo over the size limit");

function sendImage(c: Context, photo: PhotoBytes, cacheControl: string): Response {
  c.header("Content-Type", photo.contentType);
  c.header("Content-Length", String(photo.image.byteLength));
  c.header("Cache-Control", cacheControl);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "default-src 'none'");
  c.header("ETag", `"${photo.version}"`);
  return c.body(new Uint8Array(photo.image));
}

/* ---------------------------------------------------------------- /me/photo */

export function createMePhotoRoutes(): Hono {
  const app = new Hono();

  app.get("/photo", requireUser, async (c) => {
    const photo = await withUser(userIdOf(c), getOwnPhoto);
    c.header("Cache-Control", "no-store");
    return c.json<OwnPhotoResponse>({ photo });
  });

  app.get("/photo/image", requireUser, async (c) => {
    const photo = await withUser(userIdOf(c), getOwnPhotoBytes);
    if (!photo) throw new AppError(404, "not_found", "no photo");
    return sendImage(c, photo, "no-store");
  });

  app.post(
    "/photo",
    // First: the limit can swap in a guarded copy of the request, and the
    // session the guard resolves is remembered per request object.
    bodyLimit({ maxSize: MAX_UPLOAD_BODY, onError: () => { throw tooLarge(); } }),
    requireMember,
    async (c) => {
      const form = await c.req.parseBody();
      const file = form.photo;
      if (!(file instanceof File)) {
        throw new AppError(400, "validation", "no photo file", {
          issues: [{ path: ["photo"], message: "Choose a photo to upload" }],
        });
      }
      if (file.size > photoLimits.maxBytes) throw tooLarge();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > photoLimits.maxBytes) throw tooLarge();
      const contentType = sniffImageType(bytes);
      if (!contentType) throw new AppError(415, "unsupported_media_type", "photo is not a JPEG or WebP");
      const photo = await withUser(userIdOf(c), (db) => setOwnPhoto(db, bytes, contentType));
      c.header("Cache-Control", "no-store");
      return c.json<OwnPhotoResponse>({ photo }, 201);
    },
  );

  app.delete("/photo", requireUser, async (c) => {
    await withUser(userIdOf(c), deleteOwnPhoto);
    c.header("Cache-Control", "no-store");
    return c.json<OwnPhotoResponse>({ photo: null });
  });

  return app;
}

/* ------------------------------------------------------------------ /photos */

export function createPhotoRoutes(): Hono {
  const app = new Hono();

  app.get("/:profileId", async (c) => {
    const profileId = c.req.param("profileId");
    if (!UUID_PATTERN.test(profileId)) throw new AppError(404, "not_found", "malformed profile id");
    const viewer = await sessionUserId(c);
    const photo = await withUser(viewer, (db) => getProfilePhotoBytes(db, profileId));
    if (!photo) throw new AppError(404, "not_found", "no approved photo visible to the caller");
    // no-cache: browsers keep the image but ask first (a 304 by ETag), so a
    // takedown or a switch to members-only applies on the next view.
    const cacheControl = `${photo.shareable ? "public" : "private"}, no-cache`;
    if (c.req.header("if-none-match") === `"${photo.version}"`) {
      c.header("Cache-Control", cacheControl);
      c.header("ETag", `"${photo.version}"`);
      return c.body(null, 304);
    }
    // A member-only answer must not be reused for someone signed out.
    if (!photo.shareable) c.header("Vary", "Cookie");
    return sendImage(c, photo, cacheControl);
  });

  return app;
}

/* ------------------------------------------------------------ /admin/photos */

const idParam = z.object({ id: uuidSchema });

export function createAdminPhotoRoutes(): Hono {
  const app = new Hono();
  app.use("/photos", requireAdmin);
  app.use("/photos/*", requireAdmin);

  app.get("/photos", validate(adminPhotosQuerySchema, "query"), async (c) => {
    const { status, page, size } = c.req.valid("query");
    const list = await withUser(userIdOf(c), (db) => listPhotos(db, status, { page, size }));
    c.header("Cache-Control", "no-store");
    return c.json<Paged<AdminPhoto>>(list);
  });

  app.get("/photos/:id/image", validate(idParam, "param"), async (c) => {
    const { id } = c.req.valid("param");
    const photo = await withUser(userIdOf(c), (db) => getPhotoBytesForAdmin(db, id));
    if (!photo) throw new AppError(404, "not_found", `no photo ${id}`);
    return sendImage(c, photo, "no-store");
  });

  app.post("/photos/:id", validate(idParam, "param"), validate(adminPhotoDecisionSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { decision } = c.req.valid("json");
    await withUser(userIdOf(c), (db) => reviewPhoto(db, id, decision));
    return c.json({ ok: true });
  });

  return app;
}

export const mePhotoRoutes = createMePhotoRoutes();
export const photoRoutes = createPhotoRoutes();
export const adminPhotoRoutes = createAdminPhotoRoutes();
