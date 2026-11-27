import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mailer, OutgoingEmail } from "../../src/email/resend";
import {
  LOCK_STALE_MS,
  clearJobs,
  registerJob,
  runJobOnce,
  schedulerPlan,
  startScheduler,
  type Job,
} from "../../src/jobs/scheduler";
import { createSendEmailsJob } from "../../src/jobs/send-emails";
import { asSystem, createTestDb, truncateAll, type TestDb } from "../harness";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await truncateAll(db.pool);
  clearJobs();
});

afterEach(() => {
  clearJobs();
});

interface JobRow {
  job: string;
  locked_at: Date | null;
  last_run_at: Date | null;
}

async function jobRow(name: string): Promise<JobRow | undefined> {
  const result = await db.pool.query<JobRow>("SELECT job, locked_at, last_run_at FROM job_runs WHERE job = $1", [name]);
  return result.rows[0];
}

/** Puts a lock on `name` taken `ageMs` ago, as another process would have. */
async function lockedAgo(name: string, ageMs: number): Promise<void> {
  await db.pool.query(
    `INSERT INTO job_runs (job, locked_at) VALUES ($1, now() - ($2::double precision * interval '1 millisecond'))
     ON CONFLICT (job) DO UPDATE SET locked_at = EXCLUDED.locked_at`,
    [name, ageMs],
  );
}

function spyJob(name: string, run: Job["run"] = async () => "done"): Job & { run: ReturnType<typeof vi.fn> } {
  return { name, everyMs: 60_000, run: vi.fn(run) };
}

describe("scheduler", () => {
  it("scheduler_skips_when_locked", async () => {
    const job = spyJob("probe");
    registerJob(job);
    await lockedAgo("probe", 60_000); // another process took it a minute ago
    const before = await jobRow("probe");

    const result = await runJobOnce("probe");

    expect(result).toEqual({ status: "skipped" });
    expect(job.run).not.toHaveBeenCalled();
    // The other process's lock is left exactly as it was.
    const after = await jobRow("probe");
    expect(after?.locked_at?.getTime()).toBe(before?.locked_at?.getTime());
    expect(after?.last_run_at).toBeNull();
  });

  it("scheduler_runs_stale_lock", async () => {
    const job = spyJob("probe");
    registerJob(job);
    await lockedAgo("probe", LOCK_STALE_MS + 60_000); // a crashed run eleven minutes ago

    const now = new Date("2026-11-23T12:00:00Z");
    const result = await runJobOnce("probe", { now });

    expect(result).toEqual({ status: "ran", result: "done" });
    expect(job.run).toHaveBeenCalledTimes(1);
    expect(job.run.mock.calls[0][1]).toBe(now);
    // The run released its lock and recorded when it finished.
    const after = await jobRow("probe");
    expect(after?.locked_at).toBeNull();
    expect(after?.last_run_at).not.toBeNull();
  });

  it("scheduler_lock_is_released_when_a_run_throws_and_free_runs_proceed", async () => {
    let fail = true;
    const job = spyJob("probe", async () => {
      if (fail) throw new Error("boom");
      return "ok";
    });
    registerJob(job);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // First run ever: no job_runs row yet.
      await expect(runJobOnce("probe")).rejects.toThrow("boom");
      const failed = await jobRow("probe");
      expect(failed?.locked_at).toBeNull();
      expect(failed?.last_run_at).toBeNull();
    } finally {
      error.mockRestore();
    }

    fail = false;
    expect(await runJobOnce("probe")).toEqual({ status: "ran", result: "ok" });
    expect((await jobRow("probe"))?.last_run_at).not.toBeNull();
  });

  it("scheduler_runs_jobs_inside_a_system_transaction_that_rolls_back_on_throw", async () => {
    registerJob(
      spyJob("writer", async (tx) => {
        await tx.query("INSERT INTO job_runs (job) VALUES ('marker')");
        throw new Error("after the write");
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(runJobOnce("writer")).rejects.toThrow("after the write");
    } finally {
      error.mockRestore();
    }
    expect(await jobRow("marker")).toBeUndefined();
  });

  it("scheduler_refuses_unknown_and_duplicate_jobs", async () => {
    await expect(runJobOnce("nothing")).rejects.toThrow(/unknown job: nothing/);
    registerJob(spyJob("probe"));
    expect(() => registerJob(spyJob("probe"))).toThrow(/already registered/);
  });

  it("scheduler_loop_runs_each_job_and_stops_cleanly", async () => {
    const job: Job & { run: ReturnType<typeof vi.fn> } = { name: "tick", everyMs: 20, run: vi.fn(async () => "t") };
    registerJob(job);
    registerJob(spyJob("other"));
    const scheduler = startScheduler({ only: ["tick"], startDelayMs: 0 });
    await vi.waitFor(() => expect(job.run.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 5_000 });
    await scheduler.stop();
    const calls = job.run.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(job.run.mock.calls.length).toBe(calls);
    expect((await jobRow("tick"))?.locked_at).toBeNull();
    expect(await jobRow("other")).toBeUndefined();
  });

  it("scheduler_plan_follows_jobs_enabled_and_development", () => {
    expect(schedulerPlan({ JOBS_ENABLED: true, NODE_ENV: "production" })).toEqual({});
    expect(schedulerPlan({ JOBS_ENABLED: false, NODE_ENV: "production" })).toBeNull();
    expect(schedulerPlan({ JOBS_ENABLED: false, NODE_ENV: "test" })).toBeNull();
    // Development always sends email, quickly, so a magic link prints.
    const dev = schedulerPlan({ JOBS_ENABLED: false, NODE_ENV: "development" });
    expect(dev?.only).toEqual(["send-emails"]);
    expect(dev?.everyMs?.["send-emails"]).toBeLessThanOrEqual(5_000);
    const devAll = schedulerPlan({ JOBS_ENABLED: true, NODE_ENV: "development" });
    expect(devAll?.only).toBeUndefined();
    expect(devAll?.everyMs?.["send-emails"]).toBeLessThanOrEqual(5_000);
  });
});

/** Records what it was given; throws for addresses listed in `refuse`. */
function recordingMailer(refuse: string[] = []): Mailer & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    kind: "resend",
    sent,
    async send(message) {
      if (refuse.includes(message.to)) throw new Error(`provider refused ${message.to}`);
      sent.push(message);
    },
  };
}

async function enqueue(to: string, title = "Hello"): Promise<string> {
  return asSystem(db.pool, async (client) => {
    const result = await client.query<{ id: string }>("SELECT enqueue_email($1, 'default', $2::jsonb) AS id", [
      to,
      JSON.stringify({ title, body: "Open MEST Network to see it.", link: "/network/me" }),
    ]);
    // Distinct, ordered creation times so "oldest first" is unambiguous.
    await client.query("UPDATE email_outbox SET created_at = clock_timestamp() WHERE id = $1", [result.rows[0].id]);
    return result.rows[0].id;
  });
}

interface OutboxRow {
  to_email: string;
  attempts: number;
  last_error: string | null;
  sent_at: Date | null;
}

async function outbox(): Promise<Record<string, OutboxRow>> {
  const result = await db.pool.query<OutboxRow>(
    "SELECT to_email::text, attempts, last_error, sent_at FROM email_outbox ORDER BY created_at",
  );
  return Object.fromEntries(result.rows.map((row) => [row.to_email, row]));
}

describe("send-emails job", () => {
  it("send_emails_job_drains_outbox", async () => {
    const mailer = recordingMailer();
    const job = createSendEmailsJob({ mailer });
    expect(job.name).toBe("send-emails");
    expect(job.everyMs).toBe(60_000);
    registerJob(job);
    for (const to of ["a@example.test", "b@example.test", "c@example.test"]) await enqueue(to);

    const result = await runJobOnce("send-emails");

    expect(result).toEqual({ status: "ran", result: { sent: 3, failed: 0, gaveUp: 0, errored: 0 } });
    expect(mailer.sent.map((m) => m.to)).toEqual(["a@example.test", "b@example.test", "c@example.test"]);
    expect(mailer.sent[0].text).toContain("Open MEST Network to see it.");
    const rows = await outbox();
    expect(Object.values(rows).every((row) => row.sent_at !== null)).toBe(true);

    // A second run finds nothing to send and sends nothing twice.
    expect(await runJobOnce("send-emails")).toEqual({
      status: "ran",
      result: { sent: 0, failed: 0, gaveUp: 0, errored: 0 },
    });
    expect(mailer.sent).toHaveLength(3);
  });

  it("send_emails_job_keeps_earlier_rows_sent_when_a_later_row_fails", async () => {
    const mailer = recordingMailer();
    registerJob(createSendEmailsJob({ mailer }));
    for (const to of ["one@example.test", "two@example.test", "three@example.test", "four@example.test"]) {
      await enqueue(to);
    }
    // Row 3's "mark sent" statement fails after the provider accepted it, the
    // way a dropped connection or a constraint would.
    await db.pool.query(`
      CREATE FUNCTION test_fail_marking_three() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'marking row three failed'; END $$;
      CREATE TRIGGER test_fail_marking_three BEFORE UPDATE ON email_outbox FOR EACH ROW
        WHEN (NEW.sent_at IS NOT NULL AND OLD.sent_at IS NULL AND NEW.to_email = 'three@example.test')
        EXECUTE FUNCTION test_fail_marking_three();
    `);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await runJobOnce("send-emails");
      expect(result).toEqual({ status: "ran", result: { sent: 3, failed: 0, gaveUp: 0, errored: 1 } });
    } finally {
      error.mockRestore();
      await db.pool.query(`
        DROP TRIGGER test_fail_marking_three ON email_outbox;
        DROP FUNCTION test_fail_marking_three();
      `);
    }

    const rows = await outbox();
    // Rows 1 and 2 stay marked: their sends are not rolled back by row 3.
    expect(rows["one@example.test"].sent_at).not.toBeNull();
    expect(rows["two@example.test"].sent_at).not.toBeNull();
    // Row 3 counts one attempt and is tried again on a later run.
    expect(rows["three@example.test"]).toMatchObject({ sent_at: null, attempts: 1 });
    expect(rows["three@example.test"].last_error).toContain("marking row three failed");
    // The run carried on past the failure.
    expect(rows["four@example.test"].sent_at).not.toBeNull();

    expect(await runJobOnce("send-emails")).toEqual({
      status: "ran",
      result: { sent: 1, failed: 0, gaveUp: 0, errored: 0 },
    });
    expect((await outbox())["three@example.test"].sent_at).not.toBeNull();
  });

  it("send_emails_job_tries_a_refused_row_once_per_run", async () => {
    const mailer = recordingMailer(["refused@example.test"]);
    registerJob(createSendEmailsJob({ mailer }));
    await enqueue("refused@example.test");
    await enqueue("fine@example.test");

    expect(await runJobOnce("send-emails")).toEqual({
      status: "ran",
      result: { sent: 1, failed: 1, gaveUp: 0, errored: 0 },
    });
    // One attempt per run, not all three at once: a provider outage gets
    // a minute between tries.
    expect((await outbox())["refused@example.test"]).toMatchObject({ attempts: 1, sent_at: null });

    await runJobOnce("send-emails");
    expect(await runJobOnce("send-emails")).toEqual({
      status: "ran",
      result: { sent: 0, failed: 1, gaveUp: 1, errored: 0 },
    });
    expect((await outbox())["refused@example.test"]).toMatchObject({ attempts: 3, sent_at: null });
    expect(await runJobOnce("send-emails")).toEqual({
      status: "ran",
      result: { sent: 0, failed: 0, gaveUp: 0, errored: 0 },
    });
  });

  it("send_emails_job_respects_the_batch_size", async () => {
    const mailer = recordingMailer();
    registerJob(createSendEmailsJob({ mailer, batchSize: 2 }));
    for (const to of ["p0@example.test", "p1@example.test", "p2@example.test"]) await enqueue(to);

    expect(await runJobOnce("send-emails")).toMatchObject({ status: "ran", result: { sent: 2 } });
    expect(mailer.sent.map((m) => m.to)).toEqual(["p0@example.test", "p1@example.test"]);
    expect(await runJobOnce("send-emails")).toMatchObject({ status: "ran", result: { sent: 1 } });
  });
});
