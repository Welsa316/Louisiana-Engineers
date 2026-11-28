/**
 * The mentorship topics members choose from and the regions the network
 * serves, read from `GET /api/config/vocabulary` so a topic or region an
 * administrator adds is offered in onboarding, settings and the filters at
 * once, and a topic they retire is not. Until the answer arrives (or if it
 * fails) the starting sets stand in (`shared/taxonomy.ts` for topics,
 * Greater New Orleans for regions), so the choices never render empty.
 */

import { useQuery } from "@tanstack/react-query";
import { mentorshipTopics } from "@shared/taxonomy";
import type { PublicVocabulary, VocabularyRegion, VocabularyTopic } from "@shared/types/vocabulary";
import { api } from "./api";
import { queryKeys } from "./query";

/**
 * Every label the vocabulary answer carried, retired topics included, so a
 * topic a member chose before it was retired (or renamed) still reads as its
 * current name wherever `topicLabel` is asked, even by callers that hold only
 * the active list.
 */
const knownLabels = new Map<string, string>();

async function fetchVocabulary(): Promise<PublicVocabulary> {
  const vocabulary = await api<PublicVocabulary>("/config/vocabulary");
  for (const t of [...vocabulary.topics, ...(vocabulary.retiredTopics ?? [])]) knownLabels.set(t.id, t.label);
  return vocabulary;
}

function useVocabulary(): PublicVocabulary | undefined {
  const { data } = useQuery({
    queryKey: queryKeys.vocabulary,
    queryFn: fetchVocabulary,
    staleTime: 5 * 60_000,
  });
  return data;
}

export function useTopics(): VocabularyTopic[] {
  return useVocabulary()?.topics ?? mentorshipTopics;
}

/** The region every profile starts in (the `profiles.region` default, migration 0020's seed). */
export const STARTING_REGIONS: VocabularyRegion[] = [{ id: "greater-new-orleans", label: "Greater New Orleans" }];

/**
 * The active regions in display order. A screen offers a region choice
 * (or a region filter) only when this holds more than one.
 */
export function useRegions(): VocabularyRegion[] {
  const regions = useVocabulary()?.regions;
  return regions && regions.length > 0 ? regions : STARTING_REGIONS;
}

/**
 * A region's label, from the live list first, then the starting set, then
 * the slug read as words ("acadiana" as "Acadiana") for a region no longer
 * active.
 */
export function regionLabel(regions: VocabularyRegion[], id: string): string {
  return (
    regions.find((r) => r.id === id)?.label ??
    STARTING_REGIONS.find((r) => r.id === id)?.label ??
    id
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/** The regions to offer, plus the one already chosen if it is no longer active, so it stays visible. */
export function withChosenRegion(regions: VocabularyRegion[], chosen: string): VocabularyRegion[] {
  if (!chosen || regions.some((r) => r.id === chosen)) return regions;
  return [...regions, { id: chosen, label: regionLabel(regions, chosen) }];
}

/**
 * The topics to offer, plus any the member already chose that are no longer
 * active (retired by an administrator), so a saved choice stays visible and
 * can be cleared.
 */
export function withChosen(topics: VocabularyTopic[], chosen: string[]): VocabularyTopic[] {
  const known = new Set(topics.map((t) => t.id));
  const retired = chosen.filter((id) => !known.has(id)).map((id) => ({ id, label: topicLabel(topics, id) }));
  return [...topics, ...retired];
}

/**
 * A topic's label: from the given list first, then every label the live
 * vocabulary carried (retired topics too), then the starting set, then the
 * id itself.
 */
export function topicLabel(topics: VocabularyTopic[], id: string): string {
  return (
    topics.find((t) => t.id === id)?.label ??
    knownLabels.get(id) ??
    mentorshipTopics.find((t) => t.id === id)?.label ??
    id
  );
}

/** Labels for topic ids from the live list, so a topic an administrator added reads as its name, not its id. */
export function useTopicLabels(): (ids: string[]) => string[] {
  const topics = useTopics();
  return (ids) => ids.map((id) => topicLabel(topics, id));
}
