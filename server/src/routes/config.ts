import { Hono } from "hono";
import type { PublicConfig } from "@shared/types/auth";
import { withUser } from "../db/tx";
import { env } from "../env";

/**
 * `/api/config/public`: what the sign-in screen and the app shell need before
 * anyone signs in. Mounted by the aggregator at `/config`.
 */

export interface ConfigRouteOptions {
  googleClientId?: string;
  googleClientSecret?: string;
}

export function createConfigRoutes(
  options: ConfigRouteOptions = { googleClientId: env.GOOGLE_CLIENT_ID, googleClientSecret: env.GOOGLE_CLIENT_SECRET },
): Hono {
  const googleEnabled = Boolean(options.googleClientId && options.googleClientSecret);
  const app = new Hono();

  app.get("/public", async (c) => {
    const { paused } = await withUser(null, (db) =>
      db.one<{ paused: boolean }>(
        "SELECT coalesce((SELECT value = 'true'::jsonb FROM config WHERE key = 'platform_paused'), false) AS paused",
      ),
    );
    return c.json<PublicConfig>({ googleEnabled, platformPaused: paused });
  });

  return app;
}

export const configRoutes = createConfigRoutes();
