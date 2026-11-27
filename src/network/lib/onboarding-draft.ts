/**
 * Unfinished onboarding, kept in this browser so a member can leave and pick
 * up where they stopped (03 section 5). One draft per account, under
 * `mest-onboarding-<userId>`; it is removed when onboarding is submitted and
 * when anyone signs out on this device, so the next person to sign in here
 * never sees it.
 *
 * Storage can be missing or throw (private windows, blocked site data), so
 * every access is guarded and onboarding works without it.
 */

export const ONBOARDING_DRAFT_PREFIX = "mest-onboarding-";

export function onboardingDraftKey(userId: string): string {
  return `${ONBOARDING_DRAFT_PREFIX}${userId}`;
}

export function readOnboardingDraft<T>(userId: string): T | null {
  try {
    const raw = window.localStorage.getItem(onboardingDraftKey(userId));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeOnboardingDraft(userId: string, draft: unknown): void {
  try {
    window.localStorage.setItem(onboardingDraftKey(userId), JSON.stringify(draft));
  } catch {
    // Nothing is saved; onboarding still works in this tab.
  }
}

export function removeOnboardingDraft(userId: string): void {
  try {
    window.localStorage.removeItem(onboardingDraftKey(userId));
  } catch {
    // Nothing to remove.
  }
}

/** Removes every account's draft on this device (sign-out). */
export function clearOnboardingDrafts(): void {
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(ONBOARDING_DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}
