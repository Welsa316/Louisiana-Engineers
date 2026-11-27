/**
 * `GET /api/me/saved` (Task 22): the caller's saved profiles as directory
 * cards, newest save first. Only profiles the caller can still find in the
 * directory are listed. The saved person never learns who saved them.
 */

import type { Paged } from "./common";
import type { DirectoryEntry } from "./directory";

export type SavedResponse = Paged<DirectoryEntry>;
