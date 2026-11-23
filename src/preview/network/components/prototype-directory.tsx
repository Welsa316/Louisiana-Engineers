/**
 * The prototype's side of the directory: filtering the in-memory sample data
 * and binding the shared, data-free pieces in src/network/ui/directory.tsx to
 * the prototype store. The real app filters on the server instead.
 */

import { useMemo, useState } from "react";
import { disciplineById, experienceBands } from "@shared/taxonomy";
import {
  activeFilterCount,
  clearedFilters,
  EMPTY_FILTERS,
  ProfileCard as CardView,
  type DirectoryControls,
  type Filters,
} from "../../../network/ui/directory";
import { useStore, isListed, isMentorAvailable } from "../state/store";
import { fullName, initials, topicLabel } from "../data/mock";
import type { Professional } from "../data/types";

export { ActiveFilters, FilterPanel, SearchBox, type Filters } from "../../../network/ui/directory";

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
    ...(p.mentorship?.topics ?? []).map(topicLabel),
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

  const dir: DirectoryControls & { results: Professional[]; counts: typeof counts; activeCount: number; reset: () => void } = {
    filters,
    setFilters,
    results,
    counts,
    activeCount: activeFilterCount(filters),
    reset: () => setFilters(clearedFilters),
  };
  return dir;
}

/** A directory card for a sample professional, with the store's save toggle and mentorship pill. */
export function ProfileCard({ p, to }: { p: Professional; to: string }) {
  const { state, dispatch } = useStore();
  const available = isMentorAvailable(p, state.requests);
  const status = p.mentorship
    ? available
      ? ({ tone: "active", label: "Mentoring" } as const)
      : p.mentorship.status === "paused"
        ? ({ tone: "paused", label: "Paused" } as const)
        : ({ tone: "off", label: "Full" } as const)
    : undefined;

  return (
    <CardView
      p={{
        id: p.id,
        name: fullName(p, true),
        initials: initials(p),
        title: p.title,
        organization: p.organization,
        location: p.location,
        disciplineId: p.disciplineId,
        expertise: p.expertise,
      }}
      to={to}
      status={status}
      save={
        state.role === "mentee"
          ? { saved: state.saved.includes(p.id), onToggle: () => dispatch({ type: "toggleSaved", id: p.id }) }
          : undefined
      }
    />
  );
}
