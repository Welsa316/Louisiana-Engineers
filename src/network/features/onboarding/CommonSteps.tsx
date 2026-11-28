/**
 * Steps both paths share: who the member is (with the mission statement)
 * and the basics. Also the "Who sees what" legend beside every step.
 */

import type { ReactNode, RefObject } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Link } from "react-router";
import { ChevronDown, Lock } from "lucide-react";
import { limits } from "@shared/limits";
import { mission } from "../../../content/site";
import { regionLabel, useRegions, withChosenRegion } from "../../lib/vocabulary";
import { CharCount, OnbField, OnbFieldset } from "../../ui/onboarding-fields";
import { Card, Input, Notice, Option, PrivacyMark } from "../../ui/ui";
import { fieldId, type OnboardingValues } from "./form";

export interface StepProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** The message to show under a field, once the step has been checked. */
  err: (name: string) => string | undefined;
}

/** The step's one heading. It takes focus when the step opens. */
export function StepHeading({
  headingRef,
  children,
  lead,
}: {
  headingRef: StepProps["headingRef"];
  children: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <>
      <h1 id="onb-step-title" ref={headingRef} tabIndex={-1} aria-describedby="onb-step-count">
        {children}
      </h1>
      {lead ? <p className="pn-wizard-lead">{lead}</p> : null}
    </>
  );
}

export const REQUIRED_NOTE = "Every field is required unless it says optional.";

/* ------------------------------------------------------------- step 1 */

export function WhoStep({
  headingRef,
  err,
  lockKind,
  declineNotes,
}: StepProps & { lockKind: boolean; declineNotes: string | null }) {
  const { setValue, control } = useFormContext<OnboardingValues>();
  const kind = useWatch({ control, name: "kind" });
  const accepted = useWatch({ control, name: "acceptMission" });
  const setKind = (value: OnboardingValues["kind"]) => setValue("kind", value, { shouldDirty: true });
  const setAccepted = (value: boolean) => setValue("acceptMission", value, { shouldDirty: true });

  return (
    <>
      <StepHeading
        headingRef={headingRef}
        lead="Students take about three minutes and professionals about eight. Your answers are saved on this device as you go, so you can stop and come back."
      >
        {lockKind ? "Submit your profile again." : "Tell us who you are."}
      </StepHeading>

      <div className="pn-wizard-body pn-form">
        {lockKind ? (
          <Notice tone="warn">
            <p>A MEST administrator asked for changes before listing your profile. Your last answers are filled in; change what they asked about and submit again.</p>
            {declineNotes ? (
              <p className="mt-3">
                <strong>Their note:</strong> {declineNotes}
              </p>
            ) : null}
          </Notice>
        ) : (
          <OnbFieldset
            id={fieldId("kind")}
            legend="I am a"
            error={err("kind")}
            hint="Students include high school seniors, undergraduates and graduate students. Early-career professionals who mainly want guidance can choose Student too; you can change this later."
          >
            <div className="pn-options">
              <Option
                name="onb-kind"
                checked={kind === "student"}
                title="Student"
                note="Find mentors and say what you are working toward. Student profiles are never listed in the directory."
                onClick={() => setKind("student")}
              />
              <Option
                name="onb-kind"
                checked={kind === "professional"}
                title="Professional"
                note="List your discipline and expertise, choose how visible and reachable you are, and offer mentorship if you like. A MEST administrator reviews it before it is listed."
                onClick={() => setKind("professional")}
              />
            </div>
          </OnbFieldset>
        )}

        <OnbFieldset id={fieldId("acceptMission")} legend="MEST’s mission" error={err("acceptMission")} privacy="private">
          <blockquote className="t-body text-fg-2 border-l-2 border-[var(--pn-line-strong)] pl-4">
            {mission.statement}
          </blockquote>
          <div className="mt-4 pn-options">
            <Option
              multi
              checked={accepted}
              title="I share this mission"
              note="and I will follow the community guidelines."
              onClick={() => setAccepted(!accepted)}
            />
          </div>
          <p className="pn-field-hint">
            <Link to="/guidelines" className="link link-quiet">
              Read the community guidelines
            </Link>{" "}
            (your answers here are kept while you read).
          </p>
        </OnbFieldset>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- step 2 */

export function BasicsStep({ headingRef, err }: StepProps) {
  const { register, control } = useFormContext<OnboardingValues>();
  const kind = useWatch({ control, name: "kind" });
  const bio = useWatch({ control, name: "bio" });
  const region = useWatch({ control, name: "region" });
  const activeRegions = useRegions();
  // A choice only once the network serves more than one region.
  const regions = activeRegions.length > 1 ? withChosenRegion(activeRegions, region) : null;
  const student = kind === "student";
  // Students are never listed: what they write reaches only mentors they send a request to.
  const seen = student ? "members" : "public";

  return (
    <>
      <StepHeading
        headingRef={headingRef}
        lead={
          student
            ? `Mentors you send a request to see your name and what you write here. Nobody outside MEST does. ${REQUIRED_NOTE}`
            : `Your name, a short biography and where you are. The mark beside each field says who will see it. ${REQUIRED_NOTE}`
        }
      >
        Start with the basics.
      </StepHeading>

      <div className="pn-wizard-body pn-form pn-form-2">
        <OnbField id={fieldId("firstName")} label="First name" privacy={seen} error={err("firstName")}>
          {(a11y) => <Input {...a11y} {...register("firstName")} autoComplete="given-name" />}
        </OnbField>
        <OnbField id={fieldId("lastName")} label="Last name" privacy={seen} error={err("lastName")}>
          {(a11y) => <Input {...a11y} {...register("lastName")} autoComplete="family-name" />}
        </OnbField>
        <OnbField
          id={fieldId("credentials")}
          label="Credentials"
          optional
          privacy={seen}
          error={err("credentials")}
          hint="PE, PhD, MD. Shown after your name."
        >
          {(a11y) => <Input {...a11y} {...register("credentials")} placeholder="PE" />}
        </OnbField>
        <OnbField
          id={fieldId("location")}
          label="General location"
          privacy={seen}
          error={err("location")}
          hint="City and state, for example New Orleans, LA. Never an address."
        >
          {(a11y) => <Input {...a11y} {...register("location")} autoComplete="address-level2" />}
        </OnbField>

        {regions ? (
          <OnbField
            id={fieldId("region")}
            label="Region"
            privacy={seen}
            className="pn-form-span"
            error={err("region")}
            hint="The MEST region you live or work in. The directory can be filtered by it."
          >
            {(a11y) => (
              <div className="select-wrap">
                <select {...a11y} {...register("region")}>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </div>
            )}
          </OnbField>
        ) : (
          <div className="field pn-form-span">
            <p className="field-label pn-field-label t-small">
              <span>Region</span>
              <PrivacyMark level={seen} />
            </p>
            <p className="t-body">{regionLabel(activeRegions, region)}</p>
            <p className="pn-field-hint">The network serves {regionLabel(activeRegions, region)} for now.</p>
          </div>
        )}

        <OnbField
          id={fieldId("bio")}
          label="Short biography"
          optional={student}
          privacy={seen}
          className="pn-form-span"
          error={err("bio")}
          hint={
            <>
              <CharCount value={bio} min={student && !bio.trim() ? 0 : limits.bio.min} max={limits.bio.max} />
              {student
                ? "If you write one, at least 120 characters. Mentors read it with your requests."
                : "Write it the way you would introduce yourself at a MEST event."}
            </>
          }
        >
          {(a11y) => (
            <textarea
              className="field-input pn-textarea"
              {...a11y}
              {...register("bio")}
              placeholder={
                student
                  ? "I am a junior in civil engineering, interested in water resources…"
                  : "I design levee and marsh restoration projects along the Louisiana coast…"
              }
            />
          )}
        </OnbField>

        {student ? null : (
          <OnbField
            id={fieldId("linkedinUrl")}
            label="LinkedIn link"
            optional
            privacy="members"
            error={err("linkedinUrl")}
            hint="Never public. Shown only if you choose LinkedIn as a contact method."
          >
            {(a11y) => (
              <Input {...a11y} {...register("linkedinUrl")} inputMode="url" placeholder="https://www.linkedin.com/in/…" />
            )}
          </OnbField>
        )}
        <OnbField
          id={fieldId("websiteUrl")}
          label="Website or portfolio"
          optional
          privacy={seen}
          error={err("websiteUrl")}
          hint={student ? "Mentors you send a request to can open it." : undefined}
        >
          {(a11y) => <Input {...a11y} {...register("websiteUrl")} inputMode="url" placeholder="https://" />}
        </OnbField>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- aside */

export function PrivacyLegend({ student }: { student: boolean }) {
  return (
    <Card title="Who sees what" lift>
      <ul className="grid gap-4 t-small text-fg-2">
        {student ? null : (
          <li className="grid gap-1">
            <PrivacyMark level="public" />
            Anyone, including visitors who are not signed in, once an administrator approves your profile.
          </li>
        )}
        <li className="grid gap-1">
          <PrivacyMark level="members" />
          {student
            ? "Mentors you send a request to. Student profiles are never listed."
            : "Signed-in MEST members, and only what you choose to show them."}
        </li>
        <li className="grid gap-1">
          <PrivacyMark level="private" />
          You and MEST administrators. Never on a profile.
        </li>
      </ul>
      <div className="mt-5">
        <Notice icon={<Lock size={16} aria-hidden="true" />}>
          {student
            ? "Your sign-in email is never shown to anyone, mentors included."
            : "Your sign-in email is never public. Members see it only if you choose Email as a contact method without giving a different address."}
        </Notice>
      </div>
    </Card>
  );
}
