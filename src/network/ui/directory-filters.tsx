/**
 * Directory controls the app adds beside the shared filter panel in
 * directory.tsx: the verified and location filters, the active-filter chips
 * for every filter (the shared chips cannot clear the two added here), a
 * text field that reports its value once typing pauses, and the pager.
 * Like the shared pieces they hold no data; the page owns the state.
 */

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { disciplineById, experienceBands } from "@shared/taxonomy";
import { topicLabel, useTopics } from "../lib/vocabulary";
import type { Filters } from "./directory";
import { CheckRow, Chip } from "./ui";
import "./directory-pages.css";

/**
 * Local text that follows `value` when it changes from outside (a cleared
 * filter, the Back button) and reports edits through `onCommit` after
 * `delay` milliseconds without typing.
 */
export function useDebouncedText(value: string, onCommit: (next: string) => void, delay = 350) {
  const [text, setText] = useState(value);
  const committed = useRef(value);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    if (text === committed.current) return;
    const timer = window.setTimeout(() => {
      committed.current = text;
      commit.current(text);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [text, delay]);

  return [text, setText] as const;
}

/** Verified affiliation and location, appended to the shared filter panel. */
export function MoreFilters({
  verified,
  location,
  onVerified,
  onLocation,
}: {
  verified: boolean;
  location: string;
  onVerified: (next: boolean) => void;
  onLocation: (next: string) => void;
}) {
  const [text, setText] = useDebouncedText(location, onLocation);
  const id = useId();
  return (
    <div className="pn-filters pn-filters-more">
      <div className="pn-filter-group">
        <h3>Affiliation</h3>
        <div className="pn-filter-list">
          <CheckRow pressed={verified} onClick={() => onVerified(!verified)}>
            Verified affiliation only
          </CheckRow>
        </div>
      </div>
      <div className="pn-filter-group">
        <h3>
          <label htmlFor={id}>Location</label>
        </h3>
        <input
          id={id}
          className="field-input pn-filter-input"
          type="text"
          inputMode="search"
          autoComplete="address-level2"
          maxLength={80}
          placeholder="City, for example Metairie"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
    </div>
  );
}

/** Removable chips for every filter in effect, with Clear all. */
export function FilterChips({
  filters,
  verified,
  location,
  onFilters,
  onVerified,
  onLocation,
  onClear,
}: {
  filters: Filters;
  verified: boolean;
  location: string;
  onFilters: (next: Filters) => void;
  onVerified: (next: boolean) => void;
  onLocation: (next: string) => void;
  onClear: () => void;
}) {
  const topics = useTopics();
  const without = <K extends "disciplines" | "topics" | "experience">(key: K, value: string) =>
    onFilters({ ...filters, [key]: (filters[key] as string[]).filter((v) => v !== value) });
  const chips = [
    filters.mentorship !== "any" && (
      <Chip key="mentoring" pressed removable onClick={() => onFilters({ ...filters, mentorship: "any" })}>
        {filters.mentorship === "available" ? "Available to mentor" : "All mentors"}
      </Chip>
    ),
    filters.networking && (
      <Chip key="networking" pressed removable onClick={() => onFilters({ ...filters, networking: false })}>
        Open to networking
      </Chip>
    ),
    verified && (
      <Chip key="verified" pressed removable onClick={() => onVerified(false)}>
        Verified affiliation
      </Chip>
    ),
    location.trim() && (
      <Chip key="location" pressed removable onClick={() => onLocation("")}>
        Near {location.trim()}
      </Chip>
    ),
    ...filters.disciplines.map((id) => (
      <Chip key={`d-${id}`} pressed removable onClick={() => without("disciplines", id)}>
        {disciplineById(id)?.label ?? id}
      </Chip>
    )),
    ...filters.experience.map((id) => (
      <Chip key={`e-${id}`} pressed removable onClick={() => without("experience", id)}>
        {experienceBands.find((b) => b.id === id)?.label ?? id}
      </Chip>
    )),
    ...filters.topics.map((id) => (
      <Chip key={`t-${id}`} pressed removable onClick={() => without("topics", id)}>
        {topicLabel(topics, id)}
      </Chip>
    )),
  ].filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="pn-active-filters" role="group" aria-label="Active filters">
      {chips}
      <button type="button" className="link link-quiet t-small ml-1" onClick={onClear}>
        Clear all
      </button>
    </div>
  );
}

/** Previous and next page, with where the list stands. */
export function Pager({
  page,
  size,
  total,
  onPage,
}: {
  page: number;
  size: number;
  total: number;
  onPage: (next: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return (
    <nav className="pn-dir-pager" aria-label="Result pages">
      <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={15} aria-hidden="true" />
        Previous
      </button>
      <span className="t-small text-fg-2">
        Page {Math.min(page, pages)} of {pages}
      </span>
      <button type="button" className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </nav>
  );
}
