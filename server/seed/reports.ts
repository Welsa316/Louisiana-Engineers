import type { Db } from "../src/db/tx";
import { SEED_ADMINS, SEED_PEOPLE } from "./profiles";
import { seedUserId } from "./users";

/**
 * The prototype's one open report: Musa Grant's profile flagged as
 * promotional while it waits in the approval queue. A pending profile is
 * visible only to administrators, so the report is filed by the second
 * seeded administrator, as a reviewer would flag it for the moderation
 * queue. Written as the table owner, like every seed module, so it sends
 * no notification. Call after `seedProfiles`.
 *
 * Re-running resets reports between seeded people: reports the seed did
 * not write (filed by hand or by an end-to-end run) are removed, and the
 * seeded one is put back open, so the daily report limit and the
 * moderation queue start from the listed state.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeedReport {
  /** The prototype id (`rep-1`); the row id is derived from it. */
  key: string;
  profile: string;
  reporter: string;
  reason: "promotional" | "misrepresentation" | "unsafe" | "spam" | "other";
  detail: string;
  /** Days from the seed run (negative is the past). */
  createdDays: number;
}

export const SEED_REPORTS: SeedReport[] = [
  {
    key: "rep-1",
    profile: "musa-grant",
    reporter: "admin2",
    reason: "promotional",
    detail: "Bio reads like an advertisement and offers a free consultation rather than mentorship.",
    createdDays: -3,
  },
];

/** A stable id for a seeded report. */
export function seedReportId(key: string): string {
  return seedUserId(`report:${key}`);
}

/** Writes the seeded reports. Call after `seedProfiles`. */
export async function seedReports(db: Db): Promise<void> {
  const base = Date.now();
  const ids = SEED_REPORTS.map((r) => seedReportId(r.key));
  const people = [...SEED_PEOPLE, ...SEED_ADMINS].map((person) => seedUserId(person.key));
  const present = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM profiles WHERE id = ANY ($1::uuid[])", [people]);
  if (present.n !== people.length) throw new Error("seed: seedReports runs after seedProfiles");

  await db.query(
    `DELETE FROM reports r
      WHERE NOT (r.id = ANY ($1::uuid[]))
        AND (r.profile_id = ANY ($2::uuid[]) OR r.reporter_id = ANY ($2::uuid[]))`,
    [ids, people],
  );

  for (const report of SEED_REPORTS) {
    await db.query(
      `INSERT INTO reports (id, profile_id, reporter_id, reason, detail, status, created_at)
       VALUES ($1, $2, $3, $4::report_reason, $5, 'open', $6)
       ON CONFLICT (id) DO UPDATE
         SET profile_id = EXCLUDED.profile_id,
             reporter_id = EXCLUDED.reporter_id,
             reason = EXCLUDED.reason,
             detail = EXCLUDED.detail,
             status = 'open',
             resolved_by = NULL,
             resolution_note = NULL,
             action = NULL,
             resolved_at = NULL,
             created_at = EXCLUDED.created_at`,
      [
        seedReportId(report.key),
        seedUserId(report.profile),
        seedUserId(report.reporter),
        report.reason,
        report.detail,
        new Date(base + report.createdDays * DAY_MS),
      ],
    );
  }
}
