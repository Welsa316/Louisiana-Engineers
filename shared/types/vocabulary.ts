/**
 * `GET /api/config/vocabulary`: the vocabularies members choose from, read
 * from the database so a topic an administrator adds is offered at once
 * (`shared/taxonomy.ts` holds the starting set the migration seeded), and
 * the regions the network serves (`regions`, migration 0020).
 */

export interface VocabularyTopic {
  id: string;
  label: string;
}

export interface VocabularyRegion {
  /** A slug, such as `greater-new-orleans`. */
  id: string;
  label: string;
}

export interface PublicVocabulary {
  /** Active mentorship topics, in their display order. */
  topics: VocabularyTopic[];
  /** Active regions, in their display order. A region choice is offered only when there is more than one. */
  regions: VocabularyRegion[];
}
