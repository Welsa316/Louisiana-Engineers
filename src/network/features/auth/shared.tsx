/**
 * Pieces the sign-in screens share: the explanatory side panel, the Google
 * button (shown only when the server enables Google), and the panel a
 * signed-in person sees instead of a sign-in form.
 */

import { useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUpRight, LogOut, ShieldCheck } from "lucide-react";
import type { SessionUser } from "@shared/types/auth";
import { usePublicConfig, useSignOut } from "../../lib/session";
import { Notice, Star } from "../../ui/ui";

/** Where "my account" leads for a signed-in person. */
export function accountPath(user: SessionUser): string {
  if (user.hasDeletionScheduled) return "/scheduled-for-deletion";
  return user.kind === null ? "/onboarding" : "/me";
}

/** The panel beside the sign-in and check-email forms. */
export function AuthSide({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <aside className="pn-auth-side">
      <Star className="pn-hero-star" />
      <span className="pn-kicker">MEST Network</span>
      <h2 className="mt-6">{title}</h2>
      {children}
    </aside>
  );
}

/** The two promises the sign-in screens make, as a short list. */
export function AuthPromises() {
  return (
    <ul className="mt-10 grid gap-4 t-small text-fg-2 max-w-[40ch]">
      <li className="flex gap-3">
        <ShieldCheck size={16} aria-hidden="true" className="text-accent mt-0.5 shrink-0" />
        Your sign-in address is never shown on your profile.
      </li>
      <li className="flex gap-3">
        <ShieldCheck size={16} aria-hidden="true" className="text-accent mt-0.5 shrink-0" />
        You can delete your account yourself, at any time.
      </li>
    </ul>
  );
}

/**
 * "Continue with Google", rendered only when `GET /api/config/public` says
 * Google is configured. It is a full page navigation to the server, not a
 * client route. `beforeLeave` can stop it (Join checks its fields first).
 */
export function GoogleSignIn({ beforeLeave }: { beforeLeave?: () => boolean }) {
  const config = usePublicConfig();
  if (!config.data?.googleEnabled) return null;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (beforeLeave && !beforeLeave()) event.preventDefault();
  };
  return (
    <>
      <div className="pn-oauth">
        <a href="/api/auth/google" className="btn btn-outline btn-block" onClick={onClick}>
          Continue with Google
        </a>
      </div>
      <div className="pn-or">or</div>
    </>
  );
}

/**
 * Signs out and forgets the cached session, so the page re-renders as a
 * visitor. A failed request leaves the person signed in and says so.
 */
export function SignOutAction({ className = "btn btn-ghost" }: { className?: string }) {
  const signOut = useSignOut();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            await signOut();
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <LogOut size={16} aria-hidden="true" />
        Sign out
      </button>
      {failed ? (
        <p role="alert" className="t-small text-fg-2 basis-full">
          Sign-out did not go through. Check your connection and try again.
        </p>
      ) : null}
    </>
  );
}

/** Shown in place of a sign-in form to someone already signed in. */
export function SignedInPanel({ user }: { user: SessionUser }) {
  const label = user.hasDeletionScheduled
    ? "See your account"
    : user.kind === null
      ? "Finish signing up"
      : "Go to my dashboard";

  return (
    <div className="mt-6 grid gap-4">
      <Notice tone="ok">You are signed in.</Notice>
      <div className="flex flex-wrap items-center gap-4">
        <Link to={accountPath(user)} className="btn btn-solid">
          {label}
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
        <SignOutAction />
      </div>
    </div>
  );
}
