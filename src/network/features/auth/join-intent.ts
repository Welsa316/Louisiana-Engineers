/**
 * What someone chose on the Join screen before they had an account: which
 * path describes them and that they confirmed the mission statement. Kept
 * in this browser only, so onboarding (Task 14) can preselect the path; the
 * server records the mission acceptance when onboarding is submitted.
 *
 * Storage can be missing or throw (private windows, blocked site data), so
 * every access is guarded and the screens work without it.
 */

import type { ProfileKind } from "@shared/types/common";

export const JOIN_INTENT_KEY = "mest-join-intent";

export interface JoinIntent {
  kind: ProfileKind;
  missionAccepted: boolean;
}

export function isProfileKind(value: unknown): value is ProfileKind {
  return value === "student" || value === "professional";
}

export function saveJoinIntent(intent: JoinIntent): void {
  try {
    window.localStorage.setItem(JOIN_INTENT_KEY, JSON.stringify(intent));
  } catch {
    // Onboarding asks again; nothing is lost.
  }
}

export function readJoinIntent(): JoinIntent | null {
  try {
    const raw = window.localStorage.getItem(JOIN_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<JoinIntent>;
    if (!isProfileKind(parsed.kind)) return null;
    return { kind: parsed.kind, missionAccepted: parsed.missionAccepted === true };
  } catch {
    return null;
  }
}

export function clearJoinIntent(): void {
  try {
    window.localStorage.removeItem(JOIN_INTENT_KEY);
  } catch {
    // Nothing to clear.
  }
}
