/**
 * The email field and button that ask for a sign-in link, shared by Sign in
 * and Join. The server always answers 202 for a well-formed address (so the
 * form cannot reveal whether an account exists); the only refusals are an
 * invalid address and the hourly limit. On success the person goes to
 * /check-email with the address in router state, never in the URL.
 */

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { magicLinkSchema } from "@shared/schemas/auth";
import { api, isApiError } from "../../lib/api";
import { Input, Notice } from "../../ui/ui";

export interface CheckEmailState {
  email: string;
}

/** Plain-language text for a failed link request. */
export function magicLinkErrorText(error: unknown): string {
  if (isApiError(error, "rate_limited")) {
    return "Too many sign-in links were requested for this address or from this network in the last hour. Wait a while, then try again.";
  }
  if (isApiError(error, "validation")) return "Enter a valid email address, like name@example.com.";
  if (isApiError(error, "network")) return "We could not reach MEST Network. Check your connection and try again.";
  return "Something went wrong on our side and no link was sent. Try again in a few minutes.";
}

/** Posts the magic-link request; resolves with the trimmed address that was sent. */
export async function requestSignInLink(email: string): Promise<string> {
  await api("/auth/magic-link", { method: "POST", body: { email } });
  return email;
}

export function MagicLinkForm({
  beforeSend,
  onSent,
  children,
}: {
  /** Runs first; return false to stop (Join checks its own fields here). */
  beforeSend?: () => boolean;
  /** Runs after the server accepted the request, before moving on. */
  onSent?: (email: string) => void;
  /** Extra fields shown above the email field. */
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  const inputId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendError(null);
    const parsed = magicLinkSchema.safeParse({ email });
    setFieldError(parsed.success ? null : "Enter a valid email address, like name@example.com.");
    const ready = beforeSend ? beforeSend() : true;
    // When only the email is wrong, put the cursor back in it. (When the
    // caller's own fields are missing too, it has already focused the first.)
    if (!parsed.success && ready) inputRef.current?.focus();
    if (!parsed.success || !ready) return;

    setBusy(true);
    try {
      const sentTo = await requestSignInLink(parsed.data.email);
      onSent?.(sentTo);
      navigate("/check-email", { state: { email: sentTo } satisfies CheckEmailState });
    } catch (error) {
      setSendError(magicLinkErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pn-form" noValidate onSubmit={submit}>
      {children}
      <div className="field">
        <label className="field-label pn-field-label t-small" htmlFor={inputId}>
          Email
        </label>
        <Input
          ref={inputRef}
          id={inputId}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? errorId : undefined}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        {fieldError ? (
          <p id={errorId} role="alert" className="field-error t-small">
            {fieldError}
          </p>
        ) : null}
      </div>
      {sendError ? (
        <div role="alert">
          <Notice tone="warn">{sendError}</Notice>
        </div>
      ) : null}
      <button type="submit" className="btn btn-solid" disabled={busy} aria-busy={busy || undefined}>
        {busy ? "Sending" : "Email me a sign-in link"}
        <ArrowUpRight size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
