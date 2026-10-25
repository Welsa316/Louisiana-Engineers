/**
 * Directory pieces shared by the public directory, mentor discovery and the
 * saved list: the profile card, the filter model and the filter panel.
 */

import { useMemo, useState } from "react";
import { Bookmark, BookmarkCheck, MapPin, Search, X } from "lucide-react";
import { Link } from "../router";
import { useStore, isListed, isMentorAvailable } from "../state/store";
import { disciplineById, disciplineGroups, disciplines, experienceBands, mentorshipTopics, type ExperienceBandId } from "../data/taxonomy";
import { fullName, initials } from "../data/mock";
import type { Professional } from "../data/types";
import { CheckRow, Chip, Monogram, Status } from "./ui";

/* ---------- Filter model ---------- */

export type MentorFilter = "any" | "available" | "all-mentors";

export interface Filters {
  q: string;
  disciplines: string[];
  topics: string[];
  experience: ExperienceBandId[];
  mentorship: MentorFilter;
  networking: boolean;
  sort: "relevance" | "name" | "experience" | "recent";
}

export const EMPTY_FILTERS: Filters = {
  q: "",
  disciplines: [],
  topics: [],
  experience: [],
  mentorship: "any",
  networking: false,
  sort: "relevance",
};

function matchesQuery(p: Professional, q: string) {
  if (!q) return true;
  const hay = [
    fullName(p),
    p.title,
    p.organization,
    p.location,
    disciplineById(p.disciplineId)?.label ?? "",
    ...p.expertise,
    ...p.interests,
    ...(p.mentorship?.topics ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

export function useDirectory(initial: Partial<Filters> = {}) {
  const { state } = useStore();
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, ...initial });

  const listed = useMemo(() => state.professionals.filter((p) => isListed(p, state.role)), [state.professionals, state.role]);

  const results = useMemo(() => {
    let out = listed.filter((p) => matchesQuery(p, filters.q));
    if (filters.disciplines.length) out = out.filter((p) => filters.disciplines.includes(p.disciplineId));
    if (filters.topics.length) out = out.filter((p) => p.mentorship?.topics.some((t) => filters.topics.includes(t)));
    if (filters.experience.length) {
      out = out.filter((p) =>
        filters.experience.some((id) => {
          const band = experienceBands.find((b) => b.id === id)!;
          return p.yearsExperience >= band.min && p.yearsExperience <= band.max;
        }),
      );
    }
    if (filters.mentorship === "available") out = out.filter((p) => isMentorAvailable(p, state.requests));
    if (filters.mentorship === "all-mentors") out = out.filter((p) => p.mentorship);
    if (filters.networking) out = out.filter((p) => p.participation.includes("networking"));

    const byName = (a: Professional, b: Professional) => a.lastName.localeCompare(b.lastName);
    if (filters.sort === "name") out = [...out].sort(byName);
    if (filters.sort === "experience") out = [...out].sort((a, b) => b.yearsExperience - a.yearsExperience);
    if (filters.sort === "recent") out = [...out].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
    if (filters.sort === "relevance") {
      // Available mentors first when the search is about mentorship; otherwise most recently active.
      out = [...out].sort((a, b) => {
        const am = isMentorAvailable(a, state.requests) ? 1 : 0;
        const bm = isMentorAvailable(b, state.requests) ? 1 : 0;
        if (filters.mentorship !== "any" || filters.topics.length) return bm - am || byName(a, b);
        return b.lastActiveAt.localeCompare(a.lastActiveAt);
      });
    }
    return out;
  }, [listed, filters, state.requests]);

  const counts = useMemo(() => {
    const byDiscipline: Record<string, number> = {};
    listed.forEach((p) => {
      byDiscipline[p.disciplineId] = (byDiscipline[p.disciplineId] ?? 0) + 1;
    });
    return { byDiscipline, listed: listed.length };
  }, [listed]);

  const activeCount =
    filters.disciplines.length +
    filters.topics.length +
    filters.experience.length +
    (filters.mentorship !== "any" ? 1 : 0) +
    (filters.networking ? 1 : 0);

  const toggle = <K extends "disciplines" | "topics" | "experience">(key: K, value: Filters[K][number]) =>
    setFilters((f) => {
      const list = f[key] as string[];
      return { ...f, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });

  return {
    filters,
    setFilters,
    toggle,
    results,
    counts,
    activeCount,
    reset: () => setFilters((f) => ({ ...EMPTY_FILTERS, q: f.q, sort: f.sort })),
  };
}

export type Directory = ReturnType<typeof useDirectory>;

/* ---------- Filter panel ---------- */

export function FilterPanel({ dir, showMentorship = true }: { dir: Directory; showMentorship?: boolean }) {
  const { filters, setFilters, toggle, counts } = dir;
  return (
    <div className="pn-filters">
      {showMentorship && (
        <div className="pn-filter-group">
          <h3>Mentorship</h3>
          <div className="pn-filter-list">
            <CheckRow pressed={filters.mentorship === "available"} onClick={() => setFilters((f) => ({ ...f, mentorship: f.mentorship === "available" ? "any" : "available" }))}>
              Available to mentor now
            </CheckRow>
            <CheckRow pressed={filters.mentorship === "all-mentors"} onClick={() => setFilters((f) => ({ ...f, mentorship: f.mentorship === "all-mentors" ? "any" : "all-mentors" }))}>
              All mentors, including paused
            </CheckRow>
            <CheckRow pressed={filters.networking} onClick={() => setFilters((f) => ({ ...f, networking: !f.networking }))}>
              Open to networking
            </CheckRow>
          </div>
        </div>
      )}

      <div className="pn-filter-group">
        <h3>Discipline</h3>
        {disciplineGroups.map((g) => (
          <div key={g} className="mb-3 last:mb-0">
            <div className="text-fg-2 text-[0.75rem] mb-1 mt-2">{g}</div>
            <div className="pn-filter-list">
              {disciplines
                .filter((d) => d.group === g)
                .map((d) => (
                  <CheckRow
                    key={d.id}
                    pressed={filters.disciplines.includes(d.id)}
                    onClick={() => toggle("disciplines", d.id)}
                    count={counts.byDiscipline[d.id] ?? 0}
                  >
                    {d.label}
                  </CheckRow>
                ))}
            </div>
          </div>
        ))}
      </div>

      <div className="pn-filter-group">
        <h3>Experience</h3>
        <div className="pn-filter-list">
          {experienceBands
            .filter((b) => b.id !== "student")
            .map((b) => (
              <CheckRow key={b.id} pressed={filters.experience.includes(b.id)} onClick={() => toggle("experience", b.id)}>
                {b.label}
              </CheckRow>
            ))}
        </div>
      </div>

      {showMentorship && (
        <div className="pn-filter-group">
          <h3>Can help with</h3>
          <div className="pn-chips">
            {mentorshipTopics.map((t) => (
              <Chip key={t} pressed={filters.topics.includes(t)} onClick={() => toggle("topics", t)}>
                {t}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The removable chips above the results. */
export function ActiveFilters({ dir }: { dir: Directory }) {
  const { filters, setFilters, toggle, activeCount, reset } = dir;
  if (!activeCount) return null;
  return (
    <div className="pn-active-filters" aria-label="Active filters">
      {filters.mentorship !== "any" && (
        <Chip pressed removable onClick={() => setFilters((f) => ({ ...f, mentorship: "any" }))}>
          {filters.mentorship === "available" ? "Available to mentor" : "All mentors"}
        </Chip>
      )}
      {filters.networking && (
        <Chip pressed removable onClick={() => setFilters((f) => ({ ...f, networking: false }))}>
          Open to networking
        </Chip>
      )}
      {filters.disciplines.map((id) => (
        <Chip key={id} pressed removable onClick={() => toggle("disciplines", id)}>
          {disciplineById(id)?.label}
        </Chip>
      ))}
      {filters.experience.map((id) => (
        <Chip key={id} pressed removable onClick={() => toggle("experience", id)}>
          {experienceBands.find((b) => b.id === id)?.label}
        </Chip>
      ))}
      {filters.topics.map((t) => (
        <Chip key={t} pressed removable onClick={() => toggle("topics", t)}>
          {t}
        </Chip>
      ))}
      <button type="button" className="link link-quiet t-small ml-1" onClick={reset}>
        Clear all
      </button>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="pn-search">
      <Search size={18} aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Search by name, role, organization or expertise"}
        aria-label="Search the directory"
      />
      {value && (
        <button type="button" className="pn-icon-btn pn-search-clear" aria-label="Clear search" onClick={() => onChange("")}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* ---------- Profile card ---------- */

export function ProfileCard({ p, to }: { p: Professional; to: string }) {
  const { state, dispatch } = useStore();
  const saved = state.saved.includes(p.id);
  const canSave = state.role === "mentee";
  const available = isMentorAvailable(p, state.requests);
  const discipline = disciplineById(p.disciplineId);

  return (
    <article className="pn-pcard">
      <div className="pn-pcard-top">
        <Monogram initials={initials(p)} />
        {canSave ? (
          <button
            type="button"
            className="pn-icon-btn pn-pcard-save"
            aria-pressed={saved}
            aria-label={saved ? `Remove ${fullName(p)} from saved` : `Save ${fullName(p)}`}
            onClick={() => dispatch({ type: "toggleSaved", id: p.id })}
          >
            {saved ? <BookmarkCheck size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
          </button>
        ) : (
          p.mentorship && <Status tone={available ? "active" : p.mentorship.status === "paused" ? "paused" : "off"} label={available ? "Mentoring" : p.mentorship.status === "paused" ? "Paused" : "Full"} />
        )}
      </div>
      <div>
        <h3 className="pn-pcard-name">
          <Link to={to}>{fullName(p, true)}</Link>
        </h3>
        <p className="pn-pcard-title">{p.title}</p>
        <p className="pn-pcard-org">{p.organization}</p>
      </div>
      <div className="pn-tags">
        {p.expertise.slice(0, 3).map((e) => (
          <span key={e} className="pn-tag pn-tag-quiet">
            {e}
          </span>
        ))}
        {p.expertise.length > 3 && <span className="pn-tag pn-tag-quiet">+{p.expertise.length - 3}</span>}
      </div>
      <div className="pn-pcard-foot">
        <span className="inline-flex items-center gap-2 min-w-0">
          <MapPin size={13} aria-hidden="true" />
          <span className="truncate">{p.location}</span>
        </span>
        <span className="truncate">{discipline?.label}</span>
        {canSave && p.mentorship && (
          <Status tone={available ? "active" : p.mentorship.status === "paused" ? "paused" : "off"} label={available ? "Mentoring" : p.mentorship.status === "paused" ? "Paused" : "Full"} />
        )}
      </div>
    </article>
  );
}
