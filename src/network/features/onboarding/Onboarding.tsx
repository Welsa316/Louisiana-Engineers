/**
 * Onboarding (03 section 5): one wizard for both paths. Step 1 asks who the
 * member is and for the mission statement; step 2 is the basics; students
 * then describe their studies, professionals their work, how they take part,
 * their mentorship offer (when mentoring), visibility and contact; the last
 * step previews the profile and submits it to `POST /api/me/onboarding`.
 *
 * Values live in one react-hook-form form; each Continue checks the step
 * with the shared onboarding schema and lists what to fix at the top, with
 * links to the fields. The draft (values and step) is saved in this browser
 * as the member goes, under `mest-onboarding-<userId>`, and removed on
 * submit and on sign-out.
 *
 * Students land on Home. Professionals land on `/me?submitted=1`, where Home
 * shows the "waiting for review" notice. A professional whose submission
 * was declined comes back here to submit again, starting from what they
 * sent; anyone else who has finished is sent to Home.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { Navigate, useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import type { SessionUser } from "@shared/types/auth";
import type { OwnProfile } from "@shared/types/me";
import { SessionPending } from "../../app/guards";
import { api, isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import {
  readOnboardingDraft,
  removeOnboardingDraft,
  writeOnboardingDraft,
} from "../../lib/onboarding-draft";
import { usePublicConfig, useSession } from "../../lib/session";
import { ErrorSummary } from "../../ui/onboarding-fields";
import { Notice, Steps } from "../../ui/ui";
import { clearJoinIntent, readJoinIntent } from "../auth/join-intent";
import { BasicsStep, PrivacyLegend, WhoStep } from "./CommonSteps";
import {
  defaultValues,
  fieldId,
  firstStepWith,
  fromServerIssues,
  issuesForStep,
  labelFor,
  stepLabels,
  stepsFor,
  validate,
  valuesFromProfile,
  type FieldIssue,
  type OnboardingValues,
  type StepId,
} from "./form";
import {
  ContactStep,
  MentorshipStep,
  ParticipationStep,
  VisibilityStep,
  WorkStep,
} from "./ProfessionalSteps";
import { ReviewStep } from "./Review";
import { StudiesStep } from "./StudentSteps";

/** Own-profile answers, shared with the other `/api/me/*` screens. */
export const ownProfileKey = ["me", "profile"] as const;

interface Draft {
  version: 1;
  step: StepId;
  values: OnboardingValues;
}

/** A saved draft laid over today's defaults, so a draft from an older build still has every field. */
function restore(draft: Draft | null): Draft | null {
  if (!draft || draft.version !== 1 || typeof draft.values !== "object" || draft.values === null) return null;
  const base = defaultValues();
  const values = draft.values;
  return {
    version: 1,
    step: draft.step,
    values: {
      ...base,
      ...values,
      mentorship: { ...base.mentorship, ...(values.mentorship ?? {}) },
      contact: { ...base.contact, ...(values.contact ?? {}) },
    },
  };
}

export function Onboarding() {
  useMeta({ title: "Set up your profile" });
  const { user, status, refresh } = useSession();
  const navigate = useNavigate();
  // Set once the profile is submitted, so the guard below does not bounce
  // to Home while the session is re-read and the landing page is chosen.
  const finishing = useRef(false);

  const onSubmitted = useCallback(
    async (target: string) => {
      finishing.current = true;
      await refresh();
      navigate(target, { replace: true });
    },
    [navigate, refresh],
  );

  if (status === "loading" || !user) return <SessionPending />;
  const resubmitting = user.kind === "professional" && user.approvalState === "declined";
  if (user.kind !== null && !resubmitting && !finishing.current) return <Navigate to="/me" replace />;
  return resubmitting ? (
    <Resubmit user={user} onSubmitted={onSubmitted} />
  ) : (
    <Wizard key={user.id} user={user} initial={startFor(user)} onSubmitted={onSubmitted} />
  );
}

/** A new member: their draft if they have one, otherwise the path they chose on Join. */
function startFor(user: SessionUser): Draft {
  const draft = restore(readOnboardingDraft<Draft>(user.id));
  if (draft) return draft;
  const intent = readJoinIntent();
  return { version: 1, step: "who", values: defaultValues(intent?.kind ?? "") };
}

/** A declined professional: their draft, otherwise what they submitted last time. */
function Resubmit({ user, onSubmitted }: { user: SessionUser; onSubmitted: (target: string) => Promise<void> }) {
  const draft = useMemo(() => restore(readOnboardingDraft<Draft>(user.id)), [user.id]);
  const profile = useQuery({
    queryKey: ownProfileKey,
    queryFn: () => api<OwnProfile>("/me/profile"),
  });
  if (profile.isPending) return <SessionPending />;
  const notes = profile.data?.review?.decision === "declined" ? profile.data.review.notes : null;
  const initial: Draft = draft
    ? { ...draft, values: { ...draft.values, kind: "professional" } }
    : {
        version: 1,
        step: "who",
        values: profile.data ? { ...valuesFromProfile(profile.data), kind: "professional" } : defaultValues("professional"),
      };
  return <Wizard user={user} initial={initial} onSubmitted={onSubmitted} lockKind declineNotes={notes} />;
}

/** Plain-language text for a refused submission that is not about one field. */
function submitErrorText(error: unknown): string {
  if (isApiError(error, "network")) {
    return "We could not reach MEST Network. Your answers are saved on this device, so try again when you are back online.";
  }
  if (isApiError(error, "unauthenticated")) {
    return "You were signed out. Sign in again with the same address; your answers are saved on this device.";
  }
  if (isApiError(error, "not_member")) {
    return "Your account cannot finish setting up right now. If you scheduled it for deletion, keep your account first, then come back.";
  }
  if (isApiError(error, "invalid_onboarding")) {
    return "Something in your answers did not pass our checks. Look over each step, then submit again.";
  }
  return "Something went wrong on our side and your profile was not saved. Your answers are kept on this device; try again in a few minutes.";
}

/** Domain refusals that point at one field: where to send the member and what to tell them. */
const FIELD_REFUSALS: Record<string, FieldIssue> = {
  mission_required: { name: "acceptMission", message: "Confirm the mission statement to continue" },
  bio_required: { name: "bio", message: "Professionals need a short biography of at least 120 characters" },
  tag_rejected: {
    name: "expertise",
    message: "An administrator has declined one of these areas. Remove it or use different words, then submit again",
  },
  invalid_expertise: { name: "expertise", message: "Use 2 to 12 areas of 2 to 40 characters each" },
  invalid_education: { name: "education", message: "Check the education entries: at most 6, with real years" },
  invalid_contact: { name: "contact.methods", message: "Each method you use needs its detail, and only methods you use can be shown to members" },
};

function Wizard({
  user,
  initial,
  onSubmitted,
  lockKind = false,
  declineNotes = null,
}: {
  user: SessionUser;
  initial: Draft;
  onSubmitted: (target: string) => Promise<void>;
  lockKind?: boolean;
  declineNotes?: string | null;
}) {
  const client = useQueryClient();
  const form = useForm<OnboardingValues>({ defaultValues: initial.values });
  const { control, getValues, setValue } = form;
  const values = useWatch({ control }) as OnboardingValues;

  // "Mentees at once" starts at the network's default (an administrator's
  // setting), unless the member or their draft already holds a number.
  const defaultMaxActive = usePublicConfig().data?.defaultMaxActive;
  useEffect(() => {
    if (defaultMaxActive === undefined || getValues("mentorship.maxActive").trim() !== "") return;
    setValue("mentorship.maxActive", String(defaultMaxActive));
  }, [defaultMaxActive, getValues, setValue]);

  const steps = stepsFor(values);
  const [stepId, setStepId] = useState<StepId>(() =>
    stepsFor(initial.values).includes(initial.step) ? initial.step : "who",
  );
  const index = Math.max(0, steps.indexOf(stepId));
  const current = steps[index];

  /** The step whose problems are on screen (after a Continue that did not pass). */
  const [checkedStep, setCheckedStep] = useState<StepId | null>(null);
  /** Problems the server reported, until the next attempt. */
  const [serverIssues, setServerIssues] = useState<FieldIssue[]>([]);
  /** The list at the top, as of the last attempt; it only shrinks as fields are fixed. */
  const [summary, setSummary] = useState<FieldIssue[]>([]);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const submitErrorRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Save the draft as the member goes.
  useEffect(() => {
    if (submitted.current) return;
    writeOnboardingDraft(user.id, { version: 1, step: current, values } satisfies Draft);
  }, [user.id, current, values]);

  // A new step starts at its heading, for keyboard and screen-reader users.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [current]);

  // A failed attempt moves focus to the list of problems.
  useEffect(() => {
    if (summaryVersion > 0) (summaryRef.current ?? submitErrorRef.current)?.focus();
  }, [summaryVersion]);

  const liveIssues = useMemo(
    () => (checkedStep === current ? issuesForStep(current, values) : []),
    [checkedStep, current, values],
  );
  const visibleIssues = useMemo(() => {
    const stillFailing = summary.filter((s) => liveIssues.some((l) => l.name === s.name && l.message === s.message));
    return [...stillFailing, ...serverIssues];
  }, [summary, liveIssues, serverIssues]);

  const err = useCallback(
    (name: string) =>
      liveIssues.find((i) => i.name === name)?.message ?? serverIssues.find((i) => i.name === name)?.message,
    [liveIssues, serverIssues],
  );

  function showProblems(step: StepId, issues: FieldIssue[]) {
    setStepId(step);
    setCheckedStep(step);
    setSummary(issues);
    setSummaryVersion((v) => v + 1);
  }

  function goTo(step: StepId) {
    setCheckedStep(null);
    setSummary([]);
    setServerIssues([]);
    setSubmitError(null);
    setStepId(step);
  }

  function next() {
    const issues = issuesForStep(current, getValues());
    if (issues.length > 0) {
      setServerIssues([]);
      showProblems(current, issues);
      return;
    }
    goTo(steps[index + 1] ?? current);
  }

  function back() {
    if (index > 0) goTo(steps[index - 1]);
  }

  async function submit() {
    const now = getValues();
    const { issues, payload } = validate(now);
    setSubmitError(null);
    setServerIssues([]);
    if (!payload) {
      const step = firstStepWith(issues, now) ?? current;
      showProblems(step, issuesForStep(step, now));
      return;
    }
    setBusy(true);
    try {
      await api<OwnProfile>("/me/onboarding", { method: "POST", body: payload });
      submitted.current = true;
      removeOnboardingDraft(user.id);
      clearJoinIntent();
      await client.invalidateQueries({ queryKey: ["me"] });
      await onSubmitted(now.kind === "student" ? "/me" : "/me?submitted=1");
    } catch (error) {
      setBusy(false);
      if (isApiError(error, "already_onboarded")) {
        submitted.current = true;
        removeOnboardingDraft(user.id);
        await onSubmitted("/me");
        return;
      }
      const refusal = isApiError(error) ? FIELD_REFUSALS[error.code] : undefined;
      const fieldIssues = isApiError(error, "validation") ? fromServerIssues(error.issues) : refusal ? [refusal] : [];
      const step = fieldIssues.length ? firstStepWith(fieldIssues, now) : null;
      if (step) {
        setServerIssues(fieldIssues);
        setStepId(step);
        setCheckedStep(step);
        setSummary([]);
        setSummaryVersion((v) => v + 1);
        return;
      }
      setSubmitError(submitErrorText(error));
      setSummaryVersion((v) => v + 1);
    }
  }

  const summaryItems = visibleIssues.map((i) => ({ id: fieldId(i.name), label: labelFor(i.name), message: i.message }));
  const isReview = current === "review";

  return (
    <div className="shell pt-10 md:pt-14 pb-24">
      <div className="pn-onboard">
        <FormProvider {...form}>
          <form
            className="pn-wizard onb-wizard"
            data-many={steps.length > 5 || undefined}
            noValidate
            aria-labelledby="onb-step-title"
            onSubmit={(event) => {
              event.preventDefault();
              if (isReview) void submit();
              else next();
            }}
          >
            <Steps steps={steps.map((s) => stepLabels[s])} current={index} />
            <p id="onb-step-count" className="sr-only">
              Step {index + 1} of {steps.length}
            </p>
            <ErrorSummary ref={summaryRef} issues={summaryItems} />

            {current === "who" && (
              <WhoStep headingRef={headingRef} err={err} lockKind={lockKind} declineNotes={declineNotes} />
            )}
            {current === "basics" && <BasicsStep headingRef={headingRef} err={err} />}
            {current === "studies" && <StudiesStep headingRef={headingRef} err={err} />}
            {current === "work" && <WorkStep headingRef={headingRef} err={err} />}
            {current === "participation" && <ParticipationStep headingRef={headingRef} err={err} />}
            {current === "mentorship" && <MentorshipStep headingRef={headingRef} err={err} />}
            {current === "visibility" && <VisibilityStep headingRef={headingRef} err={err} />}
            {current === "contact" && <ContactStep headingRef={headingRef} err={err} />}
            {current === "review" && <ReviewStep headingRef={headingRef} values={values} onEdit={goTo} steps={steps} />}

            {submitError ? (
              <div ref={submitErrorRef} tabIndex={-1} role="alert" className="mt-8">
                <Notice tone="warn">{submitError}</Notice>
              </div>
            ) : null}

            <div className="pn-wizard-foot">
              {index > 0 ? (
                <button type="button" className="btn btn-ghost" onClick={back}>
                  <ArrowLeft size={16} aria-hidden="true" />
                  Back
                </button>
              ) : (
                <span aria-hidden="true" />
              )}
              {isReview ? (
                <button type="submit" className="btn btn-solid" disabled={busy} aria-busy={busy || undefined}>
                  {busy ? "Saving" : values.kind === "professional" ? "Submit for review" : "Finish"}
                  <ArrowUpRight size={16} aria-hidden="true" />
                </button>
              ) : (
                <button type="submit" className="btn btn-solid">
                  Continue
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </form>
        </FormProvider>

        <aside className="pn-wizard-aside" aria-label="Who sees what">
          <PrivacyLegend student={values.kind === "student"} />
        </aside>
      </div>
    </div>
  );
}
