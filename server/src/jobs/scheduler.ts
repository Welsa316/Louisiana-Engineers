import type { Env } from "../env";
import { getPool } from "../db/pool";
import { withSystem, wrapClient, type Db } from "../db/tx";

/**
 * Background jobs, run in the server process (02 section 4.6). Each job is a
 * name, an interval and a `run`. `job_runs.locked_at` is the lock: a run
 * claims the row, so when several processes run the scheduler only one runs
 * a given job at a time. A lock older than ten minutes belongs to a run that
 * died and is taken over.
 */
export interface Job {
  name: string;
  everyMs: number;
  /**
   * The job's work. `db` is a system transaction (table owner, bypasses RLS)
   * that commits when `run` resolves and rolls back when it throws, unless
   * the job sets `transaction: false`.
   */
  run(db: Db, now: Date): Promise<unknown>;
  /**
   * `false` hands `run` a connection outside any transaction, for a job that
   * commits in short steps of its own (the email sender commits per row, so
   * one failure never undoes earlier sends).
   */
  transaction?: boolean;
}

export type JobRunResult = { status: "ran"; result: unknown } | { status: "skipped" };

/** A lock older than this belongs to a run that died; the next run takes it over. */
export const LOCK_STALE_MS = 10 * 60 * 1000;

const jobs = new Map<string, Job>();

export function registerJob(job: Job): void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(job.name)) throw new Error(`invalid job name: ${job.name}`);
  if (!(job.everyMs > 0)) throw new Error(`job ${job.name}: everyMs must be positive`);
  if (jobs.has(job.name)) throw new Error(`job already registered: ${job.name}`);
  jobs.set(job.name, job);
}

export function registeredJobs(): Job[] {
  return [...jobs.values()];
}

/** Forgets every registered job. For tests. */
export function clearJobs(): void {
  jobs.clear();
}

/**
 * Claims the job's lock row, runs the job once, and releases the lock. When
 * another run holds a lock younger than ten minutes, nothing runs and the
 * result is `skipped`. A run that throws still releases its lock and then
 * rethrows; `last_run_at` records only runs that finished.
 */
export async function runJobOnce(name: string, options: { now?: Date } = {}): Promise<JobRunResult> {
  const job = jobs.get(name);
  if (!job) {
    const known = registeredJobs().map((j) => j.name).join(", ") || "none registered";
    throw new Error(`unknown job: ${name} (${known})`);
  }

  // Short transactions of their own, so the lock is visible to other
  // processes while the job runs. The database clock decides staleness, so
  // processes with skewed clocks agree.
  const claim = await withSystem((db) =>
    db.maybeOne<{ locked_at: string }>(
      `INSERT INTO job_runs (job, locked_at) VALUES ($1, clock_timestamp())
       ON CONFLICT (job) DO UPDATE SET locked_at = EXCLUDED.locked_at
        WHERE job_runs.locked_at IS NULL
           OR job_runs.locked_at < clock_timestamp() - ($2::double precision * interval '1 millisecond')
       RETURNING locked_at::text AS locked_at`,
      [name, LOCK_STALE_MS],
    ),
  );
  if (!claim) return { status: "skipped" };

  const now = options.now ?? new Date();
  let finished = false;
  try {
    const result = job.transaction === false ? await runOutsideTransaction(job, now) : await withSystem((db) => job.run(db, now));
    finished = true;
    return { status: "ran", result };
  } catch (error) {
    console.error(`[jobs] ${name} failed`, error);
    throw error;
  } finally {
    // Release only our own claim: if this run outlived the stale window and
    // another process took the lock over, that lock is theirs.
    await withSystem((db) =>
      db.query(
        `UPDATE job_runs
            SET locked_at = NULL,
                last_run_at = CASE WHEN $3 THEN clock_timestamp() ELSE last_run_at END
          WHERE job = $1 AND locked_at = $2::timestamptz`,
        [name, claim.locked_at, finished],
      ),
    ).catch((error) => console.error(`[jobs] ${name}: releasing the lock failed`, error));
  }
}

async function runOutsideTransaction(job: Job, now: Date): Promise<unknown> {
  const client = await getPool().connect();
  let broken: Error | undefined;
  try {
    return await job.run(wrapClient(client), now);
  } catch (error) {
    // A job that failed mid-statement may leave the session in an unknown
    // state (an open transaction); do not hand that connection to anyone else.
    broken = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    client.release(broken);
  }
}

export interface SchedulerOptions {
  /** Run only these jobs; every registered job when omitted. */
  only?: string[];
  /** Interval overrides by job name. */
  everyMs?: Record<string, number>;
  /** Delay before each job's first run (default 1 second). */
  startDelayMs?: number;
}

export interface Scheduler {
  /** Stops scheduling and waits for runs in progress to finish. */
  stop(): Promise<void>;
}

/** Development sends email every few seconds so a magic link prints promptly. */
export const DEVELOPMENT_SEND_EMAILS_MS = 3_000;

/**
 * What the server process schedules. `JOBS_ENABLED` runs every registered
 * job; development without it still runs `send-emails`, because the local
 * sign-in link is read from the printed email. Anything else runs nothing.
 */
export function schedulerPlan(env: Pick<Env, "JOBS_ENABLED" | "NODE_ENV">): SchedulerOptions | null {
  const development = env.NODE_ENV === "development";
  const everyMs = development ? { "send-emails": DEVELOPMENT_SEND_EMAILS_MS } : undefined;
  if (env.JOBS_ENABLED) return everyMs ? { everyMs } : {};
  if (development) return { only: ["send-emails"], everyMs };
  return null;
}

/**
 * Runs each selected job on its interval: the next run is scheduled when the
 * previous one ends, so a slow run never overlaps itself in this process
 * (the lock row covers other processes). Errors are logged, never thrown.
 */
export function startScheduler(options: SchedulerOptions = {}): Scheduler {
  const selected = registeredJobs().filter((job) => !options.only || options.only.includes(job.name));
  for (const name of options.only ?? []) {
    if (!jobs.has(name)) console.warn(`[jobs] ${name} is not registered; not scheduled`);
  }

  let stopped = false;
  const timers = new Set<NodeJS.Timeout>();
  const running = new Set<Promise<void>>();

  const schedule = (job: Job, delay: number) => {
    if (stopped) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (stopped) return;
      const run = runJobOnce(job.name)
        .then((outcome) => {
          if (outcome.status === "skipped") console.log(`[jobs] ${job.name} skipped: another run holds the lock`);
        })
        .catch(() => {
          // runJobOnce already logged the failure; the next interval retries.
        })
        .finally(() => {
          running.delete(run);
          schedule(job, options.everyMs?.[job.name] ?? job.everyMs);
        });
      running.add(run);
    }, delay);
    timer.unref();
    timers.add(timer);
  };

  for (const job of selected) schedule(job, options.startDelayMs ?? 1_000);
  if (selected.length > 0) console.log(`[jobs] scheduled ${selected.map((job) => job.name).join(", ")}`);

  return {
    async stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await Promise.allSettled([...running]);
    },
  };
}
