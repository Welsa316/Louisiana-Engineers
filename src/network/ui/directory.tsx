/**
 * Directory pieces shared by the public directory, mentor discovery and the
 * saved list: the filter model, the filter panel, the active-filter chips,
 * the search box and the profile card. They hold no data of their own; the
 * caller owns the filter state (the app keeps it in the URL) and passes each
 * card the fields it shows.
 */

import type { Dispatch, SetStateAction } from "react";
import { Bookmark, BookmarkCheck, MapPin, Search, X } from "lucide-react";
import { disciplineById, disciplineGroups, disciplines, experienceBands } from "@shared/taxonomy";
import { topicLabel, useTopics, withChosen } from "../lib/vocabulary";
import type { ExperienceBandId } from "@shared/types/common";
import { CheckRow, Chip, Monogram, Status, UiLink } from "./ui";

/* ---------- Filter model ---------- */

export type MentorFilter = "any" | "available" | "all-mentors";

export interface Filters {
  q: string;
  disciplines: string[];
  /** Mentorship topic ids. */
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

/** Number of filters in effect, not counting the search text or the sort. */
export function activeFilterCount(filters: Filters): number {
  return (
    filters.disciplines.length +
    filters.topics.length +
    filters.experience.length +
    (filters.mentorship !== "any" ? 1 : 0) +
    (filters.networking ? 1 : 0)
  );
}

/** Clears every filter but keeps the search text and the sort. */
export function clearedFilters(filters: Filters): Filters {
  return { ...EMPTY_FILTERS, q: filters.q, sort: filters.sort };
}

type ListKey = "disciplines" | "topics" | "experience";

/** Adds `value` to the list filter `key`, or removes it when present. */
export function toggleFilter<K extends ListKey>(filters: Filters, key: K, value: Filters[K][number]): Filters {
  const list = filters[key] as string[];
  return { ...filters, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
}

/**
 * What the filter panel and the active-filter chips need from their owner.
 * `counts.byDiscipline` holds the number of listed profiles per discipline
 * id, shown next to each discipline.
 */
export interface DirectoryControls {
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  counts: { byDiscipline: Record<string, number> };
}

/* ---------- Filter panel ---------- */

export function FilterPanel({ dir, showMentorship = true }: { dir: DirectoryControls; showMentorship?: boolean }) {
  const { filters, setFilters, counts } = dir;
  const topics = useTopics();
  const toggle = <K extends ListKey>(key: K, value: Filters[K][number]) => setFilters((f) => toggleFilter(f, key, value));
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
          {experienceBands.map((b) => (
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
            {withChosen(topics, filters.topics).map((t) => (
              <Chip key={t.id} pressed={filters.topics.includes(t.id)} onClick={() => toggle("topics", t.id)}>
                {t.label}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The removable chips above the results. */
export function ActiveFilters({ dir }: { dir: DirectoryControls }) {
  const { filters, setFilters } = dir;
  const topics = useTopics();
  if (!activeFilterCount(filters)) return null;
  const toggle = <K extends ListKey>(key: K, value: Filters[K][number]) => setFilters((f) => toggleFilter(f, key, value));
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
          {disciplineById(id)?.label ?? id}
        </Chip>
      ))}
      {filters.experience.map((id) => (
        <Chip key={id} pressed removable onClick={() => toggle("experience", id)}>
          {experienceBands.find((b) => b.id === id)?.label ?? id}
        </Chip>
      ))}
      {filters.topics.map((id) => (
        <Chip key={id} pressed removable onClick={() => toggle("topics", id)}>
          {topicLabel(topics, id)}
        </Chip>
      ))}
      <button type="button" className="link link-quiet t-small ml-1" onClick={() => setFilters(clearedFilters)}>
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

/** The fields a directory card shows. Exact years and contact details never appear on a card. */
export interface ProfileCardData {
  id: string;
  /** Display name, with credentials when the member gave them. */
  name: string;
  initials: string;
  title: string;
  organization: string;
  location: string;
  disciplineId: string;
  expertise: string[];
  /** The approved photo; initials when absent. */
  photoUrl?: string | null;
}

/** The mentorship pill on a card. */
export interface CardStatus {
  tone: "active" | "paused" | "off";
  label: string;
}

/**
 * One directory result. `status` is the mentorship pill; `save` adds the
 * bookmark toggle (members only), which moves the pill to the card's foot.
 */
export function ProfileCard({
  p,
  to,
  status,
  save,
}: {
  p: ProfileCardData;
  to: string;
  status?: CardStatus;
  save?: { saved: boolean; onToggle: () => void };
}) {
  const discipline = disciplineById(p.disciplineId);
  const pill = status ? <Status tone={status.tone} label={status.label} /> : null;

  return (
    <article className="pn-pcard">
      <div className="pn-pcard-top">
        <Monogram initials={p.initials} photo={p.photoUrl} />
        {save ? (
          <button
            type="button"
            className="pn-icon-btn pn-pcard-save"
            aria-pressed={save.saved}
            aria-label={save.saved ? `Remove ${p.name} from saved` : `Save ${p.name}`}
            onClick={save.onToggle}
          >
            {save.saved ? <BookmarkCheck size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
          </button>
        ) : (
          pill
        )}
      </div>
      <div>
        <h3 className="pn-pcard-name">
          <UiLink to={to}>{p.name}</UiLink>
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
        {save && pill}
      </div>
    </article>
  );
}
