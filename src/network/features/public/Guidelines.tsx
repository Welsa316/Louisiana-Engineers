/**
 * Community guidelines (`/network/guidelines`), a draft for the board. It
 * carries the A5 conduct line and describes the rules the platform already
 * enforces (review, request limits, reports and moderation) rather than
 * promising anything it does not do.
 */

import { Link } from "react-router";
import { useMeta } from "../../lib/meta";
import { Bullets, DraftDocument, type DraftSection } from "./DraftDocument";

const SECTIONS: DraftSection[] = [
  {
    id: "who",
    title: "Who these are for",
    body: (
      <>
        <p>
          Everyone who uses the MEST Network: students, professionals, mentors and the MEST administrators who run it.
          When you join, you confirm that you share MEST&rsquo;s mission and that you will follow these guidelines.
        </p>
      </>
    ),
  },
  {
    id: "honest",
    title: "Be who you say you are",
    body: (
      <>
        <Bullets
          items={[
            "Use your own name and keep your title, organization and experience current.",
            "List expertise you would be comfortable being asked about.",
            "A MEST administrator reviews every professional profile before it is listed, and may mark an affiliation as verified. Changing your title or organization removes that mark until it is checked again.",
          ]}
        />
      </>
    ),
  },
  {
    id: "time",
    title: "Respect people's time and choices",
    body: (
      <>
        <p>Mentors are volunteers. The platform keeps requests manageable for them:</p>
        <Bullets
          items={[
            "One open request to the same person at a time, and up to three requests waiting at once.",
            "A request with no answer after 14 days expires. A decline or an expiry is an answer; please do not follow up through other channels.",
            "Mentors set how many people they help at a time and can pause whenever they need to.",
          ]}
        />
        <p>
          <Link to="/mentorship" className="link">
            How mentorship works
          </Link>
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Use contact details only for what they were shared for",
    body: (
      <>
        <p>
          A member who shows you an email address, a LinkedIn profile or a booking link is inviting a professional
          conversation. Do not add them to mailing lists, pass their details on, or use them to sell, recruit in bulk
          or fundraise.
        </p>
      </>
    ),
  },
  {
    id: "meeting",
    title: "Meeting in person",
    body: (
      <>
        <p>
          <strong className="text-fg">Meet in public places; MEST does not supervise meetings.</strong>
        </p>
        <Bullets
          items={[
            "Choose a public place for a first meeting, such as a library, a campus space or a coffee shop, or start with a video call.",
            "Some members are high school students. Keep every conversation as professional as you would at a MEST event.",
            "If anything about a meeting makes you uncomfortable, end it and report the profile.",
          ]}
        />
      </>
    ),
  },
  {
    id: "not-allowed",
    title: "Not allowed",
    body: (
      <Bullets
        items={[
          "Harassment, threats or discrimination of any kind.",
          "Misrepresenting who you are, where you work or what you know.",
          "Sales pitches, solicitation and unsolicited recruiting.",
          "Sharing another member's contact details or anything they told you in confidence.",
        ]}
      />
    ),
  },
  {
    id: "reports",
    title: "Reports and what MEST can do",
    body: (
      <>
        <p>
          Any signed-in member can report a profile. Administrators read every report. The member who was reported is
          never told who reported them, and the person who reported is told when the report is closed.
        </p>
        <p>Depending on what happened, an administrator can:</p>
        <Bullets
          items={[
            "hide a profile from the directory, which also turns off its mentorship;",
            "stop a member from sending requests;",
            "remove an account.",
          ]}
        />
      </>
    ),
  },
];

export function Guidelines() {
  useMeta({ title: "Community guidelines" });
  return (
    <DraftDocument
      kicker="MEST Network"
      title="Community guidelines"
      lead="A professional network works when people are honest about who they are and careful with each other's time. These are the rules for doing that here."
      sections={SECTIONS}
    />
  );
}
