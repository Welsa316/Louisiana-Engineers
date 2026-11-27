import { z } from "zod";
import { paging } from "@shared/limits";
import { audienceIds, participationIds } from "@shared/taxonomy";
import { experienceBandIds } from "@shared/types/common";
import type { Education } from "@shared/types/profiles";
import {
  directorySorts,
  mentoringFilters,
  type DirectoryEntry,
  type DirectoryResponse,
  type DisciplineFacet,
  type ProfileView,
} from "@shared/types/directory";
import type { Db } from "../db/tx";

/**
 * Directory search and profile reads. Every query runs inside the caller's
 * `withUser` transaction and reads the `directory_entries` and
 * `profile_entries` views, so the row policies decide who sees which
 * profile; nothing here selects a contact column, `profiles.linkedin_url`,
 * the exact years of experience or `max_active`.
 */

/* --------------------------------------------------------------- query */

const slug = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "expected a slug");

const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).max(20).default([]);

/** One query string value (the last one when repeated). */
const single = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (Array.isArray(value) ? value[value.length - 1] : value), schema);

const intParam = (fallback: number, max: number) =>
  single(z.coerce.number().int().min(1).max(max).optional()).transform((value) => value ?? fallback);

export const directoryQuerySchema = z.object({
  q: single(z.string().trim().max(200).optional()),
  discipline: list(slug),
  tag: list(slug),
  topic: list(slug),
  experience: list(z.enum(experienceBandIds)),
  location: single(z.string().trim().max(80).optional()),
  verified: single(z.enum(["1", "true", "0", "false"]).optional()).transform((v) => v === "1" || v === "true"),
  mentoring: single(z.enum(mentoringFilters).optional()).transform((v) => v ?? "any"),
  audience: single(z.enum(audienceIds).optional()),
  participation: list(z.enum(participationIds)),
  sort: single(z.enum(directorySorts).optional()).transform((v) => v ?? "relevance"),
  page: intParam(1, 10_000),
  size: intParam(paging.defaultSize, paging.maxSize),
});

export type DirectorySearch = z.output<typeof directoryQuerySchema>;

const LIST_KEYS = ["discipline", "tag", "topic", "experience", "participation"] as const;

/**
 * The raw query string as the schema reads it: list filters gather every
 * `key` and `key[]` value; everything else keeps its values as given.
 */
export function readDirectoryQuery(url: string): Record<string, string | string[]> {
  const params = new URL(url).searchParams;
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const name = key.endsWith("[]") ? key.slice(0, -2) : key;
    const values = params.getAll(key);
    if ((LIST_KEYS as readonly string[]).includes(name)) {
      out[name] = [...((out[name] as string[] | undefined) ?? []), ...values.filter((v) => v !== "")];
    } else {
      out[name] = values.length === 1 ? values[0] : values;
    }
  }
  return out;
}

/* ---------------------------------------------------------- SQL pieces */

/** Search words: letters and digits only, so nothing reaches tsquery syntax. At most 8. */
export function searchTerms(q: string | undefined): string[] {
  if (!q) return [];
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
}

/** `%` and `_` match themselves in a location search. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

class Where {
  readonly clauses: string[] = [];
  constructor(readonly params: unknown[]) {}

  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  add(clause: string): void {
    this.clauses.push(clause);
  }

  sql(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(" AND ")}` : "";
  }
}

/**
 * Each word matches as a prefix, stemmed (English) or as typed (simple, which
 * is how the names are indexed), and every word must match.
 */
function tsquerySql(where: Where, terms: string[]): string {
  return terms
    .map((term) => {
      const p = where.param(`${term}:*`);
      return `(to_tsquery('english'::regconfig, ${p}) || to_tsquery('simple'::regconfig, ${p}))`;
    })
    .join(" && ");
}

/** The filters as SQL; `except` leaves one out (the facet it counts). */
function filters(where: Where, search: DirectorySearch, tsquery: string | null, except?: "discipline"): void {
  if (tsquery) where.add(`e.search_tsv @@ (${tsquery})`);
  if (except !== "discipline" && search.discipline.length) {
    where.add(`e.discipline_id = ANY (${where.param(search.discipline)}::text[])`);
  }
  if (search.tag.length) where.add(`e.tag_slugs && ${where.param(search.tag)}::text[]`);
  if (search.experience.length) where.add(`e.experience_band = ANY (${where.param(search.experience)}::text[])`);
  if (search.location) {
    where.add(`e.location ILIKE '%' || ${where.param(likeLiteral(search.location))} || '%'`);
  }
  if (search.verified) where.add("e.verified");
  if (search.participation.length) where.add(`e.participation && ${where.param(search.participation)}::text[]`);
  if (search.mentoring === "available") where.add("e.mentor_status = 'active' AND e.has_capacity");
  if (search.mentoring === "all" || search.topic.length || search.audience) {
    where.add("e.mentor_status IN ('active', 'paused')");
  }
  if (search.topic.length) where.add(`e.mentor_topics && ${where.param(search.topic)}::text[]`);
  if (search.audience) where.add(`${where.param(search.audience)} = ANY (e.audience)`);
}

function orderBy(search: DirectorySearch, rank: string | null): string {
  const tail = "e.last_name, e.first_name, e.id";
  switch (search.sort) {
    case "name":
      return tail;
    case "experience":
      // By band, never exact years: order within a band would reveal them.
      return `CASE e.experience_band WHEN '20+' THEN 4 WHEN '10-19' THEN 3 WHEN '3-9' THEN 2 WHEN '0-2' THEN 1 END DESC NULLS LAST, ${tail}`;
    case "recent":
      return `e.last_active_at DESC NULLS LAST, ${tail}`;
    case "relevance":
      if (rank) return `${rank} DESC, ${tail}`;
      return `(e.mentor_status = 'active' AND e.has_capacity) DESC, e.last_active_at DESC NULLS LAST, ${tail}`;
  }
}

/* ------------------------------------------------------------- results */

export interface EntryRow {
  id: string;
  first_name: string;
  last_name: string;
  credentials: string | null;
  title: string;
  organization: string;
  discipline_id: string;
  discipline_label: string | null;
  discipline_group: DirectoryEntry["disciplineGroup"];
  location: string | null;
  experience_band: DirectoryEntry["experienceBand"];
  verified: boolean;
  tags: string[];
  participation: DirectoryEntry["participation"];
  visibility: DirectoryEntry["visibility"];
  mentor_status: DirectoryEntry["mentorStatus"];
  mentor_topics: string[];
  audience: DirectoryEntry["audience"];
  has_capacity: boolean;
  last_active_at: Date | null;
}

/**
 * The card columns, read from `directory_entries e` (the suggested mentors
 * reuse them). Never `years_experience`, a contact column or the LinkedIn link.
 */
export const ENTRY_COLUMNS = `
  e.id, e.first_name, e.last_name, e.credentials, e.title, e.organization,
  e.discipline_id, e.discipline_label, e.discipline_group::text AS discipline_group,
  e.location, e.experience_band, e.verified, e.tags, e.participation,
  e.visibility::text AS visibility, e.mentor_status::text AS mentor_status,
  e.mentor_topics, e.audience, e.has_capacity, e.last_active_at`;

export function toEntry(row: EntryRow): DirectoryEntry {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    credentials: row.credentials,
    title: row.title,
    organization: row.organization,
    disciplineId: row.discipline_id,
    disciplineLabel: row.discipline_label,
    disciplineGroup: row.discipline_group,
    location: row.location,
    experienceBand: row.experience_band,
    verified: row.verified,
    tags: row.tags,
    participation: row.participation,
    visibility: row.visibility,
    mentorStatus: row.mentor_status,
    mentorTopics: row.mentor_topics,
    audience: row.audience,
    hasCapacity: row.has_capacity,
    lastActiveAt: row.last_active_at ? row.last_active_at.toISOString() : null,
  };
}

export async function platformPaused(db: Db): Promise<boolean> {
  const row = await db.one<{ paused: boolean }>(
    "SELECT coalesce((SELECT value = 'true'::jsonb FROM config WHERE key = 'platform_paused'), false) AS paused",
  );
  return row.paused;
}

/** `GET /api/directory`: the page of entries the caller may see, the total and the discipline counts. */
export async function searchDirectory(db: Db, search: DirectorySearch): Promise<DirectoryResponse> {
  if (await platformPaused(db)) {
    return { items: [], total: 0, facets: { disciplines: [] }, paused: true };
  }

  const terms = searchTerms(search.q);

  const listParams: unknown[] = [];
  const where = new Where(listParams);
  const tsquery = terms.length ? tsquerySql(where, terms) : null;
  filters(where, search, tsquery);
  const rank = tsquery ? `ts_rank(e.search_tsv, ${tsquery})` : null;
  const offset = (search.page - 1) * search.size;
  const limit = where.param(search.size);
  const skip = where.param(offset);
  const rows = await db.query<EntryRow>(
    `SELECT ${ENTRY_COLUMNS}
       FROM directory_entries e
       ${where.sql()}
      ORDER BY ${orderBy(search, rank)}
      LIMIT ${limit} OFFSET ${skip}`,
    listParams,
  );

  const countParams: unknown[] = [];
  const countWhere = new Where(countParams);
  filters(countWhere, search, terms.length ? tsquerySql(countWhere, terms) : null);
  const { total } = await db.one<{ total: number }>(
    `SELECT count(*)::int AS total FROM directory_entries e ${countWhere.sql()}`,
    countParams,
  );

  const facetParams: unknown[] = [];
  const facetWhere = new Where(facetParams);
  filters(facetWhere, search, terms.length ? tsquerySql(facetWhere, terms) : null, "discipline");
  const facets = await db.query<DisciplineFacet>(
    `SELECT e.discipline_id AS id, count(*)::int AS count
       FROM directory_entries e
       ${facetWhere.sql()}
      GROUP BY e.discipline_id
      ORDER BY count(*) DESC, e.discipline_id`,
    facetParams,
  );

  return { items: rows.map(toEntry), total, facets: { disciplines: facets } };
}

/* ------------------------------------------------------------- profile */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What `profile_access(id)` answers for the caller; `none` for a malformed id. */
export async function profileAccess(db: Db, id: string): Promise<"visible" | "members_only" | "none"> {
  if (!UUID_PATTERN.test(id)) return "none";
  const row = await db.one<{ access: "visible" | "members_only" | "none" }>("SELECT profile_access($1) AS access", [id]);
  return row.access;
}

interface ProfileRow {
  id: string;
  approval_state: NonNullable<ProfileView["approvalState"]>;
  visibility: ProfileView["visibility"];
  first_name: string | null;
  last_name: string | null;
  credentials: string | null;
  region: string;
  location: string | null;
  bio: string | null;
  website_url: string | null;
  title: string | null;
  organization: string | null;
  discipline_id: string | null;
  discipline_label: string | null;
  discipline_group: ProfileView["disciplineGroup"];
  experience_band: ProfileView["experienceBand"];
  verified: boolean;
  tags: string[];
  interests: string[];
  participation: ProfileView["participation"];
  mentor_status: NonNullable<ProfileView["mentorship"]>["status"] | null;
  mentor_topics: string[];
  audience: NonNullable<ProfileView["mentorship"]>["audience"];
  format: NonNullable<ProfileView["mentorship"]>["format"] | null;
  mode: NonNullable<ProfileView["mentorship"]>["mode"] | null;
  availability: string | null;
  duration_min: number | null;
  paused_until: string | null;
  has_capacity: boolean;
  last_active_at: Date | null;
  is_owner: boolean;
  saved: boolean;
}

/**
 * `GET /api/profiles/:id` for a caller `profile_access` already said may see
 * it. Null when the row is not readable after all (a policy is the last word).
 */
export async function getProfile(db: Db, id: string): Promise<ProfileView | null> {
  const row = await db.maybeOne<ProfileRow>(
    `SELECT e.id, e.approval_state::text AS approval_state, e.visibility::text AS visibility,
            e.first_name, e.last_name, e.credentials, e.region, e.location, e.bio, e.website_url,
            e.title, e.organization, e.discipline_id, e.discipline_label,
            e.discipline_group::text AS discipline_group, e.experience_band, e.verified,
            e.tags, e.interests, e.participation,
            e.mentor_status::text AS mentor_status, e.mentor_topics, e.audience,
            e.format::text AS format, e.mode::text AS mode, e.availability, e.duration_min,
            to_char(e.paused_until, 'YYYY-MM-DD') AS paused_until, e.has_capacity, e.last_active_at,
            coalesce(e.id = app_uid(), false) AS is_owner,
            EXISTS (SELECT 1 FROM saved_profiles s WHERE s.saver_id = app_uid() AND s.saved_id = e.id) AS saved
       FROM profile_entries e
      WHERE e.id = $1`,
    [id],
  );
  if (!row) return null;

  const education = await db.query<Education>(
    `SELECT degree, field, school, year
       FROM education
      WHERE profile_id = $1
      ORDER BY year DESC, degree, id`,
    [id],
  );

  return {
    id: row.id,
    isOwner: row.is_owner,
    ...(row.is_owner ? { approvalState: row.approval_state } : {}),
    visibility: row.visibility,
    firstName: row.first_name,
    lastName: row.last_name,
    credentials: row.credentials,
    region: row.region,
    location: row.location,
    bio: row.bio,
    websiteUrl: row.website_url,
    title: row.title,
    organization: row.organization,
    disciplineId: row.discipline_id,
    disciplineLabel: row.discipline_label,
    disciplineGroup: row.discipline_group,
    experienceBand: row.experience_band,
    verified: row.verified,
    tags: row.tags,
    interests: row.interests,
    participation: row.participation,
    education,
    mentorship:
      row.mentor_status && row.format && row.mode && row.duration_min !== null
        ? {
            status: row.mentor_status,
            topics: row.mentor_topics,
            audience: row.audience,
            format: row.format,
            mode: row.mode,
            availability: row.availability,
            durationMin: row.duration_min,
            pausedUntil: row.mentor_status === "paused" ? row.paused_until : null,
            hasCapacity: row.has_capacity,
          }
        : null,
    saved: row.saved,
    lastActiveAt: row.last_active_at ? row.last_active_at.toISOString() : null,
  };
}

/* ---------------------------------------------------------------- save */

export async function saveProfile(db: Db, id: string): Promise<void> {
  await db.query("SELECT save_profile($1)", [id]);
}

export async function unsaveProfile(db: Db, id: string): Promise<void> {
  await db.query("SELECT unsave_profile($1)", [id]);
}
