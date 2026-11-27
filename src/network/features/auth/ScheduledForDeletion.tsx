/**
 * The grace-period screen (02 section 8, step 3): a member whose account is
 * scheduled for deletion sees this and nothing else after signing in:
 * "Your account is scheduled for deletion on [date]. Keep my account." The
 * date comes from `GET /api/me/deletion`; Keep my account calls
 * `DELETE /api/me/deletion`, and the re-read session sends the member back
 * to their own account. An account an
 * administrator removed has no grace period and cannot be kept here.
 * Visitors go to sign in, and anyone without a deletion scheduled goes to
 * their own account.
 */

import { Navigate } from "react-router";
import { SessionPending } from "../../app/guards";
import { useMeta } from "../../lib/meta";
import { useSession } from "../../lib/session";
import { Notice, PageHead } from "../../ui/ui";
import { deletionErrorText, formatDeletionDay, useDeletion, useKeepAccount } from "../settings/deletion-api";
import { accountPath, SignOutAction } from "./shared";

export function ScheduledForDeletion() {
  useMeta({ title: "Account scheduled for deletion" });
  const { user, status } = useSession();
  const scheduled = Boolean(user?.hasDeletionScheduled);
  const deletion = useDeletion(scheduled);
  const keep = useKeepAccount();

  // Keeping the account re-reads the session, which lands here: off to the
  // member's own account.
  if (status === "loading") return <SessionPending />;
  if (!user) return <Navigate to="/signin" replace />;
  if (!user.hasDeletionScheduled) return <Navigate to={accountPath(user)} replace />;

  const open = deletion.data?.deletion ?? null;
  const removed = open?.immediate === true;
  const day = open ? formatDeletionDay(open.executeOn) : null;

  const title = removed
    ? "An administrator removed your account"
    : day
      ? `Your account is scheduled for deletion on ${day}`
      : "Your account is scheduled for deletion";
  const lead = removed
    ? "Your profile is hidden and your open requests were closed. The account is deleted at the next daily sweep."
    : "Your profile is hidden and your open requests were closed. Until then you can keep your account, and everything comes back as it was.";

  return (
    <div className="shell section">
      <PageHead kicker="Your account" title={title} lead={lead} />
      <div className="mt-10 grid gap-8 max-w-2xl">
        {deletion.error ? (
          <div role="alert">
            <Notice tone="warn">{deletionErrorText(deletion.error)}</Notice>
          </div>
        ) : null}
        <ul className="pn-ledger t-body text-fg-2">
          <li className="py-4">
            Deleting removes your profile, your details, your saved profiles and your notifications, and your sign-in
            address. Requests you took part in stay in the other person&rsquo;s history under the name &ldquo;Former
            member&rdquo;, without anything you wrote.
          </li>
          {removed ? (
            <li className="py-4">If you think this is a mistake, write to the MEST team before then.</li>
          ) : (
            <li className="py-4">
              If you keep your account, your profile visibility and your mentorship settings return to what they were
              before. Requests that were closed stay closed.
            </li>
          )}
        </ul>
        {keep.error ? (
          <div role="alert">
            <Notice tone="warn">{deletionErrorText(keep.error)}</Notice>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          {removed ? null : (
            <button
              type="button"
              className="btn btn-solid"
              disabled={keep.isPending || deletion.isPending}
              onClick={() => keep.mutate()}
            >
              {keep.isPending ? "Keeping your account" : "Keep my account"}
            </button>
          )}
          <SignOutAction />
        </div>
      </div>
    </div>
  );
}
