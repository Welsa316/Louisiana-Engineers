/**
 * Sign in: a magic link by email, or Google when the server enables it.
 * Failed sign-ins come back here as `?error=link` (a bad, used or expired
 * link) or `?error=google` (a canceled or failed Google sign-in), each with
 * its own explanation.
 */

import { Link, useSearchParams } from "react-router";
import { SessionPending } from "../../app/guards";
import { useMeta } from "../../lib/meta";
import { usePublicConfig, useSession } from "../../lib/session";
import { Notice } from "../../ui/ui";
import { MagicLinkForm } from "./MagicLinkForm";
import { AuthPromises, AuthSide, GoogleSignIn, SignedInPanel } from "./shared";

export type SignInError = "link" | "google";

/** The message for each failure the server can send back here. */
export const SIGN_IN_ERRORS: Record<SignInError, { title: string; body: string }> = {
  link: {
    title: "That sign-in link did not work.",
    body: "Each link works once and links expire after 15 minutes. Enter your email below and we will send a new one.",
  },
  google: {
    title: "Google sign-in did not finish.",
    body: "It may have been canceled, or that email address is already linked to a different Google account. Try again, or get a sign-in link by email instead.",
  },
};

export function signInError(value: string | null): SignInError | null {
  return value === "link" || value === "google" ? value : null;
}

export function SignIn() {
  useMeta({ title: "Sign in" });
  const { user, status } = useSession();
  const [params] = useSearchParams();
  const error = signInError(params.get("error"));
  const googleEnabled = usePublicConfig().data?.googleEnabled === true;

  return (
    <div className="pn-auth">
      <AuthSide title="No passwords to remember.">
        <p className="t-lead text-fg-2 mt-6 max-w-[40ch]">
          Enter your email and we send you a link that signs you in. Or use a Google account if it is offered. Either
          way, MEST never stores a password for you.
        </p>
        <AuthPromises />
      </AuthSide>
      <div className="pn-auth-form">
        <h1>Sign in</h1>
        {status === "loading" ? (
          <SessionPending />
        ) : user ? (
          <SignedInPanel user={user} />
        ) : (
          <>
            <p className="t-small text-fg-2 mt-2">
              New here?{" "}
              <Link to="/join" className="link link-quiet">
                Join the network
              </Link>
            </p>
            {error ? (
              <div role="alert" className="mt-6">
                <Notice tone="warn">
                  <strong>{SIGN_IN_ERRORS[error].title}</strong> {SIGN_IN_ERRORS[error].body}
                </Notice>
              </div>
            ) : null}
            <GoogleSignIn />
            <div className={googleEnabled ? undefined : "mt-6"}>
              <MagicLinkForm />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
