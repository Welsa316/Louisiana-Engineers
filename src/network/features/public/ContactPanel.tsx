/**
 * The Contact section of a profile (A1, hybrid visibility). A visitor is
 * asked to sign in and the contact endpoint is never called for them; a
 * signed-in member sees only the methods the professional chose to share
 * with members, each with a copy button. The values come from
 * `GET /api/profiles/:id/contact`, which is `release_contact` on the server
 * (it applies the sharing rules and records the view).
 */

import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { Check, Copy } from "lucide-react";
import type { ContactValue } from "@shared/types/profiles";
import { isApiError } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useProfileContact } from "./directory-api";

const METHOD: Record<ContactValue["method"], { label: string; copy: string; href: (value: string) => string | null }> = {
  booking: { label: "Booking link", copy: "Copy booking link", href: (v) => (/^https?:\/\//i.test(v) ? v : null) },
  email: { label: "Email", copy: "Copy email address", href: (v) => `mailto:${v}` },
  linkedin: { label: "LinkedIn", copy: "Copy LinkedIn", href: (v) => (/^https?:\/\//i.test(v) ? v : null) },
  phone: { label: "Phone", copy: "Copy phone number", href: (v) => `tel:${v.replace(/[^\d+]/g, "")}` },
};

const ORDER: ContactValue["method"][] = ["booking", "email", "linkedin", "phone"];

/** A URL without its scheme and trailing slash, as people read it. */
function shown(method: ContactValue["method"], value: string): string {
  if (method === "booking" || method === "linkedin") return value.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return value;
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="pn-icon-btn pn-contact-copy"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

function SignInPrompt({ firstName }: { firstName: string }) {
  const location = useLocation();
  return (
    <div className="pn-contact-signin">
      <p className="t-body">Sign in to see how to reach {firstName}.</p>
      <p className="t-small text-fg-2 measure-wide">
        Contact details are shown only to signed-in members, and only the ones {firstName} chose to share.
      </p>
      <Link
        to="/signin"
        state={{ from: `${location.pathname}${location.search}` }}
        className="btn btn-outline btn-sm mt-4"
      >
        Sign in
      </Link>
    </div>
  );
}

export function ContactPanel({ profileId, firstName, isOwner }: { profileId: string; firstName: string; isOwner: boolean }) {
  const { user, status } = useSession();
  const headingId = useId();
  const member = Boolean(user);
  const contact = useProfileContact(profileId, member);
  const methods = [...(contact.data?.methods ?? [])].sort((a, b) => ORDER.indexOf(a.method) - ORDER.indexOf(b.method));

  let body;
  if (status === "loading") {
    body = null;
  } else if (!member || isApiError(contact.error, "unauthenticated")) {
    body = <SignInPrompt firstName={firstName} />;
  } else if (contact.isPending) {
    body = (
      <p className="t-small text-fg-2" role="status">
        Loading contact details
      </p>
    );
  } else if (contact.isError) {
    body = (
      <p className="t-small text-fg-2" role="alert">
        Contact details did not load.{" "}
        <button type="button" className="link" onClick={() => void contact.refetch()}>
          Try again
        </button>
      </p>
    );
  } else if (!methods.length) {
    body = (
      <p className="t-body text-fg-2 measure-wide">
        {isOwner
          ? "You are not sharing any contact details with members. Members can still reach you through MEST requests."
          : `${firstName} has not shared contact details with members and prefers requests through MEST.`}
      </p>
    );
  } else {
    body = (
      <>
        <ul className="pn-contact-list">
          {methods.map(({ method, value }) => {
            const meta = METHOD[method];
            const href = meta.href(value);
            const text = shown(method, value);
            return (
              <li key={method} className="pn-contact-item">
                <span className="pn-contact-label">{meta.label}</span>
                <span className="pn-contact-value">
                  {href ? (
                    <a
                      className="link"
                      href={href}
                      {...(method === "booking" || method === "linkedin"
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                    >
                      {text}
                    </a>
                  ) : (
                    text
                  )}
                </span>
                <CopyButton label={meta.copy} value={value} />
              </li>
            );
          })}
        </ul>
        <p className="t-small text-fg-2 mt-4 measure-wide">
          {isOwner
            ? "Signed-in members see these. Change what you share in your settings."
            : `${firstName} shares these with signed-in members. Please keep them to professional contact.`}
        </p>
      </>
    );
  }

  return (
    <section className="pn-section" aria-labelledby={headingId}>
      <h2 id={headingId}>Contact</h2>
      {body}
    </section>
  );
}
