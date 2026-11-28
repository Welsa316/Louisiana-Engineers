import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { registerJob, registeredJobs, runJobOnce } from "./scheduler";
import { completePastMeetingsJob } from "./complete-past-meetings";
import { deletionsJob } from "./deletions";
import { adminDigestJob } from "./digest";
import { expireRequestsJob } from "./expire-requests";
import { meetingCheckInJob } from "./meeting-check-in";
import { remindersJob } from "./reminders";
import { resumePausedJob } from "./resume-paused";
import { retentionJob } from "./retention";
import { sendEmailsJob } from "./send-emails";

/**
 * Registers every background job. Each job lives in its own
 * `server/src/jobs/<name>.ts`; this file only registers them, one line per
 * job, and is edited only when jobs are integrated. The scheduler (Task 10)
 * starts what is registered here when `JOBS_ENABLED` is set.
 */
export function registerJobs(): void {
  registerJob(sendEmailsJob);
  registerJob(expireRequestsJob);
  registerJob(remindersJob);
  registerJob(resumePausedJob);
  registerJob(retentionJob);
  registerJob(adminDigestJob);
  registerJob(deletionsJob);
  registerJob(completePastMeetingsJob);
  registerJob(meetingCheckInJob);
}

/** `npm run job -- <name>` runs one job once, under the same lock as the scheduler. */
async function main(): Promise<void> {
  const name = process.argv[2];
  registerJobs();
  if (!name) {
    const known = registeredJobs().map((job) => job.name).join(", ") || "none registered";
    console.error(`[jobs] usage: npm run job -- <name> (${known})`);
    process.exit(1);
  }
  const { closePool } = await import("../db/pool");
  try {
    const outcome = await runJobOnce(name);
    console.log(
      outcome.status === "ran"
        ? `[jobs] ${name} ran: ${JSON.stringify(outcome.result ?? null)}`
        : `[jobs] ${name} skipped: another run holds the lock`,
    );
  } finally {
    await closePool();
  }
}

// Only when this file is the entry point. The server bundle inlines this
// module into dist/index.js, where import.meta.url is the bundle's own URL
// and equals argv[1], so the check also requires the source file name.
const self = fileURLToPath(import.meta.url);
const invokedDirectly =
  self.endsWith(`${sep}jobs${sep}index.ts`) && process.argv[1] !== undefined && resolve(process.argv[1]) === self;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
