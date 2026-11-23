import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Registers every background job. Each job lives in its own
 * `server/src/jobs/<name>.ts`; this file only registers them, one line per
 * job, and is edited only when jobs are integrated. The scheduler (Task 10)
 * starts what is registered here when `JOBS_ENABLED` is set.
 */
export function registerJobs(): void {
  // No jobs yet.
}

/** `npm run job -- <name>` runs one job once. */
async function main(): Promise<void> {
  const name = process.argv[2];
  registerJobs();
  console.error(name ? `[jobs] unknown job: ${name}` : "[jobs] usage: npm run job -- <name>");
  process.exit(1);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
