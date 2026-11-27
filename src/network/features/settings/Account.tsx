/**
 * Settings, Account (03 section 10; 02 section 8): a copy of your data, and
 * deleting the account. Deleting asks the member to type their first name
 * (step 1), then `POST /api/me/deletion` hides the profile at once, closes
 * waiting requests and starts the 14-day grace period; the session then
 * says a deletion is scheduled, and the app shows only the grace screen.
 */

import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Download } from "lucide-react";
import { confirmsDeletion, DELETION_FALLBACK_WORD } from "@shared/schemas/account";
import { limits } from "@shared/limits";
import { useMeta } from "../../lib/meta";
import { Card, Input, Notice, PageHead } from "../../ui/ui";
import { settingsErrorText, useOwnProfile } from "./api";
import { deletionErrorText, useRequestDeletion } from "./deletion-api";

export function AccountSettings() {
  useMeta({ title: "Account settings" });
  const profile = useOwnProfile();

  return (
    <>
      <PageHead
        kicker="Account"
        title="Your data and your account."
        lead="Take a copy of what MEST Network holds about you, or delete your account."
      />
      {profile.error ? (
        <div role="alert" className="mt-8">
          <Notice tone="warn">{settingsErrorText(profile.error)}</Notice>
        </div>
      ) : !profile.data ? (
        <p className="mt-8 t-small text-fg-2">Loading your account</p>
      ) : (
        <div className="pn-split mt-8">
          <div className="grid grid-cols-1 gap-6 min-w-0">
            <ExportCard />
            <DeleteCard firstName={profile.data.firstName} />
          </div>
          <aside className="grid grid-cols-1 gap-6 min-w-0" aria-label="What deleting keeps">
            <Card title="What stays after deletion" lift>
              <ul className="grid gap-3 t-small text-fg-2">
                <li>
                  Requests you took part in stay in the other person&rsquo;s history, under the name &ldquo;Former
                  member&rdquo; and without anything you wrote.
                </li>
                <li>Counts MEST uses for its program statistics, with no name attached.</li>
                <li>Reports you filed, without your name, so moderation decisions keep their record.</li>
              </ul>
            </Card>
            <Card title="Need a break instead?">
              <p className="t-small text-fg-2">
                You can hide your profile or pause mentorship under Privacy and contact or Mentorship. Nothing is deleted
                and you can come back at any time.
              </p>
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}

function ExportCard() {
  return (
    <Card title="Download your data">
      <p className="t-small text-fg-2">
        One file with your profile, settings, the requests you sent and received, your mentorships, your notifications
        and the account history MEST keeps about you. Other members appear by name only.
      </p>
      <div className="mt-5">
        <a href="/api/me/export" className="btn btn-outline btn-sm" download>
          <Download size={16} aria-hidden="true" />
          Download my data
        </a>
      </div>
    </Card>
  );
}

function DeleteCard({ firstName }: { firstName: string | null }) {
  const navigate = useNavigate();
  const request = useRequestDeletion();
  const [typed, setTyped] = useState("");
  const [attempted, setAttempted] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const word = firstName?.trim() || DELETION_FALLBACK_WORD;
  const matches = confirmsDeletion(typed, firstName);
  const localError = attempted && !matches ? `Type ${word} to confirm.` : null;
  const error = localError ?? (request.error ? deletionErrorText(request.error) : null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!matches || request.isPending) return;
    request.mutate(typed.trim(), {
      onSuccess: () => navigate("/scheduled-for-deletion", { replace: true }),
    });
  };

  return (
    <Card title="Delete your account">
      <ol className="pn-ledger t-small text-fg-2">
        <li className="py-3">Your profile leaves the directory at once and mentoring is turned off.</li>
        <li className="py-3">
          Requests still waiting are closed. People who asked you are told you left; requests you sent are withdrawn.
        </li>
        <li className="py-3">
          For 14 days you can change your mind: sign in and choose Keep my account, and everything comes back as it was.
        </li>
        <li className="py-3">
          After that your profile, details, contact information, saved profiles and notifications are deleted, and your
          sign-in address is removed. This cannot be undone.
        </li>
      </ol>
      <form className="mt-5 grid gap-4" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label pn-field-label t-small" htmlFor={inputId}>
            <span>
              Type <strong className="text-fg">{word}</strong> to confirm
            </span>
          </label>
          <Input
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={limits.name.max}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={localError ? true : undefined}
          />
          <p id={hintId} className="pn-field-hint">
            {firstName ? "Your first name as it appears on your profile." : "You have no name on your profile yet."}
          </p>
        </div>
        {error ? (
          <div id={errorId} role="alert">
            <Notice tone="warn">{error}</Notice>
          </div>
        ) : null}
        <div>
          <button type="submit" className="btn btn-danger btn-sm" disabled={request.isPending}>
            {request.isPending ? "Deleting" : "Delete my account"}
          </button>
        </div>
      </form>
    </Card>
  );
}
