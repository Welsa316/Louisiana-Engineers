import { z } from "zod";
import { photoDecisions, photoStatuses } from "../types/photos";
import { pageQuerySchema } from "./common";

/** `POST /api/admin/photos/:id`. */
export const adminPhotoDecisionSchema = z.object({ decision: z.enum(photoDecisions) }).strict();
export type AdminPhotoDecisionInput = z.infer<typeof adminPhotoDecisionSchema>;

/** `GET /api/admin/photos?status&page&size`; the queue (pending) by default. */
export const adminPhotosQuerySchema = pageQuerySchema.extend({ status: z.enum(photoStatuses).default("pending") });
