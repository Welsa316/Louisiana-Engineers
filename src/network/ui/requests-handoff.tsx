/**
 * How to reach a mentor who accepted (03 section 6.4): only the methods
 * they handed over for this relationship, each with the action that fits
 * it. A scheduling link opens; an email address and a phone number can be
 * copied as well as opened. The values arrive only in the accepted
 * mentee's `handoff`, so nothing here is ever shown to anyone else.
 */

import { useEffect, useState } from "react";
import { CalendarDays, Check, Copy, ExternalLink, Mail, Phone } from "lucide-react";
import type { ContactValue } from "@shared/types/profiles";

const ORDER: ContactValue["method"][] = ["booking", "email", "linkedin", "phone"];

const LABEL: Record<ContactValue["method"], string> = {
  booking: "Scheduling link",
  email: "Email",
  linkedin: "LinkedIn",
  phone: "Phone or text",
};

const ICON = {
  booking: CalendarDays,
  email: Mail,
  linkedin: ExternalLink,
  phone: Phone,
} as const;

const isWebLink = (value: string) => /^https?:\/\//i.test(value);

function shown(method: ContactValue["method"], value: string): string {
  if (method === "booking" || method === "linkedin") return value.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return value;
}

function hrefFor(method: ContactValue["method"], value: string): string | null {
  if (method === "email") return `mailto:${value}`;
  if (method === "phone") return `tel:${value.replace(/[^\d+]/g, "")}`;
  return isWebLink(value) ? value : null;
}

function CopyValue({ label, value }: { label: string; value: string }) {
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

export function HandoffMethods({ methods }: { methods: ContactValue[] }) {
  const sorted = [...methods].sort((a, b) => ORDER.indexOf(a.method) - ORDER.indexOf(b.method));
  return (
    <ul className="pn-contact-list">
      {sorted.map(({ method, value }) => {
        const Icon = ICON[method];
        const href = hrefFor(method, value);
        const external = method === "booking" || method === "linkedin";
        return (
          <li key={method} className="pn-contact-item">
            <span className="pn-contact-label inline-flex items-center gap-2">
              <Icon size={15} aria-hidden="true" />
              {LABEL[method]}
            </span>
            <span className="pn-contact-value">
              {href ? (
                <a className="link" href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  {shown(method, value)}
                </a>
              ) : (
                shown(method, value)
              )}
            </span>
            {method === "email" || method === "phone" ? (
              <CopyValue label={method === "email" ? "Copy email address" : "Copy phone number"} value={value} />
            ) : (
              <span aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
