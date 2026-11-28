import { Hono } from "hono";
import type { PublicConfig } from "@shared/types/auth";
import type { PublicVocabulary, VocabularyRegion, VocabularyTopic } from "@shared/types/vocabulary";
import { withUser } from "../db/tx";
import { env } from "../env";

/**
 * `/api/config/public`: what the sign-in screen, the app shell and onboarding
 * need before anyone signs in; `/api/config/vocabulary`: the topics members
 * choose from and the regions the network serves. Mounted by the aggregator
 * at `/config`.
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
    const { paused, default_max_active } = await withUser(null, (db) =>
      db.one<{ paused: boolean; default_max_active: number }>(
        `SELECT coalesce((SELECT value = 'true'::jsonb FROM config WHERE key = 'platform_paused'), false) AS paused,
                coalesce((SELECT (value #>> '{}')::int FROM config WHERE key = 'default_max_active'), 3) AS default_max_active`,
      ),
    );
    return c.json<PublicConfig>({ googleEnabled, platformPaused: paused, defaultMaxActive: default_max_active });
  });

  /**
   * The active mentorship topics, so onboarding and settings offer the ones
   * administrators add, and the active regions for the directory, the
   * members filter, onboarding and settings.
   */
  app.get("/vocabulary", async (c) => {
    const { topics, regions } = await withUser(null, async (db) => ({
      topics: await db.query<VocabularyTopic>("SELECT id, label FROM mentorship_topics WHERE active ORDER BY sort_order, id"),
      regions: await db.query<VocabularyRegion>("SELECT id, label FROM regions WHERE active ORDER BY sort_order, id"),
    }));
    return c.json<PublicVocabulary>({ topics, regions });
  });

  return app;
}

export const configRoutes = createConfigRoutes();
