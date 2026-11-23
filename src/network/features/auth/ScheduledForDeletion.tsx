/**
 * The grace-period screen (02 section 8, step 3): a member whose account is
 * scheduled for deletion sees this and nothing else after signing in. Read
 * from `GET /api/auth/me`. Visitors go to sign in, and anyone without a
 * deletion scheduled goes to their own account.
 *
 * "Keep my account" calls `DELETE /api/me/deletion`, which Task 26 adds and
 * wires here; until then the button is shown but disabled.
 */

import { Navigate } from "react-router";
import { SessionPending } from "../../app/guards";
import { useMeta } from "../../lib/meta";
import { useSession } from "../../lib/session";
import { PageHead } from "../../ui/ui";
import { accountPath, SignOutAction } from "./shared";

export function ScheduledForDeletion() {
  useMeta({ title: "Account scheduled for deletion" });
  const { user, status } = useSession();

  if (status === "loading") return <SessionPending />;
  if (!user) return <Navigate to="/signin" replace />;
  if (!user.hasDeletionScheduled) return <Navigate to={accountPath(user)} replace />;

  return (
    <div className="shell section">
      <PageHead
        kicker="Your account"
        title="Your account is scheduled for deletion"
        lead="Your profile is hidden and your open requests were closed. At the end of the 14-day grace period your account is deleted for good."
      />
      <div className="mt-10 grid gap-8 max-w-2xl">
        <ul className="pn-ledger t-body text-fg-2">
          <li className="py-4">
            Deleting removes your profile, your details, your saved profiles and your notifications. Requests you took part
            in stay in the other person&rsquo;s history under the name &ldquo;Former member&rdquo;, without anything you
            wrote.
          </li>
          <li className="py-4">
            If you keep your account, your profile and your mentorship settings return to what they were before.
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" className="btn btn-solid" disabled aria-describedby="keep-account-note">
            Keep my account
          </button>
          <SignOutAction />
        </div>
        <p id="keep-account-note" className="t-small text-fg-2">
          Keeping your account from this screen is not available yet.
        </p>
      </div>
    </div>
  );
}
