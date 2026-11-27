import { z } from "zod";
import { limits } from "../limits";

/**
 * `POST /api/me/deletion`: the member confirms by typing their first name
 * (02 section 8, step 1). A member who never finished joining has no name
 * on file and types "delete" instead. The comparison ignores case and
 * surrounding spaces; the server makes it against the stored name.
 */
export const deletionRequestSchema = z.object({
  confirmName: z.string().trim().min(1).max(limits.name.max),
});

export type DeletionRequestInput = z.infer<typeof deletionRequestSchema>;

/** What a member with no first name on file types to confirm. */
export const DELETION_FALLBACK_WORD = "delete";

/** Whether `typed` confirms the deletion of an account whose first name is `firstName`. */
export function confirmsDeletion(typed: string, firstName: string | null): boolean {
  const expected = (firstName ?? "").trim() || DELETION_FALLBACK_WORD;
  return typed.trim().toLocaleLowerCase("en-US") === expected.toLocaleLowerCase("en-US");
}
