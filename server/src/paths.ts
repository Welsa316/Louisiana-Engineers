import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The server directory, found from this module's own location so that the
 * same code works from `server/src/*` (tsx), `server/dist/index.js` (the
 * esbuild bundle) and the Docker image, whatever the working directory is.
 * The marker is the `migrations` folder, which every deployment ships.
 */
let cached: string | undefined;

export function serverRoot(): string {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(resolve(dir, "migrations"))) {
      cached = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find the server directory (no migrations folder above " + import.meta.url + ")");
}

/** The built web app (`vite build` output) next to the server directory. */
export function webDist(): string {
  return resolve(serverRoot(), "..", "dist");
}
