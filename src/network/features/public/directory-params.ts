/**
 * The directory's filters live in the page URL, so a search can be shared,
 * reloaded and walked back with the browser's Back button. This module turns
 * the URL into the filter model the shared panel uses (src/network/ui/
 * directory.tsx) plus the filters the app adds (verified, location, region),
 * and turns that back into the URL and into the `/api/directory` query.
 *
 * Page URL, all optional:
 *   q, discipline (repeated), topic (repeated), experience (repeated),
 *   mentoring = any | available | all, networking = 1, verified = 1,
 *   location, region, sort (omitted for relevance), page (omitted for 1)
 *
 * A screen may preset `mentoring` (Find mentors starts at `available`); the
 * URL then names `mentoring` only when it differs from the preset.
 */

import { experienceBandIds, type ExperienceBandId } from "@shared/types/common";
import { directorySorts, type DirectorySort, type MentoringFilter } from "@shared/types/directory";
import { EMPTY_FILTERS, type Filters, type MentorFilter } from "../../ui/directory";

export const DIRECTORY_PAGE_SIZE = 24;

export interface DirectoryState {
  filters: Filters;
  verified: boolean;
  location: string;
  /** A region slug, or "" for every region. */
  region: string;
  page: number;
}

export interface DirectoryDefaults {
  mentorship: MentorFilter;
}

const toApiMentoring: Record<MentorFilter, MentoringFilter> = {
  any: "any",
  available: "available",
  "all-mentors": "all",
};

const fromUrlMentoring: Record<string, MentorFilter> = {
  any: "any",
  available: "available",
  all: "all-mentors",
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function slugs(params: URLSearchParams, key: string): string[] {
  return [...new Set(params.getAll(key).filter((value) => SLUG.test(value)))].slice(0, 20);
}

function isBand(value: string): value is ExperienceBandId {
  return (experienceBandIds as readonly string[]).includes(value);
}

function isSort(value: string | null): value is DirectorySort {
  return value !== null && (directorySorts as readonly string[]).includes(value);
}

export function readDirectoryState(params: URLSearchParams, defaults: DirectoryDefaults): DirectoryState {
  const mentoring = params.get("mentoring");
  const page = Number(params.get("page"));
  const sort = params.get("sort");
  return {
    filters: {
      ...EMPTY_FILTERS,
      q: (params.get("q") ?? "").slice(0, 200),
      disciplines: slugs(params, "discipline"),
      topics: slugs(params, "topic"),
      experience: [...new Set(params.getAll("experience").filter(isBand))],
      mentorship: (mentoring && fromUrlMentoring[mentoring]) || defaults.mentorship,
      networking: params.get("networking") === "1",
      sort: isSort(sort) ? sort : "relevance",
    },
    verified: params.get("verified") === "1",
    location: (params.get("location") ?? "").slice(0, 80),
    region: SLUG.test(params.get("region") ?? "") ? (params.get("region") as string) : "",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The page URL's search part for a state. */
export function writeDirectoryState(state: DirectoryState, defaults: DirectoryDefaults): URLSearchParams {
  const { filters } = state;
  const out = new URLSearchParams();
  const q = filters.q.trim();
  if (q) out.set("q", q);
  for (const id of filters.disciplines) out.append("discipline", id);
  for (const id of filters.topics) out.append("topic", id);
  for (const id of filters.experience) out.append("experience", id);
  if (filters.mentorship !== defaults.mentorship) out.set("mentoring", toApiMentoring[filters.mentorship]);
  if (filters.networking) out.set("networking", "1");
  if (state.verified) out.set("verified", "1");
  const location = state.location.trim();
  if (location) out.set("location", location);
  if (state.region) out.set("region", state.region);
  if (filters.sort !== "relevance") out.set("sort", filters.sort);
  if (state.page > 1) out.set("page", String(state.page));
  return out;
}

/** The `/api/directory` query string for a state. */
export function directoryApiQuery(state: DirectoryState): string {
  const { filters } = state;
  const out = new URLSearchParams();
  const q = filters.q.trim();
  if (q) out.set("q", q);
  for (const id of filters.disciplines) out.append("discipline", id);
  for (const id of filters.topics) out.append("topic", id);
  for (const id of filters.experience) out.append("experience", id);
  if (filters.mentorship !== "any") out.set("mentoring", toApiMentoring[filters.mentorship]);
  if (filters.networking) out.append("participation", "networking");
  if (state.verified) out.set("verified", "1");
  const location = state.location.trim();
  if (location) out.set("location", location);
  if (state.region) out.set("region", state.region);
  if (filters.sort !== "relevance") out.set("sort", filters.sort);
  if (state.page > 1) out.set("page", String(state.page));
  out.set("size", String(DIRECTORY_PAGE_SIZE));
  return out.toString();
}

/** Filters in effect, not counting the search text, the sort or the page. */
export function activeCount(state: DirectoryState): number {
  const { filters } = state;
  return (
    filters.disciplines.length +
    filters.topics.length +
    filters.experience.length +
    (filters.mentorship !== "any" ? 1 : 0) +
    (filters.networking ? 1 : 0) +
    (state.verified ? 1 : 0) +
    (state.location.trim() ? 1 : 0) +
    (state.region ? 1 : 0)
  );
}

/** Every filter back to the screen's preset; the search text and the sort stay. */
export function clearedState(state: DirectoryState, defaults: DirectoryDefaults): DirectoryState {
  return {
    filters: { ...EMPTY_FILTERS, q: state.filters.q, sort: state.filters.sort, mentorship: defaults.mentorship },
    verified: false,
    location: "",
    region: "",
    page: 1,
  };
}
