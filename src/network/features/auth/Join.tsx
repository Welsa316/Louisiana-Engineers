/**
 * Join: pick the path that fits (student or professional), confirm MEST's
 * mission statement, then get a sign-in link or use Google. The account is
 * created when the link is used; the choice is kept on this device for
 * onboarding, which asks for the mission confirmation again and records it.
 * `?as=student` or `?as=professional` preselects a path.
 */

import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ProfileKind } from "@shared/types/common";
import { mission } from "../../../content/site";
import { SessionPending } from "../../app/guards";
import { useMeta } from "../../lib/meta";
import { useSession } from "../../lib/session";
import { Option, PageHead } from "../../ui/ui";
import { isProfileKind, readJoinIntent, saveJoinIntent } from "./join-intent";
import { MagicLinkForm } from "./MagicLinkForm";
import { GoogleSignIn, SignedInPanel } from "./shared";

const PATHS: { kind: ProfileKind; title: string; note: string }[] = [
  {
    kind: "student",
    title: "I am a student or early in my career",
    note: "Create a short profile, say what you are working toward, and start finding mentors. About three minutes.",
  },
  {
    kind: "professional",
    title: "I am a working professional",
    note: "List your discipline and expertise, choose how visible and reachable you are, and offer mentorship if you like. About eight minutes, then a MEST administrator reviews it before it is listed.",
  },
];

const NEXT_STEPS: [string, string][] = [
  ["We email you a link", "It signs you in once and expires after 15 minutes. There is no password."],
  ["You build your profile", "Students take about three minutes; professionals about eight. You can stop and come back."],
  ["Professionals are reviewed", "A MEST administrator approves each professional profile before it appears in the directory. Student profiles are never listed."],
];

export function Join() {
  useMeta({ title: "Join the network" });
  const { user, status } = useSession();
  const [params] = useSearchParams();
  const preset = params.get("as");
  const [kind, setKind] = useState<ProfileKind | null>(() =>
    isProfileKind(preset) ? preset : (readJoinIntent()?.kind ?? null),
  );
  const [accepted, setAccepted] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const kindRef = useRef<HTMLFieldSetElement>(null);
  const missionRef = useRef<HTMLFieldSetElement>(null);

  const kindError = showErrors && !kind ? "Choose which describes you." : null;
  const missionError = showErrors && !accepted ? "Confirm the mission statement to join." : null;

  /** Checks the two choices, moves focus to the first one missing, and keeps them for onboarding. */
  function ready(): boolean {
    setShowErrors(true);
    if (!kind) {
      kindRef.current?.querySelector("input")?.focus();
      return false;
    }
    if (!accepted) {
      missionRef.current?.querySelector("input")?.focus();
      return false;
    }
    saveJoinIntent({ kind, missionAccepted: true });
    return true;
  }

  return (
    <div className="shell section">
      <PageHead
        kicker="Join the network"
        title="Which describes you today?"
        lead="You can change this later. Professionals can also ask for guidance, and students become professionals."
      />

      {status === "loading" ? (
        <SessionPending />
      ) : user ? (
        <div className="mt-8 max-w-xl">
          <SignedInPanel user={user} />
        </div>
      ) : (
        <div className="pn-split mt-10">
          <MagicLinkForm beforeSend={ready}>
            <fieldset ref={kindRef} aria-describedby={kindError ? "join-kind-error" : "join-kind-hint"}>
              <legend className="t-label">1. Your path</legend>
              <div className="pn-options mt-4">
                {PATHS.map((path) => (
                  <Option
                    key={path.kind}
                    name="join-kind"
                    checked={kind === path.kind}
                    title={path.title}
                    note={path.note}
                    onClick={() => setKind(path.kind)}
                  />
                ))}
              </div>
              <p id="join-kind-hint" className="pn-field-hint">
                Students include high school seniors, undergraduates and graduate students. Early-career professionals
                who mainly want guidance can choose Student too.
              </p>
              {kindError ? (
                <p id="join-kind-error" role="alert" className="field-error t-small">
                  {kindError}
                </p>
              ) : null}
            </fieldset>

            <fieldset ref={missionRef} aria-describedby={missionError ? "join-mission-error" : undefined}>
              <legend className="t-label">2. MEST&rsquo;s mission</legend>
              <blockquote className="t-body text-fg-2 mt-4 border-l-2 border-[var(--pn-line-strong)] pl-4">
                {mission.statement}
              </blockquote>
              <div className="mt-4">
                <Option
                  multi
                  checked={accepted}
                  title="I share this mission"
                  note="and I will follow the community guidelines."
                  onClick={() => setAccepted((value) => !value)}
                />
              </div>
              <p className="pn-field-hint">
                <Link to="/guidelines" className="link link-quiet">
                  Read the community guidelines
                </Link>
              </p>
              {missionError ? (
                <p id="join-mission-error" role="alert" className="field-error t-small">
                  {missionError}
                </p>
              ) : null}
            </fieldset>

            <div>
              <p className="t-label">3. Your email</p>
              <p className="pn-field-hint">
                Already a member?{" "}
                <Link to="/signin" className="link link-quiet">
                  Sign in
                </Link>
              </p>
              <GoogleSignIn beforeLeave={ready} />
            </div>
          </MagicLinkForm>

          <aside aria-labelledby="join-next-title" className="pn-card">
            <h2 id="join-next-title" className="t-heading">
              What happens next
            </h2>
            <ol className="pn-ledger mt-6">
              {NEXT_STEPS.map(([title, body], index) => (
                <li key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-4">
                  <span className="t-numeral text-accent text-sm pt-0.5" aria-hidden="true">
                    0{index + 1}
                  </span>
                  <div>
                    <h3 className="t-body font-medium">{title}</h3>
                    <p className="t-small text-fg-2 mt-1">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </div>
  );
}
