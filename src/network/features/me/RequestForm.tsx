/**
 * Send a mentorship or introduction request
 * (`/network/me/requests/new?mentor=:id[&kind=introduction]`, 03 section
 * 6.3), ported from the prototype's request steps: Topic, Your message,
 * Format, Review. An introduction (networking) skips the topic and is one
 * conversation, so only the place is a choice.
 *
 * Before the steps open, the form checks what it can already see: the
 * profile, `GET /api/mentors/:id/availability`, and the caller's open
 * requests (one open request per pair). Anything it cannot see, such as
 * the pending cap or the daily limit, the server decides at send: every
 * `409` code becomes the matching message from the prototype's gating
 * screens, with the next useful step. Nothing is sent until "Send request".
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, ArrowRight, ArrowUpRight, Lock } from "lucide-react";
import { limits } from "@shared/limits";
import { createRequestSchema, type CreateRequestInput } from "@shared/schemas/request";
import type { MeetingMode, RequestFormat, RequestKind } from "@shared/types/common";
import type { ProfileView } from "@shared/types/directory";
import type { MentorAvailability, MyMentorship, RequestSummary } from "@shared/types/requests";
import { ApiError, isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { Card, Field, Input, Monogram, Notice, Option, Steps, Textarea } from "../../ui/ui";
import { useTopicLabels } from "../../lib/vocabulary";
import { displayName, initialsOf } from "../public/Directory";
import { useProfile } from "../public/directory-api";
import { calendarDay, requestFormPath } from "./RequestActions";
import { useAvailability, useCreateRequest, useMyMentorship, useOpenMenteeRequests } from "./requests-api";

type StepId = "topic" | "message" | "format" | "review";

const STEP_LABEL: Record<StepId, string> = {
  topic: "Topic",
  message: "Your message",
  format: "Format",
  review: "Review",
};

const STEPS: Record<RequestKind, StepId[]> = {
  mentorship: ["topic", "message", "format", "review"],
  introduction: ["message", "format", "review"],
};

const FORMAT_TEXT: Record<RequestFormat, string> = { "one-time": "One conversation", recurring: "Recurring" };
const MODE_TEXT: Record<MeetingMode, string> = { online: "Online", "in-person": "In person", either: "Either works" };
const MODE_PHRASE: Record<MeetingMode, string> = { online: "online", "in-person": "in person", either: "online or in person" };

/** Why the steps do not open, or why a send was refused. */
type GateReason =
  | "duplicate"
  | "pending_cap"
  | "paused"
  | "full"
  | "unavailable"
  | "no_introductions"
  | "platform_paused"
  | "rate_limited"
  | "not_onboarded"
  | "not_allowed";

/** The server's refusal codes, as the gate they open. Codes not listed stay on the review step. */
function gateFor(code: string, availability: MentorAvailability | undefined): GateReason | null {
  switch (code) {
    case "duplicate":
      return "duplicate";
    case "pending_cap":
      return "pending_cap";
    case "mentor_full":
      return "full";
    case "mentor_unavailable":
      return availability?.state === "paused" ? "paused" : "unavailable";
    case "platform_paused":
      return "platform_paused";
    case "rate_limited":
      return "rate_limited";
    case "not_onboarded":
      return "not_onboarded";
    case "not_member":
    case "forbidden":
      return "not_allowed";
    default:
      return null;
  }
}

const charCount = (s: string) => Array.from(s.trim()).length;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstNameOf(profile: ProfileView): string {
  return profile.firstName?.trim() || "this member";
}

/** Moves focus to a step's heading when it changes, so a screen reader announces it. */
function useFocusOnChange(key: unknown) {
  const ref = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.focus();
  }, [key]);
  return ref;
}

function BackToProfile({ mentorId, firstName }: { mentorId: string; firstName: string }) {
  return (
    <Link to={`/me/discover/${mentorId}`} className="link link-quiet t-small">
      <ArrowLeft size={14} aria-hidden="true" />
      Back to {firstName}'s profile
    </Link>
  );
}

/* ------------------------------------------------------------------ gates */

function Gate({
  reason,
  profile,
  kind,
  resumeOn,
  announce = false,
}: {
  reason: GateReason;
  profile: ProfileView;
  kind: RequestKind;
  resumeOn?: string;
  /** A refusal replaced the steps in place: move focus to the news. A page that opens on a gate does not. */
  announce?: boolean;
}) {
  const firstName = firstNameOf(profile);
  const open = useOpenMenteeRequests();
  const mine = useMyMentorship();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (announce) heading.current?.focus();
  }, [reason, announce]);

  const existing = open.data?.items.find((r) => r.role === "mentee" && r.counterparty.id === profile.id);
  const networking = profile.participation.includes("networking");
  const findOthers = (
    <Link to="/me/discover" className="btn btn-solid">
      Find other mentors
      <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
  const introInstead =
    kind === "mentorship" && networking ? (
      <Link to={requestFormPath(profile.id, "introduction")} className="btn btn-outline">
        Request an introduction instead
      </Link>
    ) : null;

  let title: string;
  let lead: string;
  let actions: ReactNode;
  switch (reason) {
    case "duplicate":
      title =
        existing?.status === "accepted"
          ? `You are already working with ${firstName}.`
          : `You already have a request with ${firstName}.`;
      lead = "You can have one open request with each person. Open it to see where it stands.";
      actions = existing ? (
        <Link to={`/me/requests/${existing.id}`} className="btn btn-solid">
          Open your request
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      ) : (
        <Link to="/me/requests" className="btn btn-solid">
          See my requests
        </Link>
      );
      break;
    case "pending_cap": {
      const n = mine.data?.pendingOutgoing;
      title = n ? `You have ${n} requests waiting.` : "You have as many requests waiting as you can.";
      lead = "Withdraw one or wait for an answer, then come back.";
      actions = (
        <Link to="/me/requests" className="btn btn-solid">
          See my requests
        </Link>
      );
      break;
    }
    case "paused":
      title = `${firstName} is not taking requests right now.`;
      lead = `${firstName} paused mentoring${resumeOn ? ` until ${calendarDay(resumeOn)}` : ""}. Save the profile and check back, or find someone else who covers the same topic.`;
      actions = (
        <>
          {findOthers}
          {introInstead}
        </>
      );
      break;
    case "full":
      title = `${firstName} is not taking requests right now.`;
      lead = `${firstName}'s mentoring places are full. Save the profile and check back, or find someone else who covers the same topic.`;
      actions = (
        <>
          {findOthers}
          {introInstead}
        </>
      );
      break;
    case "unavailable":
      title = `${firstName} is not taking requests right now.`;
      lead = "Save the profile and check back, or find someone else who covers the same topic.";
      actions = (
        <>
          {findOthers}
          {introInstead}
        </>
      );
      break;
    case "no_introductions":
      title = `${firstName} is not open to introductions.`;
      lead = `${firstName} has not listed networking on their profile. If they offer mentorship, you can ask about one of their topics instead.`;
      actions = findOthers;
      break;
    case "platform_paused":
      title = "Requests are paused for now.";
      lead = "MEST has paused new requests for a short while. Nothing was sent. Please try again later.";
      actions = (
        <Link to="/me" className="btn btn-solid">
          Back to home
        </Link>
      );
      break;
    case "rate_limited":
      title = "That is the most requests for one day.";
      lead = "Nothing was sent. You can send more tomorrow.";
      actions = (
        <Link to="/me/requests" className="btn btn-solid">
          See my requests
        </Link>
      );
      break;
    case "not_onboarded":
      title = "Finish joining to send requests.";
      lead = "Requests carry your profile, so it needs to be complete first.";
      actions = (
        <Link to="/onboarding" className="btn btn-solid">
          Finish joining
        </Link>
      );
      break;
    case "not_allowed":
      title = "Your account cannot send requests right now.";
      lead = "Nothing was sent. Your home page says if anything on your account needs attention.";
      actions = (
        <Link to="/me" className="btn btn-solid">
          Back to home
        </Link>
      );
      break;
  }

  return (
    <div className="pn-wizard">
      <BackToProfile mentorId={profile.id} firstName={firstName} />
      <h1 ref={heading} tabIndex={-1} className="mt-6">
        {title}
      </h1>
      <p className="pn-wizard-lead">{lead}</p>
      <div className="mt-8 flex flex-wrap gap-4">{actions}</div>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="pn-wizard">
      <Link to="/me/discover" className="link link-quiet t-small">
        <ArrowLeft size={14} aria-hidden="true" />
        Back to Find mentors
      </Link>
      <h1 className="mt-6">This profile is not available.</h1>
      <p className="pn-wizard-lead">The link may be mistyped, or the profile is not listed right now.</p>
    </div>
  );
}

/* ----------------------------------------------------------------- steps */

interface Draft {
  topic: string;
  why: string;
  goals: string;
  format: RequestFormat;
  mode: MeetingMode;
  schedulingNote: string;
}

function initialDraft(profile: ProfileView, kind: RequestKind): Draft {
  const m = profile.mentorship;
  const format: RequestFormat = kind === "mentorship" && m?.format === "recurring" ? "recurring" : "one-time";
  const mode: MeetingMode = kind === "mentorship" && m?.mode === "in-person" ? "in-person" : "online";
  return { topic: "", why: "", goals: "", format, mode, schedulingNote: "" };
}

function formatsFor(profile: ProfileView, kind: RequestKind): RequestFormat[] {
  if (kind === "introduction") return ["one-time"];
  const offered = profile.mentorship?.format ?? "either";
  return offered === "either" ? ["one-time", "recurring"] : [offered];
}

function modesFor(profile: ProfileView, kind: RequestKind): MeetingMode[] {
  if (kind === "introduction") return ["online", "in-person", "either"];
  const offered = profile.mentorship?.mode ?? "either";
  return offered === "either" ? ["online", "in-person", "either"] : [offered];
}

function Counter({ id, n, range, error }: { id: string; n: number; range: { min: number; max: number }; error?: string }) {
  return (
    <span id={id} className="block">
      <span className="pn-counter block">
        {n} of {range.max} characters{range.min > 0 ? `, ${range.min} minimum` : ""}
      </span>
      {error ? (
        <span className="field-error block" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The steps, or the gate that stands in for them. `opening` is decided once,
 * when the form opens: after a send, the re-read request list shows the new
 * request, and that must not swap the form for "you already have a request"
 * while it is on its way to the request page.
 */
function Wizard({ profile, kind, opening }: { profile: ProfileView; kind: RequestKind; opening: GateReason | null }) {
  const topicLabels = useTopicLabels();
  const navigate = useNavigate();
  const steps = STEPS[kind];
  const firstName = firstNameOf(profile);
  const name = displayName(profile);
  const m = profile.mentorship;
  const availability = useAvailability(profile.id);
  const mine = useMyMentorship();
  const create = useCreateRequest();

  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(profile, kind));
  const [stepError, setStepError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<ReactNode>(null);
  const [refusal, setRefusal] = useState<GateReason | null>(opening);
  const heading = useFocusOnChange(index);
  const whyId = useId();
  const goalsId = useId();
  const noteId = useId();
  const topicHeadingId = useId();
  const reviewId = useId();

  const step = steps[index];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  if (refusal) {
    return (
      <Gate
        reason={refusal}
        profile={profile}
        kind={kind}
        resumeOn={availability.data?.resumeOn}
        announce={opening === null}
      />
    );
  }

  const whyCount = charCount(draft.why);
  const checkStep = (): string | null => {
    if (step === "topic" && !draft.topic) return "Choose a topic to continue.";
    if (step === "message") {
      if (whyCount < limits.why.min) return `Write at least ${limits.why.min} characters about why you are asking.`;
      if (whyCount > limits.why.max) return `Keep it to ${limits.why.max} characters.`;
      if (charCount(draft.goals) > limits.requestGoals.max) return `Keep the success line to ${limits.requestGoals.max} characters.`;
    }
    if (step === "format" && charCount(draft.schedulingNote) > limits.schedulingNote.max) {
      return `Keep the scheduling note to ${limits.schedulingNote.max} characters.`;
    }
    return null;
  };

  const next = () => {
    const problem = checkStep();
    setStepError(problem);
    if (!problem) setIndex((i) => i + 1);
  };
  const back = () => {
    setStepError(null);
    setSendError(null);
    setIndex((i) => Math.max(0, i - 1));
  };

  const send = () => {
    setSendError(null);
    const input: CreateRequestInput = {
      mentorId: profile.id,
      kind,
      topicId: kind === "mentorship" ? draft.topic : null,
      why: draft.why,
      goals: draft.goals,
      format: kind === "introduction" ? "one-time" : draft.format,
      mode: draft.mode,
      schedulingNote: draft.schedulingNote,
    };
    if (!createRequestSchema.safeParse(input).success) {
      setSendError("Something in the request needs a change. Go back through the steps and check each one.");
      return;
    }
    create.mutate(input, {
      onSuccess: (detail) => navigate(`/me/requests/${detail.id}`, { state: { sent: firstName } }),
      onError: (error) => {
        if (isApiError(error, "topic_not_offered")) {
          setSendError(
            <>
              {firstName} no longer offers that topic.{" "}
              <button
                type="button"
                className="link"
                onClick={() => {
                  set("topic", "");
                  setSendError(null);
                  setIndex(0);
                }}
              >
                Choose another topic
              </button>
            </>,
          );
          return;
        }
        const code = error instanceof ApiError ? error.code : null;
        if (code && gateFor(code, availability.data)) {
          // The refusal changed what the gate should say (counts, a pause and its
          // date), so decide it from the fresh answer, not the cached one.
          void Promise.all([mine.refetch(), availability.refetch()]).then(
            ([, fresh]) => setRefusal(gateFor(code, fresh.data ?? availability.data)),
            () => setRefusal(gateFor(code, availability.data)),
          );
          return;
        }
        setSendError(
          isApiError(error, "network")
            ? "The request did not send. Check your connection and try again; nothing is lost."
            : "The request did not send. Try again in a moment; nothing is lost.",
        );
      },
    });
  };

  const pendingOthers = mine.data?.pendingOutgoing ?? 0;
  const formats = formatsFor(profile, kind);
  const modes = modesFor(profile, kind);
  const meetLead =
    kind === "introduction"
      ? `An introduction is one conversation. Say where suits you; ${firstName} answers with how they prefer to meet.`
      : m
        ? `${firstName} offers ${m.format === "either" ? "one-time or recurring" : m.format === "one-time" ? "one-time" : "recurring"} conversations, ${MODE_PHRASE[m.mode]}, usually ${m.durationMin} minutes.${m.availability ? ` ${m.availability.replace(/\.?$/, ".")}` : ""}`
        : "Choose what suits you.";

  return (
    <div className="pn-onboard">
      <div className="pn-wizard min-w-0">
        <BackToProfile mentorId={profile.id} firstName={firstName} />
        <div className="mt-6">
          <Steps steps={steps.map((s) => STEP_LABEL[s])} current={index} />
        </div>

        {step === "topic" && (
          <>
            <h1 ref={heading} tabIndex={-1} id={topicHeadingId}>
              What do you want to ask {firstName} about?
            </h1>
            <p className="pn-wizard-lead">These are the topics {firstName} offered. Pick the closest one.</p>
            <div className="pn-wizard-body pn-options" role="radiogroup" aria-labelledby={topicHeadingId}>
              {(m?.topics ?? []).map((t) => (
                <Option
                  key={t}
                  name="topic"
                  checked={draft.topic === t}
                  title={topicLabels([t])[0] ?? t}
                  onClick={() => {
                    set("topic", t);
                    setStepError(null);
                  }}
                />
              ))}
            </div>
          </>
        )}

        {step === "message" && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              Say why.
            </h1>
            <p className="pn-wizard-lead">
              A few honest sentences. Mentors accept specific, prepared requests far more often than general ones.
            </p>
            <div className="pn-wizard-body pn-form">
              <Field
                label={`What made you choose ${firstName}?`}
                hint={<Counter id={whyId} n={whyCount} range={limits.why} error={stepError ?? undefined} />}
              >
                {(id) => (
                  <Textarea
                    id={id}
                    value={draft.why}
                    maxLength={limits.why.max + 50}
                    aria-describedby={whyId}
                    aria-invalid={stepError ? true : undefined}
                    onChange={(e) => set("why", e.target.value)}
                    placeholder={
                      kind === "introduction"
                        ? "I am a junior in civil engineering and would like to hear how you moved into your current field."
                        : "I am a junior in civil engineering applying for coastal internships, and your work is close to where I want to end up."
                    }
                  />
                )}
              </Field>
              <Field
                label="What would make this a success for you?"
                optional
                hint={<Counter id={goalsId} n={charCount(draft.goals)} range={limits.requestGoals} />}
              >
                {(id) => (
                  <Textarea
                    id={id}
                    value={draft.goals}
                    maxLength={limits.requestGoals.max + 50}
                    aria-describedby={goalsId}
                    onChange={(e) => set("goals", e.target.value)}
                    placeholder="A clearer idea of which firms to apply to, and feedback on my resume."
                    style={{ minHeight: "5rem" }}
                  />
                )}
              </Field>
            </div>
          </>
        )}

        {step === "format" && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              How would you like to meet?
            </h1>
            <p className="pn-wizard-lead">{meetLead}</p>
            <div className="pn-wizard-body pn-form">
              {kind === "mentorship" && (
                <fieldset className="pn-fieldset">
                  <legend className="t-small">Format</legend>
                  <div className="pn-options pn-options-2" role="radiogroup" aria-label="Format">
                    {formats.map((f) => (
                      <Option
                        key={f}
                        name="format"
                        checked={draft.format === f}
                        title={FORMAT_TEXT[f]}
                        note={f === "one-time" ? "A single focused session." : "A few sessions over time."}
                        onClick={() => set("format", f)}
                      />
                    ))}
                  </div>
                </fieldset>
              )}
              <fieldset className="pn-fieldset">
                <legend className="t-small">Where</legend>
                <div className="pn-options pn-options-2" role="radiogroup" aria-label="Where">
                  {modes.map((mode) => (
                    <Option key={mode} name="mode" checked={draft.mode === mode} title={MODE_TEXT[mode]} onClick={() => set("mode", mode)} />
                  ))}
                </div>
              </fieldset>
              <Field
                label="Scheduling preferences"
                optional
                hint={
                  <span id={noteId}>
                    Days and times that work for you. The actual booking happens after {firstName} accepts.{" "}
                    <span className="pn-counter">
                      {charCount(draft.schedulingNote)} of {limits.schedulingNote.max} characters
                    </span>
                    {stepError ? (
                      <span className="field-error block" role="alert">
                        {stepError}
                      </span>
                    ) : null}
                  </span>
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    value={draft.schedulingNote}
                    maxLength={limits.schedulingNote.max + 20}
                    aria-describedby={noteId}
                    onChange={(e) => set("schedulingNote", e.target.value)}
                    placeholder="Tuesdays and Thursdays after 5 work best."
                  />
                )}
              </Field>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              Review and send.
            </h1>
            <p className="pn-wizard-lead">
              {firstName} will see this along with your profile: your name, program or role, institution and goals.
              Nothing else about you is shared.
            </p>
            <div className="pn-wizard-body grid gap-5">
              <section aria-labelledby={reviewId}>
                <h2 id={reviewId} className="sr-only">
                  Your request to {firstName}
                </h2>
                <Card flush>
                  <dl className="pn-dl p-5 t-small">
                    <dt>To</dt>
                    <dd>{name}</dd>
                    <dt>{kind === "introduction" ? "Kind" : "Topic"}</dt>
                    <dd>{kind === "introduction" ? "Introduction" : (topicLabels([draft.topic])[0] ?? draft.topic)}</dd>
                    <dt>Why</dt>
                    <dd className="whitespace-pre-line">{draft.why.trim()}</dd>
                    {draft.goals.trim() && (
                      <>
                        <dt>Success</dt>
                        <dd className="whitespace-pre-line">{draft.goals.trim()}</dd>
                      </>
                    )}
                    <dt>Format</dt>
                    <dd>
                      {kind === "introduction" ? "One conversation" : FORMAT_TEXT[draft.format]} · {MODE_PHRASE[draft.mode]}
                    </dd>
                    {draft.schedulingNote.trim() && (
                      <>
                        <dt>Times</dt>
                        <dd>{draft.schedulingNote.trim()}</dd>
                      </>
                    )}
                  </dl>
                </Card>
              </section>
              <Notice icon={<Lock size={16} aria-hidden="true" />}>
                Your email and phone are not included. If {firstName} accepts, you will see how they prefer to be
                reached.
              </Notice>
              <p className="t-small text-fg-2">
                If there is no answer in time, the request expires and you can send another. You can withdraw it at
                any time.
                {pendingOthers > 0
                  ? ` You have ${pendingOthers} other ${pendingOthers === 1 ? "request" : "requests"} waiting.`
                  : ""}
              </p>
              {sendError ? (
                <div role="alert">
                  <Notice tone="warn">{sendError}</Notice>
                </div>
              ) : null}
            </div>
          </>
        )}

        {step === "topic" && stepError ? (
          <p className="field-error t-small" role="alert">
            {stepError}
          </p>
        ) : null}

        <div className="pn-wizard-foot">
          <button type="button" className="btn btn-ghost" disabled={index === 0 || create.isPending} onClick={back}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back
          </button>
          {step !== "review" ? (
            <button type="button" className="btn btn-solid" onClick={next}>
              Continue
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="btn btn-solid" disabled={create.isPending} onClick={send}>
              {create.isPending ? "Sending" : "Send request"}
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <aside className="pn-wizard-aside min-w-0" aria-label={`About ${firstName}`}>
        <Card lift>
          <div className="flex items-center gap-3">
            <Monogram initials={initialsOf(profile)} photo={profile.photoUrl} />
            <div className="min-w-0">
              <div className="pn-row-title truncate">{name}</div>
              <div className="pn-row-meta truncate">{[profile.title, profile.organization].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
          {m && kind === "mentorship" ? (
            <dl className="pn-dl mt-5 t-small">
              {m.availability && (
                <>
                  <dt>Usually</dt>
                  <dd>{m.availability}</dd>
                </>
              )}
              <dt>Length</dt>
              <dd>{m.durationMin} minutes</dd>
            </dl>
          ) : (
            <p className="t-small text-fg-2 mt-5">An introduction asks for one conversation.</p>
          )}
        </Card>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export function RequestForm() {
  const [params] = useSearchParams();
  const mentorId = params.get("mentor") ?? "";
  const kind: RequestKind = params.get("kind") === "introduction" ? "introduction" : "mentorship";
  useMeta({ title: kind === "introduction" ? "Request an introduction" : "Request mentorship" });

  const valid = UUID_PATTERN.test(mentorId);
  const profile = useProfile(valid ? mentorId : "");
  const availability = useAvailability(valid ? mentorId : "");
  const open = useOpenMenteeRequests();
  const mine = useMyMentorship();

  if (!valid) return <Unavailable />;
  // A failed load is not a fact about the mentor: say it did not load.
  const failed = [profile, availability, mine].find(
    (q) => q.isError && (isApiError(q.error, "network") || (isApiError(q.error) && q.error.status >= 500)),
  );
  if (failed) {
    return (
      <div className="pn-wizard">
        <h1>{failed === profile ? "The profile did not load." : "The request form did not load."}</h1>
        <p className="pn-wizard-lead">Check your connection and try again.</p>
        <button type="button" className="btn btn-outline btn-sm mt-6" onClick={() => void failed.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (profile.isError) {
    if (isApiError(profile.error, "network") || (isApiError(profile.error) && profile.error.status >= 500)) {
      return (
        <div className="pn-wizard">
          <h1>The profile did not load.</h1>
          <p className="pn-wizard-lead">Check your connection and try again.</p>
          <button type="button" className="btn btn-outline btn-sm mt-6" onClick={() => void profile.refetch()}>
            Try again
          </button>
        </div>
      );
    }
    return <Unavailable />;
  }
  if (profile.isPending || availability.isPending || open.isPending || mine.isPending) {
    return (
      <div className="pn-wizard" role="status" aria-live="polite">
        <span className="sr-only">Loading the request form</span>
      </div>
    );
  }

  const p = profile.data;
  if (p.isOwner) return <Unavailable />;
  return (
    <Wizard
      key={`${p.id}-${kind}`}
      profile={p}
      kind={kind}
      opening={openingGate(p, kind, availability.data, open.data?.items ?? [], mine.data)}
    />
  );
}

/** What the form can already tell before any step: an open request with this person, or no offer of this kind. */
function openingGate(
  p: ProfileView,
  kind: RequestKind,
  availability: MentorAvailability | undefined,
  openRequests: RequestSummary[],
  mine: MyMentorship | undefined,
): GateReason | null {
  if (openRequests.some((r) => r.role === "mentee" && r.counterparty.id === p.id)) return "duplicate";
  // What the mentor offers comes first: withdrawing a request would not change it.
  const state = availability?.state;
  if (kind === "mentorship" && state !== "taking") {
    return state === "paused" ? "paused" : state === "full" ? "full" : "unavailable";
  }
  if (kind === "introduction" && !p.participation.includes("networking")) return "no_introductions";
  // 03 section 6.3: at the cap the form does not open, so nothing typed is lost.
  if (mine && mine.pendingOutgoing >= mine.pendingCap) return "pending_cap";
  return null;
}
