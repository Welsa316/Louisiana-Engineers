import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getMimeType } from "hono/utils/mime";
import type { Pool } from "./db/pool";
import { apiErrorHandler, apiNotFound } from "./http/errors";
import { createApiRoutes } from "./routes/index";

export interface AppOptions {
  /** The built web app (`vite build` output). */
  webDist: string;
  pool: Pool;
  /** Re-read index.html on every request (development); otherwise cache it. */
  cacheIndex?: boolean;
}

/**
 * Static files served from the web build. Only these prefixes exist; any
 * other path outside `/api` and `/network` is a real 404, so a typo never
 * returns the app shell.
 */
const STATIC_PREFIXES = ["/assets/", "/images/", "/fonts/", "/logo/"];
const STATIC_FILES = new Set(["/favicon.svg", "/og.jpg", "/apple-touch-icon.png"]);

export function createApp({ webDist, pool, cacheIndex = true }: AppOptions): Hono {
  const app = new Hono();
  const indexPath = resolve(webDist, "index.html");
  let indexHtml: Promise<string> | undefined;

  const readIndex = (): Promise<string> => {
    if (!cacheIndex) return readFile(indexPath, "utf8");
    if (!indexHtml) {
      indexHtml = readFile(indexPath, "utf8").catch((error) => {
        indexHtml = undefined;
        throw error;
      });
    }
    return indexHtml;
  };

  app.get("/api/health", async (c) => {
    try {
      const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations");
      return c.json({ ok: true, migrations: Number(result.rows[0].count) });
    } catch (error) {
      console.error("[health] database check failed", error);
      return c.json({ ok: false, migrations: 0 }, 503);
    }
  });

  app.route("/api", createApiRoutes());
  app.all("/api", apiNotFound);
  app.all("/api/*", apiNotFound);

  app.get("/", async (c) => c.html(await readIndex(), 200, { "Cache-Control": "no-cache" }));
  app.get("/network", async (c) => c.html(await readIndex(), 200, { "Cache-Control": "no-cache" }));
  app.get("/network/*", async (c) => c.html(await readIndex(), 200, { "Cache-Control": "no-cache" }));

  app.get("*", async (c, next) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return next(); // malformed escape: not a file we serve
    }
    // Encoded slashes survive URL normalisation, so check the decoded path:
    // no backslashes, no ".." segments, and the file must stay inside the
    // directory its prefix names.
    if (pathname.includes("\\") || pathname.split("/").includes("..")) return next();
    const prefix = STATIC_PREFIXES.find((p) => pathname.startsWith(p));
    if (!prefix && !STATIC_FILES.has(pathname)) return next();

    const file = resolve(webDist, `.${pathname}`);
    const root = prefix ? resolve(webDist, `.${prefix}`) : webDist;
    if (!file.startsWith(root + sep)) return next();
    let info;
    try {
      info = await stat(file);
    } catch {
      return next();
    }
    if (!info.isFile()) return next();

    const immutable = pathname.startsWith("/assets/");
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: {
        "Content-Type": getMimeType(file) ?? "application/octet-stream",
        "Content-Length": String(info.size),
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      },
    });
  });

  app.notFound((c) => c.text("Not found", 404));
  app.onError((error, c) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return apiErrorHandler(error, c);
    console.error("[http] unhandled error", error);
    return c.text("Internal error", 500);
  });

  return app;
}

async function main(): Promise<void> {
  const { env } = await import("./env");
  const { getPool, closePool } = await import("./db/pool");
  const { runMigrations } = await import("./db/migrate");
  const { webDist } = await import("./paths");

  const pool = getPool();
  const migrated = await runMigrations(pool);
  for (const name of migrated.applied) console.log(`[db] applied ${name}`);

  const app = createApp({ webDist: webDist(), pool, cacheIndex: env.NODE_ENV === "production" });
  const hostname = env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
  const server = serve({ fetch: app.fetch, port: env.PORT, hostname }, (info) => {
    console.log(`[http] listening on http://${info.address}:${info.port} (${env.NODE_ENV})`);
  });

  // Background jobs: everything registered when JOBS_ENABLED; in development
  // the email sender always runs, so a local magic link prints to this log.
  const { registerJobs } = await import("./jobs/index");
  const { schedulerPlan, startScheduler } = await import("./jobs/scheduler");
  const plan = schedulerPlan(env);
  let scheduler: { stop(): Promise<void> } | undefined;
  if (plan) {
    registerJobs();
    scheduler = startScheduler(plan);
  }

  const shutdown = (signal: string) => {
    console.log(`[http] ${signal} received, closing`);
    // No new job runs start; the one in progress finishes before the pool closes.
    const jobsStopped = scheduler?.stop() ?? Promise.resolve();
    server.close(() => {
      jobsStopped
        .then(() => closePool())
        .catch((error) => console.error("[db] close failed", error))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
