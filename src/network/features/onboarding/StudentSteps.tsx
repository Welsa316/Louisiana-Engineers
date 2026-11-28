/**
 * Step 3b, students (03 section 5): program, level, institution, goals,
 * interests and the topics they want help with. Everything here except the
 * topics reaches only mentors the student sends a request to; the topics are
 * private and used to suggest mentors.
 */

import { useFormContext, useWatch } from "react-hook-form";
import { limits } from "@shared/limits";
import { audiences } from "@shared/taxonomy";
import { useTopics, withChosen } from "../../lib/vocabulary";
import { ChipChoices, CharCount, OnbField, OnbFieldset, TagInput } from "../../ui/onboarding-fields";
import { Input, Option } from "../../ui/ui";
import { REQUIRED_NOTE, StepHeading, type StepProps } from "./CommonSteps";
import { fieldId, type OnboardingValues } from "./form";

export function StudiesStep({ headingRef, err }: StepProps) {
  const { register, control, setValue } = useFormContext<OnboardingValues>();
  const level = useWatch({ control, name: "level" });
  const goals = useWatch({ control, name: "goals" });
  const topics = useWatch({ control, name: "topicsNeeded" });
  const interests = useWatch({ control, name: "interests" });
  const topicOptions = withChosen(useTopics(), topics);

  return (
    <>
      <StepHeading
        headingRef={headingRef}
        lead={`Specific beats general: "choosing between an MPH and medical school" finds a better mentor than "career advice". ${REQUIRED_NOTE}`}
      >
        What would help right now?
      </StepHeading>

      <div className="pn-wizard-body pn-form">
        <OnbFieldset id={fieldId("level")} legend="Where you are" privacy="members" error={err("level")}>
          <div className="pn-options pn-options-2">
            {audiences.map((a) => (
              <Option
                key={a.id}
                name="onb-level"
                checked={level === a.id}
                title={a.label}
                onClick={() => setValue("level", a.id, { shouldDirty: true })}
              />
            ))}
          </div>
        </OnbFieldset>

        <div className="pn-form pn-form-2">
          <OnbField
            id={fieldId("program")}
            label="Program"
            privacy="members"
            error={err("program")}
            hint="For example, BS Civil Engineering, junior."
          >
            {(a11y) => <Input {...a11y} {...register("program")} />}
          </OnbField>
          <OnbField
            id={fieldId("institution")}
            label="School or institution"
            privacy="members"
            error={err("institution")}
            hint="Your school, or your employer if you have finished studying."
          >
            {(a11y) => <Input {...a11y} {...register("institution")} autoComplete="organization" />}
          </OnbField>
        </div>

        <OnbField
          id={fieldId("goals")}
          label="What are you working toward?"
          privacy="members"
          error={err("goals")}
          hint={<CharCount value={goals} min={limits.goals.min} max={limits.goals.max} />}
        >
          {(a11y) => (
            <textarea
              className="field-input pn-textarea"
              {...a11y}
              {...register("goals")}
              placeholder="Land a coastal engineering internship for next summer and understand the path to a PE license."
            />
          )}
        </OnbField>

        <OnbFieldset
          id={fieldId("topicsNeeded")}
          legend="Topics you want help with"
          privacy="private"
          error={err("topicsNeeded")}
          hint={`Choose 1 to ${limits.topicsNeeded.max}. Used to suggest mentors; never shown on your profile.`}
        >
          <ChipChoices
            options={topicOptions}
            values={topics}
            max={limits.topicsNeeded.max}
            onChange={(next) => setValue("topicsNeeded", next, { shouldDirty: true })}
          />
        </OnbFieldset>

        <OnbField
          id={fieldId("interests")}
          label="Fields that interest you"
          optional
          privacy="members"
          error={err("interests")}
          hint={`Press Enter after each, up to ${limits.interests.max}.`}
        >
          {(a11y) => (
            <TagInput
              id={a11y.id}
              invalid={a11y["aria-invalid"]}
              describedBy={a11y["aria-describedby"]}
              values={interests}
              max={limits.interests.max}
              itemLabel="interest"
              placeholder="Coastal engineering"
              onChange={(next) => setValue("interests", next, { shouldDirty: true })}
            />
          )}
        </OnbField>
      </div>
    </>
  );
}
