/**
 * Route guards. They decide what to render from the session alone; the API
 * enforces the same rules on every request (requireMember, requireAdmin and
 * the database policies), so a guard is navigation, never the security.
 */

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useSession } from "../lib/session";
import { NotFoundPage } from "./shells";

/** Shown while the session is read, so a guarded page never flashes its redirect. */
export function SessionPending() {
  return (
    <div className="pn-boot" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * Signed in, with no deletion scheduled. Visitors go to sign in (the page
 * they wanted rides along in router state); a member whose account is
 * scheduled for deletion goes to the grace screen.
 */
export function RequireMember({ children }: { children: ReactNode }) {
  const { user, status } = useSession();
  const location = useLocation();
  if (status === "loading") return <SessionPending />;
  if (!user) return <Navigate to="/signin" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (user.hasDeletionScheduled) return <Navigate to="/scheduled-for-deletion" replace />;
  return <>{children}</>;
}

/** Onboarding finished (`kind` chosen); otherwise back to onboarding. Use inside `RequireMember`. */
export function RequireOnboarded({ children }: { children: ReactNode }) {
  const { user, status } = useSession();
  if (status === "loading") return <SessionPending />;
  if (user && user.kind === null) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/** Administrators only. Anyone else sees the ordinary not-found page. Use inside `RequireMember`. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, status } = useSession();
  if (status === "loading") return <SessionPending />;
  if (!user?.isAdmin) return <NotFoundPage inApp />;
  return <>{children}</>;
}
