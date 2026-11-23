/**
 * Privacy notice (`/network/privacy`), a draft for the board, written from
 * the architecture doc: what is collected (02 section 4.3), who sees what
 * (section 5.4), the defaults for retention (A9: request text emptied after
 * 24 months) and deletion with a 14-day grace period (section 8).
 */

import { Link } from "react-router";
import { contact, org } from "../../../content/site";
import { useMeta } from "../../lib/meta";
import { Bullets, DraftDocument, type DraftSection } from "./DraftDocument";

const SECTIONS: DraftSection[] = [
  {
    id: "who-we-are",
    title: "Who runs the network",
    body: (
      <>
        <p>
          The MEST Network is run by {org.name} ({org.short}), based in {contact.city}. Questions about your data go to{" "}
          {contact.email ? (
            <a className="link" href={`mailto:${contact.email}`}>
              {contact.email}
            </a>
          ) : (
            "the MEST contact address, which will be published here before launch"
          )}
          .
        </p>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <Bullets
          items={[
            <>
              <strong className="text-fg">Your account:</strong> the email address you sign in with, when you joined and
              last signed in, and your Google account identifier if you sign in with Google. There are no passwords.
            </>,
            <>
              <strong className="text-fg">Your profile:</strong> what you enter when you join. For professionals: name,
              credentials, title, organization, discipline, years of experience, expertise, bio, education, location,
              links and your mentorship offer. For students: program, level, institution, goals, interests and the topics
              you want help with.
            </>,
            <>
              <strong className="text-fg">How people can reach you:</strong> the contact methods you choose, and a
              contact email, phone number or booking link if you add them.
            </>,
            <>
              <strong className="text-fg">Mentorship:</strong> the requests you send and receive, including what you
              write in them, and the mentoring relationships that follow.
            </>,
            <>
              <strong className="text-fg">Security records:</strong> sign-in links (stored only in a form that cannot be
              turned back into a link), the network address a link was requested from, to limit how many are sent, your
              browser&rsquo;s description for each signed-in session, and a log of important actions, such as profile
              approvals and each time someone views your contact details.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "who-sees",
    title: "Who sees what",
    body: (
      <>
        <Bullets
          items={[
            <>
              <strong className="text-fg">Anyone, signed in or not:</strong> an approved professional profile that is
              public, which is the default. It shows your name, credentials, title, organization, discipline, expertise,
              bio, education, location, website and mentorship offer.
            </>,
            <>
              <strong className="text-fg">Signed-in members:</strong> profiles set to members only, and the contact
              methods each professional chose to show members. Your phone number is shown only if you add it.
            </>,
            <>
              <strong className="text-fg">A mentor you ask for help:</strong> your student profile and your request.
              Student profiles are never listed in the directory.
            </>,
            <>
              <strong className="text-fg">A mentee you accept:</strong> the contact methods you choose when you accept.
            </>,
            <>
              <strong className="text-fg">MEST administrators:</strong> profiles in every state, to review and moderate
              them. They see only the domain of your sign-in address, never the address itself, and never your saved
              profiles. They do not read what is written in requests unless a report involves them.
            </>,
          ]}
        />
        <p>You can hide your profile from everyone at any time in your settings.</p>
      </>
    ),
  },
  {
    id: "email",
    title: "Email",
    body: (
      <>
        <p>
          We send sign-in links and notifications through our email provider, Resend. Notification emails never
          include what you wrote in a request, an email address or a phone number; they link back to the network
          instead. You choose which notifications reach your inbox in your settings, except account messages such as
          sign-in links and deletion notices.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <>
        <p>
          One cookie keeps you signed in, for up to 30 days. If you use Google, a second cookie lasts 10 minutes while
          Google sign-in completes. There are no advertising or analytics cookies, and nothing on the network tracks
          you across other sites.
        </p>
      </>
    ),
  },
  {
    id: "hosting",
    title: "Where your data lives",
    body: (
      <>
        <p>
          The network and its database are hosted on Railway. Google is involved only if you choose to sign in with
          Google. We do not sell data, show advertising or share your information with anyone else.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <>
        <Bullets
          items={[
            "Your profile and settings, for as long as you keep your account.",
            "The text of expired and declined requests is emptied after 24 months. The fact that a request happened is kept for program statistics.",
            "The log of important actions is kept, and holds no contact details.",
          ]}
        />
      </>
    ),
  },
  {
    id: "deletion",
    title: "Deleting your account",
    body: (
      <>
        <p>You can delete your account yourself from your settings. When you do:</p>
        <Bullets
          items={[
            "Your profile disappears from the directory straight away, and your open requests are closed.",
            "You have 14 days to change your mind by signing in and choosing to keep your account.",
            "After 14 days your profile, details, contact preferences, saved profiles and notifications are deleted, and your sign-in address is erased.",
            "Requests you took part in stay in the other person's history under the name “Former member”, with everything you wrote removed.",
          ]}
        />
      </>
    ),
  },
  {
    id: "rights",
    title: "Your data, your choice",
    body: (
      <>
        <p>
          You can see and change everything on your profile, download a copy of your data from your settings, and
          delete your account at any time. To ask a question or make a request by email, use the address in{" "}
          <a href="#who-we-are" className="link">
            Who runs the network
          </a>
          .
        </p>
        <p>
          <Link to="/guidelines" className="link">
            Community guidelines
          </Link>
        </p>
      </>
    ),
  },
];

export function Privacy() {
  useMeta({ title: "Privacy notice" });
  return (
    <DraftDocument
      kicker="MEST Network"
      title="Privacy notice"
      lead="What the MEST Network collects about you, who can see it, how long it is kept and how to delete it."
      sections={SECTIONS}
    />
  );
}
