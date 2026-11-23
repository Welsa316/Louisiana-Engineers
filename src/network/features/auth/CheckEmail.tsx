/**
 * "Check your email": shown after a sign-in link was requested. The address
 * arrives in router state from the form (it never goes in the URL); opened
 * directly, the page explains itself without one. Sending another link uses
 * the same endpoint, so the hourly limit applies.
 */

import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Mail } from "lucide-react";
import { useMeta } from "../../lib/meta";
import { Notice } from "../../ui/ui";
import { magicLinkErrorText, requestSignInLink, type CheckEmailState } from "./MagicLinkForm";
import { AuthSide } from "./shared";

function stateEmail(state: unknown): string | null {
  if (state && typeof state === "object" && typeof (state as CheckEmailState).email === "string") {
    return (state as CheckEmailState).email;
  }
  return null;
}

export function CheckEmail() {
  useMeta({ title: "Check your email" });
  const email = stateEmail(useLocation().state);
  const [resend, setResend] = useState<{ status: "idle" | "busy" | "sent" } | { status: "failed"; text: string }>({
    status: "idle",
  });

  return (
    <div className="pn-auth">
      <AuthSide title="One link, one sign-in.">
        <p className="t-lead text-fg-2 mt-6 max-w-[40ch]">
          The link signs you in on the device where you open it. It works once and expires after 15 minutes.
        </p>
      </AuthSide>
      <div className="pn-auth-form">
        <h1>Check your email</h1>
        <div className="mt-6">
          <Notice tone="ok" icon={<Mail size={18} aria-hidden="true" />}>
            {email ? (
              <>
                We sent a sign-in link to <strong>{email}</strong>. Open it and select Continue to finish signing in.
              </>
            ) : (
              <>If you asked for a sign-in link, it is on its way. Open it and select Continue to finish signing in.</>
            )}
          </Notice>
        </div>

        <h2 className="t-heading mt-10">No email?</h2>
        <ul className="mt-4 grid gap-2 t-body text-fg-2">
          <li>It can take a minute or two to arrive.</li>
          <li>Look in your spam or promotions folder for a message from MEST Network.</li>
          <li>Check the address for a typing mistake.</li>
        </ul>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          {email ? (
            <button
              type="button"
              className="btn btn-outline"
              disabled={resend.status === "busy"}
              onClick={async () => {
                setResend({ status: "busy" });
                try {
                  await requestSignInLink(email);
                  setResend({ status: "sent" });
                } catch (error) {
                  setResend({ status: "failed", text: magicLinkErrorText(error) });
                }
              }}
            >
              Send another link
            </button>
          ) : null}
          <Link to="/signin" className="link">
            {email ? "Use a different address" : "Request a sign-in link"}
          </Link>
        </div>

        <div aria-live="polite" className="mt-6">
          {resend.status === "sent" ? <Notice tone="ok">A new link is on its way.</Notice> : null}
        </div>
        {resend.status === "failed" ? (
          <div role="alert">
            <Notice tone="warn">{resend.text}</Notice>
          </div>
        ) : null}
      </div>
    </div>
  );
}
