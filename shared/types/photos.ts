/**
 * Profile photos (Task 33): `/api/me/photo`, `/api/photos/:profileId` and
 * the administrators' queue at `/api/admin/photos`. A photo is shown only
 * once an administrator approves it, and only to callers who may see the
 * profile; initials stay the default everywhere else.
 */

import type { photoLimits } from "../limits";
import type { ProfileKind } from "./common";

export const photoStatuses = ["pending", "approved", "rejected"] as const;
export type PhotoStatus = (typeof photoStatuses)[number];

/** What an administrator may decide; `pending` is only where a photo starts. */
export const photoDecisions = ["approved", "rejected"] as const satisfies readonly PhotoStatus[];
export type PhotoDecision = (typeof photoDecisions)[number];

export type PhotoContentType = (typeof photoLimits.contentTypes)[number];

/**
 * Where an approved photo is served. `version` is the photo's id, so a new
 * upload is a new URL and a cached copy of the old one is never shown.
 */
export function photoUrl(profileId: string, version: string): string {
  return `/api/photos/${profileId}?v=${version}`;
}

/** The owner's own photo, in any state. */
export interface OwnPhoto {
  id: string;
  status: PhotoStatus;
  contentType: PhotoContentType;
  byteSize: number;
  uploadedAt: string;
  reviewedAt: string | null;
  /** The owner-only image (`/api/me/photo/image`), which works before approval too. */
  imageUrl: string;
}

/** `GET`, `POST` and `DELETE /api/me/photo`. */
export interface OwnPhotoResponse {
  photo: OwnPhoto | null;
}

/** One row of the administrators' photo queue. No contact value or address. */
export interface AdminPhoto {
  id: string;
  profileId: string;
  firstName: string | null;
  lastName: string | null;
  credentials: string | null;
  kind: ProfileKind | null;
  status: PhotoStatus;
  contentType: PhotoContentType;
  byteSize: number;
  uploadedAt: string;
  reviewedAt: string | null;
  /** Any status, administrators only (`/api/admin/photos/:id/image`). */
  imageUrl: string;
}
