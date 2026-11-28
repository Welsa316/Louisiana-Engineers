import type { Db } from "../src/db/tx";
import { SEED_REQUESTS, seedRequestId } from "./requests";

/**
 * Post-completion feedback (Task 32). The seed holds no answers: both
 * parties of the completed Layla and Idris mentorship (req-1006) see the
 * two questions. Re-seeding takes back any answer left on a seeded
 * relationship since, as the request seed puts the relationships
 * themselves back, so a spec that completes and answers one can run again.
 * Call after `seedRequests`.
 */
export async function seedFeedback(db: Db): Promise<void> {
  const requestIds = SEED_REQUESTS.map((request) => seedRequestId(request.key));
  await db.query(
    `DELETE FROM relationship_feedback f
      USING mentorship_relationships rel
      WHERE rel.id = f.relationship_id AND rel.request_id = ANY($1::uuid[])`,
    [requestIds],
  );
}
