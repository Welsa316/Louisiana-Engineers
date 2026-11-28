/**
 * `GET /api/config/vocabulary`: the vocabularies members choose from, read
 * from the database so a topic an administrator adds is offered at once
 * (`shared/taxonomy.ts` holds the starting set the migration seeded).
 */

export interface VocabularyTopic {
  id: string;
  label: string;
}

export interface PublicVocabulary {
  /** Active mentorship topics, in their display order. */
  topics: VocabularyTopic[];
}
