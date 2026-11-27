import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "../../src/db/pool";
import { asSystem, asUser } from "../harness";

/**
 * Arranges `users` and `profiles` rows as the table owner, the way the auth
 * module and the seed do, so policy tests can then read them as `app_user`.
 */
export interface PersonOptions {
  email?: string;
  verified?: boolean;
  kind?: "student" | "professional" | null;
  approval?: "pending" | "approved" | "declined";
  visibility?: "public" | "members" | "hidden";
  adminHidden?: boolean;
  anonymized?: boolean;
  suspended?: boolean;
  deleted?: boolean;
  admin?: boolean;
  firstName?: string;
  lastName?: string;
  /** Professionals only; defaults to a 120-character placeholder (required once details exist). */
  bio?: string | null;
  /**
   * Professionals get a `professional_details` row (the directory rule reads
   * its participation) unless this is false. Defaults to `["directory"]`.
   */
  participation?: string[] | false;
  title?: string;
  organization?: string;
  disciplineId?: string;
  yearsExperience?: number;
}

export const FIXTURE_BIO =
  "I work on drainage, levees and the long arithmetic of keeping water where it belongs, and I am happy to talk about any of it with anyone.";

export async function makePerson(pool: Pool, options: PersonOptions = {}): Promise<string> {
  const id = randomUUID();
  await asSystem(pool, async (client) => {
    await client.query(
      `INSERT INTO users (id, email, email_verified_at, suspended_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        options.deleted ? null : (options.email ?? `${id}@example.test`),
        options.verified === false ? null : new Date(),
        options.suspended ? new Date() : null,
        options.deleted ? new Date() : null,
      ],
    );
    const kind = options.kind === undefined ? "professional" : options.kind;
    const bio = options.bio === undefined ? (kind === "professional" ? FIXTURE_BIO : null) : options.bio;
    await client.query(
      `INSERT INTO profiles (id, first_name, last_name, kind, approval_state, visibility, admin_hidden_at, anonymized_at, bio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        options.firstName ?? "Test",
        options.lastName ?? `Person ${id.slice(0, 8)}`,
        kind,
        options.approval ?? "approved",
        options.visibility ?? "public",
        options.adminHidden ? new Date() : null,
        options.anonymized ? new Date() : null,
        bio,
      ],
    );
    if (kind === "professional" && options.participation !== false) {
      await client.query(
        `INSERT INTO professional_details (profile_id, title, organization, discipline_id, years_experience, participation)
         VALUES ($1, $2, $3, $4, $5, $6::participation[])`,
        [
          id,
          options.title ?? "Engineer",
          options.organization ?? "Bayou Works",
          options.disciplineId ?? "civil",
          options.yearsExperience ?? 5,
          options.participation ?? ["directory"],
        ],
      );
    }
    if (options.admin) {
      await client.query("INSERT INTO admin_roles (profile_id) VALUES ($1)", [id]);
    }
  });
  return id;
}

/** Profile ids `userId` (null for a visitor) can read, sorted. */
export async function visibleProfileIds(pool: Pool, userId: string | null): Promise<string[]> {
  return asUser(pool, userId, async (client) => {
    const result = await client.query<{ id: string }>("SELECT id FROM profiles ORDER BY id");
    return result.rows.map((row) => row.id);
  });
}

/** One scalar from a query run as `userId`. */
export async function scalarAs<T>(pool: Pool, userId: string | null, sql: string, params: unknown[] = []): Promise<T> {
  return asUser(pool, userId, async (client: PoolClient) => {
    const result = await client.query<{ value: T }>(sql, params);
    return result.rows[0].value;
  });
}

export function sorted(ids: string[]): string[] {
  return [...ids].sort();
}

/* ------------------------------------------------------------- onboarding */

/** A complete professional onboarding payload (the zod output shape `complete_onboarding` takes). */
export function professionalPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "professional",
    acceptMission: true,
    firstName: "Noor",
    lastName: "Bayou",
    credentials: "PE",
    location: "New Orleans, LA",
    bio: FIXTURE_BIO,
    title: "Water Resources Engineer",
    organization: "Delta Drainage Partners",
    disciplineId: "coastal",
    yearsExperience: 12,
    expertise: ["Hydraulic modeling", "Levee design"],
    interests: ["Living shorelines"],
    education: [{ degree: "BS", field: "Civil Engineering", school: "A Louisiana university", year: 2012 }],
    participation: ["directory", "networking", "mentoring"],
    mentorship: {
      topics: ["professional-licensure", "internships-and-first-jobs"],
      audience: ["undergrad", "early-career"],
      format: "either",
      mode: "online",
      availabilityText: "Weekday evenings",
      durationMin: 45,
    },
    visibility: "public",
    contact: { methods: ["mest", "email"], shareWithMembers: ["email"] },
    ...overrides,
  };
}

/** A complete student onboarding payload. */
export function studentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "student",
    acceptMission: true,
    firstName: "Sami",
    lastName: "River",
    location: "Kenner, LA",
    program: "BS Civil Engineering, junior",
    level: "undergrad",
    institution: "A Louisiana research university",
    goals: "Find a coastal internship and understand the path to a license.",
    interests: ["Hydraulics"],
    topicsNeeded: ["internships-and-first-jobs"],
    ...overrides,
  };
}

/** A signed-in account that has not onboarded yet (what the first sign-in creates). */
export function newAccount(pool: Pool, options: PersonOptions = {}): Promise<string> {
  return makePerson(pool, { kind: null, approval: "pending", ...options });
}

/** Runs `complete_onboarding` as `userId`. */
export function onboard(pool: Pool, userId: string, payload: Record<string, unknown>): Promise<void> {
  return asUser(pool, userId, async (client) => {
    await client.query("SELECT complete_onboarding($1::jsonb)", [JSON.stringify(payload)]);
  });
}

/** Rows of `sql` run as `userId` (null for a visitor). */
export function rowsAs<T extends Record<string, unknown> = Record<string, unknown>>(
  pool: Pool,
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asUser(pool, userId, async (client) => (await client.query<T>(sql, params)).rows);
}

/** Runs one statement as `userId`; for asserting that it is refused. */
export function runAs(pool: Pool, userId: string | null, sql: string, params: unknown[] = []): Promise<unknown> {
  return asUser(pool, userId, (client) => client.query(sql, params));
}
