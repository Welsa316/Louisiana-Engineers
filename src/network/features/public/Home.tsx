/**
 * The network home (`/network`): what the directory and mentorship are, who
 * may join, what is shared and with whom, and the ways in. Ported from the
 * prototype's landing; the live figures and featured profiles arrive with
 * the directory API (Task 13), so this page carries no counts it cannot back.
 */

import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { useMeta } from "../../lib/meta";
import { useSession } from "../../lib/session";
import { Star } from "../../ui/ui";

const LEDGER: [string, string][] = [
  [
    "Public by default",
    "An approved professional's name, title, organization, discipline, expertise, bio, education and mentorship offer. You can choose members only instead, or hide your profile.",
  ],
  [
    "Signed-in members",
    "The contact methods you choose to show them: an email address, LinkedIn or a booking link. Your phone number only if you add it.",
  ],
  [
    "Never listed",
    "Student profiles, and the address you sign in with. A mentor sees a student's profile only when that student asks them for help.",
  ],
  ["Reviewed", "A MEST administrator approves every professional profile before it appears in the directory."],
];

export function Home() {
  useMeta({ title: "MEST Network" });
  const { user } = useSession();

  return (
    <>
      <section className="pn-hero">
        <Star className="pn-hero-star" />
        <div className="shell">
          <span className="pn-kicker">The MEST professional network</span>
          <h1 className="mt-6">Find the person who has already done it.</h1>
          <p className="pn-hero-lead t-lead">
            A directory of Muslim engineers, scientists and technologists in Greater New Orleans, and a simple way to
            ask one of them for an hour of their time.
          </p>
          <div className="pn-hero-actions">
            <Link to="/directory" className="btn btn-solid">
              Browse the directory
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            {user ? null : (
              <Link to="/join" className="link">
                Add yourself to it
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="pn-band section" aria-labelledby="paths-title">
        <div className="shell">
          <div className="section-head">
            <span className="num">01</span>
            <h2 className="t-label" id="paths-title">
              Three ways in
            </h2>
          </div>
          <div className="pn-paths mt-12">
            <div className="pn-path">
              <span className="pn-kicker pn-kicker-plain">Students and early career</span>
              <h3>Ask for guidance</h3>
              <p>
                Search by discipline or by the question you have: an internship, the FE exam, graduate school, a first
                negotiation. Send a request. The mentor answers within two weeks, or the request expires and you are
                told.
              </p>
              <Link to="/join?as=student" className="link">
                Create a student account
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <div className="pn-path">
              <span className="pn-kicker pn-kicker-plain">Professionals</span>
              <h3>Be findable</h3>
              <p>
                List your discipline, expertise and organization so colleagues and students can find you. Decide
                yourself whether people can contact you, and how. Mentoring is optional and can be switched on later.
              </p>
              <Link to="/join?as=professional" className="link">
                Create a professional profile
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <div className="pn-path">
              <span className="pn-kicker pn-kicker-plain">Mentors</span>
              <h3>Give an hour, on your terms</h3>
              <p>
                Pick the topics you will talk about, who you want to help, and how many people at a time. Pause
                whenever work gets busy. When you accept a request, you choose which contact details the mentee sees.
              </p>
              <Link to="/mentorship" className="link">
                How mentorship works
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="who-title">
        <div className="shell grid-12 gap-y-8 items-end">
          <div className="col-span-12 md:col-span-8">
            <div className="section-head">
              <span className="num">02</span>
              <h2 className="t-label" id="who-title">
                Who can join
              </h2>
            </div>
            <p className="t-display-sm mt-10">
              Students and professionals in engineering, science and technology who share MEST&rsquo;s mission.
            </p>
            <p className="t-body text-fg-2 mt-6 max-w-[56ch]">
              Everyone confirms the mission statement when joining. Students start using the network straight away.
              Professionals appear in the directory once a MEST administrator has reviewed their profile.
            </p>
          </div>
          <div className="col-span-12 md:col-span-4 md:text-right">
            <Link to="/guidelines" className="link">
              Community guidelines
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section className="pn-band section" aria-labelledby="privacy-title">
        <div className="shell grid-12 gap-y-10">
          <div className="col-span-12 md:col-span-5">
            <div className="section-head">
              <span className="num">03</span>
              <h2 className="t-label" id="privacy-title">
                What is and is not shared
              </h2>
            </div>
            <p className="t-display-sm mt-10">Your profile shows what you choose. Your inbox stays yours.</p>
            <Link to="/privacy" className="link mt-8 inline-flex">
              Read the privacy notice
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className="col-span-12 md:col-start-7 md:col-span-6">
            <dl className="pn-ledger">
              {LEDGER.map(([term, detail]) => (
                <div key={term} className="grid grid-cols-1 sm:grid-cols-[9rem_minmax(0,1fr)] gap-2 sm:gap-6 py-5">
                  <dt className="t-label text-accent pt-1">{term}</dt>
                  <dd className="t-body text-fg-2">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </>
  );
}
