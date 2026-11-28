/**
 * The professional directory (`/network/directory`, public shell) and Find
 * mentors (`/network/me/discover`, app shell), ported from the prototype.
 * Both read `/api/directory`, which applies the row policies: a visitor
 * gets public profiles, a signed-in member members-only ones too. Every
 * filter lives in the URL (directory-params.ts); Find mentors starts with
 * "Available to mentor now" on.
 */

import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { SlidersHorizontal } from "lucide-react";
import type { DirectoryEntry } from "@shared/types/directory";
import { useMeta } from "../../lib/meta";
import { useSession } from "../../lib/session";
import { FilterPanel, ProfileCard, SearchBox, type CardStatus, type Filters } from "../../ui/directory";
import { FilterChips, MoreFilters, Pager, useDebouncedText } from "../../ui/directory-filters";
import { Empty, Notice, Select, Sheet } from "../../ui/ui";
import { useDirectorySearch } from "./directory-api";
import {
  activeCount,
  clearedState,
  DIRECTORY_PAGE_SIZE,
  directoryApiQuery,
  readDirectoryState,
  writeDirectoryState,
  type DirectoryDefaults,
  type DirectoryState,
} from "./directory-params";

export type DirectoryMode = "directory" | "discover";

const DEFAULTS: Record<DirectoryMode, DirectoryDefaults> = {
  directory: { mentorship: "any" },
  discover: { mentorship: "available" },
};

/** Where a card leads: the public profile, or the same profile inside the app shell. */
export const profilePath = (mode: DirectoryMode, id: string) =>
  mode === "discover" ? `/me/discover/${id}` : `/directory/${id}`;

export function displayName(p: { firstName: string | null; lastName: string | null; credentials?: string | null }): string {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || "Member";
  return p.credentials ? `${name}, ${p.credentials}` : name;
}

export function initialsOf(p: { firstName: string | null; lastName: string | null }): string {
  return `${p.firstName?.[0] ?? ""}${p.lastName?.[0] ?? ""}`.toUpperCase() || "M";
}

/** The card's mentorship pill (03 section 11.2). */
function cardStatus(entry: DirectoryEntry): CardStatus | undefined {
  if (entry.mentorStatus === "active" && entry.hasCapacity) return { tone: "active", label: "Taking requests" };
  if (entry.mentorStatus === "active" || entry.mentorStatus === "paused") {
    return { tone: "off", label: "Not taking requests" };
  }
  return undefined;
}

function plainCount(n: number): string {
  return `${n} ${n === 1 ? "profile" : "profiles"}`;
}

export function Directory({ mode = "directory" }: { mode?: DirectoryMode }) {
  const discover = mode === "discover";
  const defaults = DEFAULTS[mode];
  const { user, status } = useSession();
  const signedIn = Boolean(user);
  const [params, setParams] = useSearchParams();
  const state = readDirectoryState(params, defaults);
  const [sheet, setSheet] = useState(false);

  useMeta({
    title: discover ? "Find mentors" : "Directory",
    description: discover
      ? undefined
      : "Muslim engineers, scientists and technologists in Greater New Orleans who chose to be listed, with what they work on and whether they mentor.",
    noindex: discover,
    canonical: discover ? undefined : "/network/directory",
  });

  // Each filter change or page is its own history entry, so Back steps
  // through them; only the debounced search text replaces as it is typed.
  const update = (next: DirectoryState, { keepPage = false, replace = false } = {}) => {
    setParams(writeDirectoryState(keepPage ? next : { ...next, page: 1 }, defaults), { replace });
  };
  const setFilters = (next: Filters | ((f: Filters) => Filters)) =>
    update({ ...state, filters: typeof next === "function" ? next(state.filters) : next });
  const clear = () => update(clearedState(state, defaults));

  const [q, setQ] = useDebouncedText(state.filters.q, (text) =>
    update({ ...state, filters: { ...state.filters, q: text } }, { replace: true }),
  );

  const query = useDirectorySearch(directoryApiQuery(state));
  const data = query.data;
  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const counts = { byDiscipline: Object.fromEntries((data?.facets.disciplines ?? []).map((d) => [d.id, d.count])) };
  const dir = { filters: state.filters, setFilters, counts };
  const filtersOn = activeCount(state);
  const searching = filtersOn > 0 || state.filters.q.trim() !== "";
  const loading = status === "loading" || query.isPending;

  const more = (
    <MoreFilters
      verified={state.verified}
      location={state.location}
      onVerified={(verified) => update({ ...state, verified })}
      onLocation={(location) => update({ ...state, location })}
    />
  );

  return (
    <div className={discover ? "" : "shell pt-12 md:pt-16 pb-24"}>
      <header className="pn-page-head">
        <div>
          <span className="pn-kicker">{discover ? "Find mentors" : "Professional directory"}</span>
          <h1 className="mt-3">{discover ? "Who can help with what you are working on?" : "People in the network."}</h1>
          <p>
            {discover
              ? "Everyone here has offered time. Filter by the topic you need, then read how they like to work."
              : signedIn
                ? "You see everyone who agreed to be listed, including members-only profiles. Open a profile to see how to reach them."
                : "Public profiles of professionals who chose to be listed. Sign in to see members-only profiles and how to reach people."}
          </p>
        </div>
      </header>

      <div className="pn-dir mt-8">
        <aside className="pn-filters-desktop" aria-label="Filters">
          <FilterPanel dir={dir} />
          {more}
        </aside>

        <div className="min-w-0">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <SearchBox value={q} onChange={setQ} />
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-outline btn-sm pn-filters-toggle" onClick={() => setSheet(true)}>
                <SlidersHorizontal size={15} aria-hidden="true" />
                Filters{filtersOn ? ` (${filtersOn})` : ""}
              </button>
              <label className="flex items-center gap-2 t-small text-fg-2 whitespace-nowrap">
                Sort
                <Select
                  value={state.filters.sort}
                  onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as Filters["sort"] }))}
                  aria-label="Sort results"
                  style={{ minHeight: "2.5rem", fontSize: "0.875rem" }}
                >
                  <option value="relevance">Relevance</option>
                  <option value="name">Last name</option>
                  <option value="experience">Most experienced</option>
                  <option value="recent">Recently active</option>
                </Select>
              </label>
            </div>
          </div>

          <div className="pn-results-bar mt-5">
            <p className="pn-results-count" role="status" aria-live="polite">
              {loading ? (
                "Loading profiles"
              ) : (
                <strong data-testid="directory-count">{plainCount(total)}</strong>
              )}
            </p>
            {!signedIn && status !== "loading" && (
              <span className="t-small text-fg-2">
                <Link to="/signin" className="link link-quiet">
                  Sign in to see members-only profiles
                </Link>
              </span>
            )}
          </div>
          <FilterChips
            filters={state.filters}
            verified={state.verified}
            location={state.location}
            onFilters={(filters) => update({ ...state, filters })}
            onVerified={(verified) => update({ ...state, verified })}
            onLocation={(location) => update({ ...state, location })}
            onClear={clear}
          />

          <Results
            mode={mode}
            loading={loading}
            failed={query.isError && !data}
            retry={() => void query.refetch()}
            paused={Boolean(data?.paused)}
            searching={searching}
            items={items}
            onClear={clear}
            pastEnd={state.page > 1 && total > 0}
            onFirstPage={() => update({ ...state, page: 1 }, { keepPage: true })}
          />

          <Pager
            page={state.page}
            size={DIRECTORY_PAGE_SIZE}
            total={total}
            onPage={(page) => {
              update({ ...state, page }, { keepPage: true });
              window.scrollTo({ top: 0 });
            }}
          />
        </div>
      </div>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Filters"
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
              Clear
            </button>
            <button type="button" className="btn btn-solid btn-sm" onClick={() => setSheet(false)}>
              Show {total} {total === 1 ? "result" : "results"}
            </button>
          </>
        }
      >
        <FilterPanel dir={dir} />
        {more}
      </Sheet>
    </div>
  );
}

function Results({
  mode,
  loading,
  failed,
  retry,
  paused,
  searching,
  items,
  onClear,
  pastEnd,
  onFirstPage,
}: {
  mode: DirectoryMode;
  loading: boolean;
  failed: boolean;
  retry: () => void;
  paused: boolean;
  searching: boolean;
  items: DirectoryEntry[];
  onClear: () => void;
  /** A page number beyond the last page of a non-empty result. */
  pastEnd: boolean;
  onFirstPage: () => void;
}) {
  if (loading) return <div className="pn-dir-loading mt-6" aria-hidden="true" />;
  if (failed) {
    return (
      <div className="mt-6">
        <Notice tone="warn">
          The directory did not load. Check your connection, then{" "}
          <button type="button" className="link" onClick={retry}>
            try again
          </button>
          .
        </Notice>
      </div>
    );
  }
  if (paused) {
    return (
      <div className="mt-6">
        <Empty title="The directory is paused.">
          The administrators have paused the network for a short while. Profiles will be back soon.
        </Empty>
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="mt-6">
        {pastEnd ? (
          <Empty
            title="This page is past the end of the results."
            action={
              <button type="button" className="btn btn-outline btn-sm" onClick={onFirstPage}>
                Back to page 1
              </button>
            }
          >
            The list is shorter than this link expected.
          </Empty>
        ) : searching ? (
          <Empty
            title="No profiles match these filters."
            action={
              <button type="button" className="btn btn-outline btn-sm" onClick={onClear}>
                Clear filters
              </button>
            }
          >
            Try a broader discipline, remove a topic or check the spelling of the search.
          </Empty>
        ) : (
          <Empty
            title="The directory is new."
            action={
              <Link to="/join" className="btn btn-outline btn-sm">
                Join as a professional
              </Link>
            }
          >
            Professionals are being approved every week.
          </Empty>
        )}
      </div>
    );
  }
  return (
    <ul className="pn-cards pn-cards-list mt-6" aria-label="Profiles">
      {items.map((entry) => (
        <li key={entry.id}>
          <ProfileCard
            p={{
              id: entry.id,
              name: displayName(entry),
              initials: initialsOf(entry),
              title: entry.title,
              organization: entry.organization,
              location: entry.location ?? "",
              disciplineId: entry.disciplineId,
              expertise: entry.tags,
              photoUrl: entry.photoUrl,
            }}
            to={profilePath(mode, entry.id)}
            status={cardStatus(entry)}
          />
        </li>
      ))}
    </ul>
  );
}

