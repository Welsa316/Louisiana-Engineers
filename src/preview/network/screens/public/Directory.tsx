import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Link } from "../../router";
import { useStore } from "../../state/store";
import { ActiveFilters, FilterPanel, ProfileCard, SearchBox, useDirectory, type Filters } from "../../components/directory";
import { Empty, Select, Sheet } from "../../components/ui";

/**
 * 2. Professional directory (public) and 10. mentor discovery (mentee) share
 * this screen; `mode` changes the copy, the default filters and where cards
 * link to.
 */
export function Directory({ mode = "directory" }: { mode?: "directory" | "mentors" }) {
  const { state } = useStore();
  const dir = useDirectory(mode === "mentors" ? { mentorship: "available" } : {});
  const [sheet, setSheet] = useState(false);
  const base = mode === "mentors" ? "/me/mentors" : "/directory";
  const signedIn = state.role !== "visitor";

  return (
    <div className={mode === "directory" ? "shell pt-12 md:pt-16 pb-24" : ""}>
      <header className="pn-page-head">
        <div>
          <span className="pn-kicker">{mode === "mentors" ? "Find mentors" : "Professional directory"}</span>
          <h1 className="mt-3">{mode === "mentors" ? "Who can help with what you are working on?" : "People in the network."}</h1>
          <p>
            {mode === "mentors"
              ? "Everyone here has offered time. Filter by the topic you need, then read how they like to work."
              : signedIn
                ? "Members see everyone who has agreed to be listed. Mentors are marked; save the ones you want to come back to."
                : "Public profiles of members who chose to be listed. Sign in to see members-only profiles and to send requests."}
          </p>
        </div>
      </header>

      <div className="pn-dir mt-8">
        <aside className="pn-filters-desktop" aria-label="Filters">
          <FilterPanel dir={dir} />
        </aside>

        <div className="min-w-0">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <SearchBox value={dir.filters.q} onChange={(q) => dir.setFilters((f) => ({ ...f, q }))} />
            <div className="flex items-center gap-3">
              <button type="button" className="btn btn-outline btn-sm pn-filters-toggle" onClick={() => setSheet(true)}>
                <SlidersHorizontal size={15} aria-hidden="true" />
                Filters{dir.activeCount ? ` (${dir.activeCount})` : ""}
              </button>
              <label className="flex items-center gap-2 t-small text-fg-2 whitespace-nowrap">
                Sort
                <Select
                  value={dir.filters.sort}
                  onChange={(e) => dir.setFilters((f) => ({ ...f, sort: e.target.value as Filters["sort"] }))}
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
            <span className="pn-results-count">
              <strong>{dir.results.length}</strong> of {dir.counts.listed} {mode === "mentors" ? "listed professionals" : "listed"}
              {state.role === "visitor" && " · members-only profiles hidden"}
            </span>
          </div>
          <ActiveFilters dir={dir} />

          {dir.results.length ? (
            <div className="pn-cards mt-6">
              {dir.results.map((p) => (
                <ProfileCard key={p.id} p={p} to={`${base}/${p.id}`} />
              ))}
            </div>
          ) : (
            <div className="mt-6">
              <Empty
                title="No one matches yet."
                action={
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => dir.setFilters((f) => ({ ...f, q: "", disciplines: [], topics: [], experience: [], mentorship: "any", networking: false }))}>
                    Clear filters
                  </button>
                }
              >
                Try a broader discipline or remove a topic. The directory grows as professionals join; you can also{" "}
                <Link to="/join/professional" className="link link-quiet">
                  invite someone
                </Link>
                .
              </Empty>
            </div>
          )}
        </div>
      </div>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Filters"
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={dir.reset}>
              Clear
            </button>
            <button type="button" className="btn btn-solid btn-sm" onClick={() => setSheet(false)}>
              Show {dir.results.length} {dir.results.length === 1 ? "result" : "results"}
            </button>
          </>
        }
      >
        <FilterPanel dir={dir} />
      </Sheet>
    </div>
  );
}
