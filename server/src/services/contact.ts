import type { ContactValue } from "@shared/types/profiles";
import type { Db } from "../db/tx";

/**
 * Contact values for one profile, as the caller may receive them. The only
 * source is `release_contact(profile_id)`, which checks membership, applies
 * the methods the professional shares with members, resolves each value and
 * writes the `contact.viewed` audit entry; this module never reads
 * `contact_preferences`, `users` or `profiles.linkedin_url` itself.
 */
export async function releaseContact(db: Db, profileId: string): Promise<ContactValue[]> {
  return db.query<ContactValue>("SELECT r.method::text AS method, r.value FROM release_contact($1) AS r", [profileId]);
}
