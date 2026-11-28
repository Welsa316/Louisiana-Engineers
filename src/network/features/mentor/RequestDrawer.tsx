/**
 * One request in the mentor's inbox (03 section 7.2), ported from the
 * prototype's request drawer: a side panel on desktop and a bottom sheet on
 * a phone (03 section 12). The mentor sees the member's program, level,
 * institution, goals and interests (a student's, while the request is
 * open), the request itself and the days left; never the member's email or
 * their other requests.
 *
 * Accept is a sheet of its own: an optional note, and checkboxes for the
 * methods the mentor uses that have a value (prefilled with the ones
 * already shown to signed-in members), at least one. "Requests through
 * MEST" is not a handoff and is never offered. A mentor with nothing else
 * (the onboarding default) is sent to Settings, Privacy and contact, with a
 * way back to this request, before anything is sent. At capacity the
 * accept explains itself; an introduction takes no place.
 *
 * Decline asks for a reason and an optional note; the member sees both and
 * nothing else.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, Clock, ShieldCheck, X } from "lucide-react";
import { limits } from "@shared/limits";
import type { RespondInput } from "@shared/schemas/request";
import { audiences, contactMethods, declineReasonOptions, type ContactMethodId } from "@shared/taxonomy";
import type { DeclineReason } from "@shared/types/common";
import type { OwnProfile, OwnSettings } from "@shared/types/me";
import type { MyMentorship, RequestDetail } from "@shared/types/requests";
import { useTopicLabels } from "../../lib/vocabulary";
import { isApiError } from "../../lib/api";
import { Drawer, Field, Monogram, Notice, Option, Select, Sheet, Textarea, Toast, fmtDate } from "../../ui/ui";
import {
  counterpartyFirstName,
  counterpartyInitials,
  counterpartyName,
  RequestStatusPill,
  requestSubject,
} from "../me/Requests";
import { useMyMentorship, useRespondToRequest } from "../me/requests-api";
import { useOwnProfile, useOwnSettings } from "../settings/api";

export type Sharable = Exclude<ContactMethodId, "mest">;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until a pending request expires, never below zero. */
export function daysLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / DAY_MS));
}

export function daysLeftLabel(expiresAt: string): string {
  const days = daysLeft(expiresAt);
  if (days === 0) return "Expires today";
  return days === 1 ? "1 day left" : `${days} days left`;
}

/** True when an accept of a mentorship request would go over the cap. */
export function atCapacity(m: MyMentorship | undefined): boolean {
  return Boolean(m && m.maxActive !== null && m.activeCount >= m.maxActive);
}

const MODE_PHRASE = { online: "online", "in-person": "in person", either: "online or in person" } as const;

const METHOD_LABEL: Record<Sharable, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  booking: "Scheduling link",
  phone: "Phone or text",
};

export function methodLabel(method: Sharable): string {
  return METHOD_LABEL[method];
}

/** The methods in the taxonomy's order. */
const ORDER = contactMethods.map((m) => m.id).filter((id): id is Sharable => id !== "mest");

export interface ShareOption {
  method: Sharable;
  /** What the mentor will hand over, as they set it. */
  detail: string;
}

const bare = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

/**
 * The methods an accept can hand over: those the mentor uses that resolve
 * to a value, by the same rule as `respond_to_request` (an email with no
 * address of its own is the sign-in address; LinkedIn needs the profile
 * link).
 */
export function shareOptions(settings: OwnSettings | undefined, profile: OwnProfile | undefined): ShareOption[] {
  const c = settings?.contact;
  if (!c) return [];
  const out: ShareOption[] = [];
  for (const method of ORDER) {
    if (!c.methods.includes(method)) continue;
    if (method === "email") out.push({ method, detail: c.contactEmail ?? "The address you sign in with" });
    if (method === "linkedin" && profile?.linkedinUrl) out.push({ method, detail: bare(profile.linkedinUrl) });
    if (method === "booking" && c.bookingUrl) out.push({ method, detail: bare(c.bookingUrl) });
    if (method === "phone" && c.phone) out.push({ method, detail: c.phone });
  }
  return out;
}

function declineReasonLabel(reason: RequestDetail["declineReason"]): string | null {
  if (!reason) return null;
  if (reason === "member_left") return "They left the network";
  return declineReasonOptions.find((o) => o.id === reason)?.label ?? null;
}

/** A phone gets a bottom sheet, a wider screen a side panel (or a dialog). */
export function usePhone(): boolean {
  const query = "(max-width: 47.99rem)";
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setPhone(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return phone;
}

function respondError(error: unknown, first: string, maxActive: number | null): string {
  if (isApiError(error, "mentor_full")) {
    return `You are at your maximum of ${maxActive ?? "your"} active mentees. Complete one or raise your maximum in settings.`;
  }
  if (isApiError(error, "mentee_unavailable")) {
    return `${first} can no longer be given contact details through MEST, so this request cannot be accepted. You can decline it instead.`;
  }
  if (isApiError(error, "invalid_share_methods")) {
    return "One of those contact methods is no longer in your settings. Check Privacy and contact, then try again.";
  }
  if (isApiError(error, "not_pending")) {
    return "This request was answered or withdrawn in the meantime. The panel now shows where it stands.";
  }
  if (isApiError(error, "invalid_decline_reason")) return "Choose a reason.";
  if (isApiError(error, "validation")) return `Keep the note to ${limits.note.max} characters or fewer.`;
  if (isApiError(error, "not_member")) {
    return "Your account is scheduled for deletion, so you cannot answer requests. Keep your account to answer them.";
  }
  if (isApiError(error, "forbidden") || isApiError(error, "not_found")) return "This request is not yours to answer.";
  if (isApiError(error, "network")) return "That did not go through. Check your connection and try again.";
  return "That did not go through. Try again in a moment.";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="pn-kicker pn-kicker-plain mb-3">{title}</h3>
      {children}
    </section>
  );
}

type Mode = "view" | "accept" | "decline";

export function RequestDrawer({
  id,
  detail,
  loadFailed,
  onRetry,
  onClose,
}: {
  id: string | undefined;
  detail: RequestDetail | undefined;
  loadFailed: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const phone = usePhone();
  const [mode, setMode] = useState<Mode>("view");
  const [note, setNote] = useState("");
  const [shares, setShares] = useState<Sharable[] | null>(null);
  const [reason, setReason] = useState<Exclude<DeclineReason, "member_left">>(declineReasonOptions[0].id);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const respond = useRespondToRequest(id ?? "");
  const mine = useMyMentorship();
  const settings = useOwnSettings();
  const profile = useOwnProfile();

  // A different request starts from nothing.
  useEffect(() => {
    setMode("view");
    setNote("");
    setShares(null);
    setReason(declineReasonOptions[0].id);
    setProblem(null);
    setDone(null);
    respond.reset();
  }, [id]);

  // Switching between the request and an answer replaces the footer button
  // that had focus, so focus moves to the heading of what is now shown.
  const modeHeading = useRef<HTMLHeadingElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const previousMode = useRef<Mode>("view");
  useEffect(() => {
    if (mode !== "view") modeHeading.current?.focus();
    else if (previousMode.current !== "view") top.current?.focus();
    previousMode.current = mode;
  }, [mode]);

  // The dialog's own close event also lands here after the route moved on.
  const close = () => {
    if (id) onClose();
  };

  const r = detail;
  const first = r ? counterpartyFirstName(r.counterparty) : "";
  const options = shareOptions(settings.data, profile.data);
  const prefilled = options
    .map((o) => o.method)
    .filter((m) => settings.data?.contact?.shareWithMembers.includes(m));
  const chosen = shares ?? prefilled;
  const capped = r?.kind === "mentorship" && atCapacity(mine.data);
  const maxActive = mine.data?.maxActive ?? null;
  const settingsReady = settings.data !== undefined && profile.data !== undefined;

  const toggle = (method: Sharable) => {
    setProblem(null);
    setShares((current) => {
      const list = current ?? prefilled;
      return list.includes(method) ? list.filter((m) => m !== method) : ORDER.filter((m) => m === method || list.includes(m));
    });
  };

  const send = (answer: RespondInput, confirmation: string) => {
    setProblem(null);
    respond.mutate(answer, {
      onSuccess: () => {
        setMode("view");
        setDone(confirmation);
      },
      onError: (error) => setProblem(respondError(error, first, maxActive)),
    });
  };

  const accept = () => {
    if (chosen.length === 0) {
      setProblem(`Choose at least one way for ${first} to reach you.`);
      return;
    }
    send(
      { decision: "accept", note: note.trim() || undefined, shareMethods: chosen },
      `Accepted. ${first} can now see how to reach you.`,
    );
  };
  const decline = () =>
    send(
      { decision: "decline", note: note.trim() || undefined, declineReason: reason },
      `Declined. ${first} sees your reason${note.trim() ? " and note" : ""}, nothing else.`,
    );

  const back = () => {
    setMode("view");
    setProblem(null);
  };

  let footer: ReactNode;
  if (r && r.status === "pending") {
    if (mode === "view") {
      footer = (
        <>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              setProblem(null);
              setMode("decline");
            }}
          >
            <X size={15} aria-hidden="true" />
            Decline
          </button>
          <button
            type="button"
            className="btn btn-solid btn-sm"
            disabled={capped}
            aria-describedby={capped ? "pn-accept-capped" : undefined}
            onClick={() => {
              setProblem(null);
              setMode("accept");
            }}
          >
            <Check size={15} aria-hidden="true" />
            Accept
          </button>
        </>
      );
    } else {
      const canAccept = mode === "decline" || (settingsReady && options.length > 0);
      footer = (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={back}>
            Back
          </button>
          {canAccept ? (
            <button
              type="button"
              className={mode === "accept" ? "btn btn-solid btn-sm" : "btn btn-danger btn-sm"}
              disabled={respond.isPending}
              aria-busy={respond.isPending || undefined}
              onClick={mode === "accept" ? accept : decline}
            >
              {respond.isPending ? "Sending" : mode === "accept" ? "Accept and share" : "Send decline"}
            </button>
          ) : null}
        </>
      );
    }
  } else if (r && r.status === "accepted") {
    footer = (
      <Link to={`/mentor/mentees/${r.id}`} className="btn btn-solid btn-sm">
        Open relationship
        <ArrowRight size={15} aria-hidden="true" />
      </Link>
    );
  }

  const Panel = phone ? Sheet : Drawer;
  const title = r ? counterpartyName(r.counterparty) : loadFailed ? "Request" : "Loading the request";

  return (
    <Panel open={Boolean(id)} onClose={close} title={title} footer={footer}>
      {!r ? (
        loadFailed ? (
          <Notice tone="warn">
            <p>The request did not load. Check your connection and try again.</p>
            <button type="button" className="btn btn-outline btn-sm mt-3" onClick={onRetry}>
              Try again
            </button>
          </Notice>
        ) : (
          <p className="t-small text-fg-2" role="status">
            Loading the request
          </p>
        )
      ) : (
        <div className="grid gap-6">
          {done ? <Toast text={done} /> : null}
          <div ref={top} tabIndex={-1}>
            <Header r={r} />
          </div>

          {problem ? (
            <div role="alert">
              <Notice tone="warn">{problem}</Notice>
            </div>
          ) : null}

          {mode === "view" && <View r={r} capped={capped} maxActive={maxActive} />}

          {mode !== "view" && (
            <h3 ref={modeHeading} tabIndex={-1} className="t-heading">
              {mode === "accept" ? `Accept ${first}'s request` : `Decline ${first}'s request`}
            </h3>
          )}

          {mode === "accept" && (
            <div className="grid gap-5">
              {!settingsReady ? (
                <p className="t-small text-fg-2" role="status">
                  Loading your contact methods
                </p>
              ) : options.length === 0 ? (
                <Notice tone="info">
                  <p>
                    <strong>Add a way for {first} to reach you first.</strong> Requests through MEST is not a way to reach
                    you directly, so an accept needs an email, LinkedIn, a scheduling link or a phone number. Add one under
                    Privacy and contact, then come back to this request.
                  </p>
                  <p className="mt-3">
                    <Link
                      to={`/settings/privacy?back=${encodeURIComponent(`/mentor/requests/${r.id}`)}`}
                      className="btn btn-outline btn-sm"
                    >
                      Add a contact method
                    </Link>
                  </p>
                </Notice>
              ) : (
                <>
                  <fieldset className="pn-fieldset">
                    <legend className="t-small">Share with {first}</legend>
                    <p className="pn-field-hint mb-3">
                      Only {first} sees these, and only for this mentorship. Choose at least one.
                    </p>
                    <div className="pn-options">
                      {options.map((o) => (
                        <Option
                          key={o.method}
                          multi
                          checked={chosen.includes(o.method)}
                          title={methodLabel(o.method)}
                          note={o.detail}
                          onClick={() => toggle(o.method)}
                        />
                      ))}
                    </div>
                    <p className="pn-field-hint mt-3">
                      To share another method, add it under{" "}
                      <Link
                        to={`/settings/privacy?back=${encodeURIComponent(`/mentor/requests/${r.id}`)}`}
                        className="link"
                      >
                        Privacy and contact
                      </Link>
                      .
                    </p>
                  </fieldset>
                  <Field
                    label="A short note"
                    optional
                    hint={`Suggest how to start: pick a time from your link, send a resume ahead. Up to ${limits.note.max} characters.`}
                  >
                    {(fieldId) => (
                      <Textarea
                        id={fieldId}
                        value={note}
                        maxLength={limits.note.max}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    )}
                  </Field>
                  <p className="t-small text-fg-2 inline-flex gap-2">
                    <ShieldCheck size={15} aria-hidden="true" className="shrink-0 mt-0.5" />
                    Meet in public places; MEST does not supervise meetings.
                  </p>
                </>
              )}
            </div>
          )}

          {mode === "decline" && (
            <div className="grid gap-5">
              <p className="t-body">
                {first} sees your reason and note, nothing else. A kind decline with a pointer to someone else is worth a
                lot.
              </p>
              <Field label="Reason">
                {(fieldId) => (
                  <Select
                    id={fieldId}
                    value={reason}
                    onChange={(e) => setReason(e.target.value as Exclude<DeclineReason, "member_left">)}
                  >
                    {declineReasonOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={`Note to ${first}`} optional hint={`Up to ${limits.note.max} characters.`}>
                {(fieldId) => (
                  <Textarea
                    id={fieldId}
                    value={note}
                    maxLength={limits.note.max}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
              </Field>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Header({ r }: { r: RequestDetail }) {
  const m = r.mentee;
  const line = m
    ? [m.program, m.institution].filter(Boolean).join(" · ")
    : [r.counterparty.title, r.counterparty.organization].filter(Boolean).join(" · ");
  return (
    <div className="flex items-start gap-4">
      <Monogram initials={counterpartyInitials(r.counterparty)} size="lg" student={r.counterparty.kind === "student"} />
      <div className="min-w-0">
        <RequestStatusPill status={r.status} pill />
        {line ? <div className="pn-row-title mt-2">{line}</div> : null}
        {m ? (
          <div className="pn-row-meta">{audiences.find((a) => a.id === m.level)?.label ?? ""}</div>
        ) : null}
      </div>
    </div>
  );
}

function View({ r, capped, maxActive }: { r: RequestDetail; capped: boolean; maxActive: number | null }) {
  const topicLabels = useTopicLabels();
  const first = counterpartyFirstName(r.counterparty);
  const m = r.mentee;
  const reason = declineReasonLabel(r.declineReason);
  return (
    <>
      {r.status === "pending" && (
        <Notice icon={<Clock size={16} aria-hidden="true" />}>
          Sent {fmtDate(r.createdAt)}. {daysLeftLabel(r.expiresAt)}: it closes on {fmtDate(r.expiresAt, true)} if there
          is no answer.
        </Notice>
      )}
      {r.status === "pending" && capped && (
        <div id="pn-accept-capped">
          <Notice tone="warn">
            You are at your maximum of {maxActive} active mentees. Complete one or raise your maximum in{" "}
            <Link to="/settings/mentorship" className="link">
              settings
            </Link>
            .
          </Notice>
        </div>
      )}
      <Section title="Asking about">
        <p className="t-heading">{requestSubject(r)}</p>
        <p className="t-small text-fg-2 mt-1">
          {r.format === "one-time" ? "One conversation" : "Recurring"} · {MODE_PHRASE[r.mode]}
          {r.schedulingNote && ` · ${r.schedulingNote}`}
        </p>
      </Section>
      <Section title="Their message">
        {r.textPurged ? (
          <p className="t-small text-fg-2">
            The text of this request was removed after the retention period. Its dates and status are kept.
          </p>
        ) : (
          <>
            <p className="t-body whitespace-pre-line">{r.why}</p>
            {r.goals && (
              <p className="t-body text-fg-2 mt-3 whitespace-pre-line">
                <span className="text-fg">Success looks like:</span> {r.goals}
              </p>
            )}
          </>
        )}
      </Section>
      {m && (
        <Section title={`About ${first}`}>
          <p className="t-small whitespace-pre-line">{m.goals}</p>
          {m.topicsNeeded.length > 0 && (
            <p className="t-small text-fg-2 mt-3">
              <span className="text-fg">Looking for help with:</span> {topicLabels(m.topicsNeeded).join(", ")}
            </p>
          )}
          {m.interests.length > 0 && (
            <div className="pn-tags mt-3">
              {m.interests.map((i) => (
                <span key={i} className="pn-tag pn-tag-quiet">
                  {i}
                </span>
              ))}
            </div>
          )}
        </Section>
      )}
      {r.status === "declined" && reason && (
        <Section title="Your reason">
          <p className="t-body">{reason}</p>
        </Section>
      )}
      {r.mentorNote && (
        <Section title="Your note">
          <p className="t-body text-fg-2 whitespace-pre-line">{r.mentorNote}</p>
        </Section>
      )}
      {r.relationship && r.relationship.sharedMethods.length > 0 && (
        <Section title="What you shared">
          <div className="pn-tags">
            {r.relationship.sharedMethods.map((method) => (
              <span key={method} className="pn-tag pn-tag-quiet">
                {methodLabel(method)}
              </span>
            ))}
          </div>
        </Section>
      )}
      {r.status === "canceled" && (
        <p className="t-small text-fg-2">{first} withdrew this request. There is nothing for you to do.</p>
      )}
      {r.status === "expired" && (
        <p className="t-small text-fg-2">This request closed without an answer on {fmtDate(r.expiresAt, true)}.</p>
      )}
    </>
  );
}
