import { photoLimits } from "@shared/limits";
import type { Paged } from "@shared/types/common";
import type { AdminPhoto, OwnPhoto, PhotoContentType, PhotoDecision, PhotoStatus } from "@shared/types/photos";
import type { Db } from "../db/tx";

/**
 * Profile photos (Task 33). Every call runs in the caller's own `withUser`
 * transaction: reads go through the `profile_photos` policy (owner and
 * administrators see any state, everyone else an approved photo of a profile
 * they may see) and every write is one of the definer functions from
 * migration 0016, which check the caller first and audit.
 */

/**
 * What the bytes are, by their magic numbers, whatever the browser claimed:
 * JPEG (`FF D8 FF`) or WebP (a `RIFF` container whose form type is `WEBP`).
 * Anything else, SVG and PNG included, is null.
 */
export function sniffImageType(bytes: Uint8Array): PhotoContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

export const OWN_IMAGE_PATH = "/api/me/photo/image";
export const adminImagePath = (photoId: string) => `/api/admin/photos/${photoId}/image`;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

interface PhotoRow {
  id: string;
  status: PhotoStatus;
  content_type: PhotoContentType;
  byte_size: number;
  created_at: Date;
  reviewed_at: Date | null;
}

const META_COLUMNS = "ph.id, ph.status::text AS status, ph.content_type, ph.byte_size, ph.created_at, ph.reviewed_at";

function ownPhoto(row: PhotoRow): OwnPhoto {
  return {
    id: row.id,
    status: row.status,
    contentType: row.content_type,
    byteSize: row.byte_size,
    uploadedAt: row.created_at.toISOString(),
    reviewedAt: iso(row.reviewed_at),
    // The id rides along so a replaced photo is never shown from cache.
    imageUrl: `${OWN_IMAGE_PATH}?v=${row.id}`,
  };
}

/** The caller's photo in any state, without its bytes. */
export async function getOwnPhoto(db: Db): Promise<OwnPhoto | null> {
  const row = await db.maybeOne<PhotoRow>(`SELECT ${META_COLUMNS} FROM profile_photos ph WHERE ph.profile_id = app_uid()`);
  return row ? ownPhoto(row) : null;
}

export interface PhotoBytes {
  version: string;
  image: Buffer;
  contentType: PhotoContentType;
  /** Whether a visitor could see it too, so a shared cache may keep it. */
  shareable: boolean;
}

/** The caller's own image, in any state (the settings preview). */
export async function getOwnPhotoBytes(db: Db): Promise<PhotoBytes | null> {
  const row = await db.maybeOne<{ id: string; image: Buffer; content_type: PhotoContentType }>(
    "SELECT ph.id, ph.image, ph.content_type FROM profile_photos ph WHERE ph.profile_id = app_uid()",
  );
  return row ? { version: row.id, image: row.image, contentType: row.content_type, shareable: false } : null;
}

/** An approved photo of a profile the caller may see, through `photo_for_profile`. */
export async function getProfilePhotoBytes(db: Db, profileId: string): Promise<PhotoBytes | null> {
  const row = await db.maybeOne<{ version: string; image: Buffer; content_type: PhotoContentType; shareable: boolean }>(
    "SELECT version, image, content_type, shareable FROM photo_for_profile($1)",
    [profileId],
  );
  return row ? { version: row.version, image: row.image, contentType: row.content_type, shareable: row.shareable } : null;
}

/** Stores the caller's new photo (pending review). The bytes were checked by the route and are checked again in SQL. */
export async function setOwnPhoto(db: Db, image: Uint8Array, contentType: PhotoContentType): Promise<OwnPhoto> {
  if (image.byteLength > photoLimits.maxBytes) throw new Error("photo over the size limit reached the service");
  await db.query("SELECT set_my_photo($1, $2)", [Buffer.from(image.buffer, image.byteOffset, image.byteLength), contentType]);
  const photo = await getOwnPhoto(db);
  if (!photo) throw new Error("set_my_photo stored no row");
  return photo;
}

export async function deleteOwnPhoto(db: Db): Promise<void> {
  await db.query("SELECT delete_my_photo()");
}

/* ------------------------------------------------------------- administrators */

interface AdminPhotoRow extends PhotoRow {
  profile_id: string;
  first_name: string | null;
  last_name: string | null;
  credentials: string | null;
  kind: AdminPhoto["kind"];
  total: number;
}

/**
 * The photo queue: pending photos oldest first; decided ones most recently
 * decided first. The administrator reads the rows through the policy, and
 * only the photos of profiles in the regions they administer (an approved
 * photo the policy shows any member is left out too).
 */
export async function listPhotos(db: Db, status: PhotoStatus, paging: { page: number; size: number }): Promise<Paged<AdminPhoto>> {
  const order = status === "pending" ? "ph.created_at ASC, ph.id" : "ph.reviewed_at DESC, ph.id";
  const rows = await db.query<AdminPhotoRow>(
    `SELECT ${META_COLUMNS}, ph.profile_id, p.first_name, p.last_name, p.credentials, p.kind::text AS kind,
            count(*) OVER ()::int AS total
       FROM profile_photos ph
       JOIN profiles p ON p.id = ph.profile_id
      WHERE ph.status = $1::photo_status AND admin_covers_profile(ph.profile_id)
      ORDER BY ${order}
      LIMIT $2 OFFSET $3`,
    [status, paging.size, (paging.page - 1) * paging.size],
  );
  let total = rows[0]?.total;
  if (total === undefined) {
    total = (await db.one<{ n: number }>("SELECT count(*)::int AS n FROM profile_photos ph WHERE ph.status = $1::photo_status AND admin_covers_profile(ph.profile_id)", [status])).n;
  }
  return {
    items: rows.map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      firstName: row.first_name,
      lastName: row.last_name,
      credentials: row.credentials,
      kind: row.kind,
      status: row.status,
      contentType: row.content_type,
      byteSize: row.byte_size,
      uploadedAt: row.created_at.toISOString(),
      reviewedAt: iso(row.reviewed_at),
      imageUrl: adminImagePath(row.id),
    })),
    total,
  };
}

/** A photo's bytes, in any state, for an administrator of the profile's region reviewing it. */
export async function getPhotoBytesForAdmin(db: Db, photoId: string): Promise<PhotoBytes | null> {
  const row = await db.maybeOne<{ id: string; image: Buffer; content_type: PhotoContentType }>(
    "SELECT ph.id, ph.image, ph.content_type FROM profile_photos ph WHERE ph.id = $1 AND admin_covers_profile(ph.profile_id)",
    [photoId],
  );
  return row ? { version: row.id, image: row.image, contentType: row.content_type, shareable: false } : null;
}

export async function reviewPhoto(db: Db, photoId: string, decision: PhotoDecision): Promise<void> {
  await db.query("SELECT admin_review_photo($1, $2::photo_status)", [photoId, decision]);
}

/* ------------------------------------------------------------------- export */

/** Notes that a photo exists, for the data export; never the bytes. */
export async function photoForExport(db: Db) {
  const row = await db.maybeOne<PhotoRow>(`SELECT ${META_COLUMNS} FROM profile_photos ph WHERE ph.profile_id = app_uid()`);
  if (!row) return null;
  return {
    status: row.status,
    contentType: row.content_type,
    byteSize: row.byte_size,
    uploadedAt: row.created_at.toISOString(),
    reviewedAt: iso(row.reviewed_at),
  };
}
