/**
 * Sign-in request bodies. The address is trimmed and length-checked here;
 * Postgres compares it case-insensitively (`citext`).
 */

import { z } from "zod";
import { emailSchema } from "./common";

/** `POST /api/auth/magic-link` */
export const magicLinkSchema = z.object({ email: emailSchema });
export type MagicLinkInput = z.output<typeof magicLinkSchema>;

/** `POST /api/auth/dev-login` (registered only when `NODE_ENV = 'test'`). */
export const devLoginSchema = z.object({ email: emailSchema });
export type DevLoginInput = z.output<typeof devLoginSchema>;
