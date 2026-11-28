/**
 * The mentor dashboard (`/network/mentor`), ported from the prototype: how
 * many people are waiting, the waiting requests oldest
 * first with the days left, the active mentees, and the mentorship offer
 * at a glance. Counts come from `GET /api/me/mentorship`; the lists from
 * `GET /api/requests?role=mentor`. Pausing, the topics and the cap live in
 * Settings, Mentorship, so the dashboard links there rather than keeping a
 * second copy of those controls. The prototype's meetings and activity
 * feed are Phase 2 and are left out.
 */

import { Link } from "react-router";
import { ArrowRight, Settings } from "lucide-react";
import { useTopicLabels } from "../../lib/vocabulary";
import { useMeta } from "../../lib/meta";
import { useSession } from "../../lib/session";
import { Card, Empty, Notice, PageHead, Stat, Status, plural } from "../../ui/ui";
import { useMyMentorship, useRequestList } from "../me/requests-api";
import { useOwnProfile, useOwnSettings } from "../settings/api";
import { calendarDay } from "../me/RequestActions";
import { atCapacity, daysLeft } from "./RequestDrawer";
import { MENTOR_ACTIVE, MENTOR_PENDING, MentorRequestRow } from "./Requests";

/** How many waiting requests and mentees the dashboard lists before "All". */
const LISTED = 5;

/** The page title: who is waiting. */
function headline(waiting: number | undefined): string {
  if (waiting === undefined) return "Your mentoring.";
  if (waiting === 0) return "All caught up.";
  return waiting === 1 ? "1 person is waiting to hear from you." : `${waiting} people are waiting to hear from you.`;
}

function OfferStatus() {
  const mine = useMyMentorship();
  const m = mine.data;
  if (!m || !m.status) return null;
  if (m.status === "off") return <Status tone="off" label="Mentorship off" />;
  if (m.status === "paused") return <Status tone="paused" label="Not taking new requests right now" />;
  return atCapacity(m) ? (
    <Status tone="off" label="Not taking new requests right now" />
  ) : (
    <Status tone="active" label="Taking requests" />
  );
}

export function Dashboard() {
  const topicLabels = useTopicLabels();
  useMeta({ title: "Mentoring" });
  const { user } = useSession();
  const profile = useOwnProfile();
  const settings = useOwnSettings();
  const mine = useMyMentorship();
  const waiting = useRequestList("mentor", MENTOR_PENDING, 1, LISTED);
  const active = useRequestList("mentor", MENTOR_ACTIVE, 1, LISTED);
  const completed = useRequestList("mentor", ["completed"], 1, 1);

  const m = mine.data;
  const offer = settings.data?.mentorship ?? null;
  const firstName = profile.data?.firstName?.trim();

  if (user && user.kind !== "professional") {
    return (
      <>
        <PageHead kicker="Mentoring" title="Mentoring is for professionals." />
        <div className="mt-8 max-w-2xl">
          <Empty
            title="Students ask; professionals answer."
            action={
              <Link to="/me/requests" className="btn btn-outline btn-sm">
                My requests
              </Link>
            }
          >
            Your own requests to mentors are under My requests.
          </Empty>
        </div>
      </>
    );
  }

  const status = m?.status ?? offer?.status ?? null;
  const lead =
    status === "paused"
      ? `Mentorship is paused${offer?.pausedUntil ? ` until ${calendarDay(offer.pausedUntil)}` : ""}. Your profile is listed, but nobody can send you a request until you resume.`
      : status === "off" || status === null
        ? "Mentorship is off. Turn it on to receive requests. Mentees you already accepted keep their place."
        : "Requests close on their own if there is no answer in time, so nothing piles up.";
  const oldest = waiting.data?.items[0];

  return (
    <>
      <PageHead
        kicker={firstName ? `Welcome back, ${firstName}` : "Mentoring"}
        title={headline(m?.pendingIncoming)}
        lead={lead}
        actions={
          <Link to="/settings/mentorship" className={status === "active" ? "btn btn-outline btn-sm" : "btn btn-solid btn-sm"}>
            <Settings size={15} aria-hidden="true" />
            {status === "off" || status === null ? "Turn on mentorship" : status === "paused" ? "Resume or change" : "Mentorship settings"}
          </Link>
        }
      />

      <div className="pn-stats mt-8">
        <Stat
          label="Waiting"
          value={m?.pendingIncoming ?? "–"}
          note={oldest ? `oldest has ${plural(daysLeft(oldest.expiresAt), "day")} left` : "nothing pending"}
        />
        <Stat label="Active mentees" value={m?.activeCount ?? "–"} unit={m?.maxActive ? `of ${m.maxActive}` : undefined} />
        <Stat label="Completed" value={completed.data?.total ?? "–"} note="mentorships" />
        <Stat
          label="Helped"
          value={m && completed.data ? m.activeCount + completed.data.total : "–"}
          note="people so far"
        />
      </div>

      <div className="pn-split mt-8">
        <div className="grid gap-6 content-start">
          <Card
            title="Waiting for you"
            aside={
              <Link to="/mentor/requests" className="link link-quiet t-small">
                All requests
              </Link>
            }
            flush
          >
            {waiting.isError ? (
              <div className="p-5">
                <Notice tone="warn">Your requests did not load. Try again in a moment.</Notice>
              </div>
            ) : !waiting.data ? (
              <p className="t-small text-fg-2 p-5" role="status">
                Loading your requests
              </p>
            ) : waiting.data.items.length > 0 ? (
              <ul aria-label="Waiting requests">
                {waiting.data.items.map((r) => (
                  <MentorRequestRow key={r.id} r={r} to={`/mentor/requests/${r.id}`} />
                ))}
              </ul>
            ) : (
              <div className="p-5">
                <Empty inline title="No requests waiting.">
                  You get one email when someone writes, and a reminder if it waits a few days.
                </Empty>
              </div>
            )}
          </Card>

          <Card
            title="Active mentees"
            aside={
              <Link to="/mentor/mentees" className="link link-quiet t-small">
                All mentees
              </Link>
            }
            flush
          >
            {!active.data ? (
              <p className="t-small text-fg-2 p-5" role="status">
                Loading your mentees
              </p>
            ) : active.data.items.length > 0 ? (
              <ul aria-label="Active mentees">
                {active.data.items.map((r) => (
                  <MentorRequestRow key={r.id} r={r} to={`/mentor/mentees/${r.id}`} />
                ))}
              </ul>
            ) : (
              <p className="t-small text-fg-2 p-5">Nobody yet. Accept a request and the mentorship appears here.</p>
            )}
          </Card>
        </div>

        <div className="grid gap-6 content-start">
          <Card title="Your mentorship offer" aside={<OfferStatus />}>
            {offer ? (
              <dl className="pn-dl t-small">
                <dt>Topics</dt>
                <dd>{offer.topics.length > 0 ? topicLabels(offer.topics).join(", ") : "None chosen yet"}</dd>
                {offer.availability ? (
                  <>
                    <dt>Usually</dt>
                    <dd>{offer.availability}</dd>
                  </>
                ) : null}
                <dt>Maximum</dt>
                <dd>{plural(offer.maxActive, "active mentee")}</dd>
              </dl>
            ) : (
              <p className="t-small text-fg-2">Loading your offer</p>
            )}
            <div className="flex flex-wrap gap-3 mt-5">
              <Link to="/settings/mentorship" className="btn btn-outline btn-sm">
                Mentorship settings
              </Link>
              <Link to="/settings/privacy" className="btn btn-ghost btn-sm">
                Contact methods
              </Link>
            </div>
          </Card>
          <Card title="How answering works" lift>
            <ul className="grid gap-3 t-small text-fg-2">
              <li>Accepting hands over only the contact methods you tick, to that one member.</li>
              <li>Declining sends your reason and note, nothing else.</li>
              <li>
                A request you do not answer closes on its own. Mark a mentorship completed when it is done, to free a
                place.
              </li>
            </ul>
            <Link to="/mentor/mentees" className="link t-small inline-flex mt-4">
              Your mentees
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
