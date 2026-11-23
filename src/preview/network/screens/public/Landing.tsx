import { ArrowUpRight, ArrowRight } from "lucide-react";
import { Link } from "../../router";
import { useStore, isListed, isMentorAvailable } from "../../state/store";
import { disciplines, mentorshipTopics } from "@shared/taxonomy";
import { ProfileCard } from "../../components/prototype-directory";
import { Star } from "../../../../network/ui/ui";

/** 1. Professional network landing page. */
export function Landing() {
  const { state } = useStore();
  const listed = state.professionals.filter((p) => isListed(p, state.role));
  const mentors = listed.filter((p) => isMentorAvailable(p, state.requests));
  const fields = new Set(listed.map((p) => p.disciplineId)).size;
  const featured = listed.filter((p) => ["layla-haddad", "omar-siddiqui", "fatima-noor"].includes(p.id));

  return (
    <>
      <section className="pn-hero">
        <Star className="pn-hero-star" />
        <div className="shell">
          <span className="pn-kicker">The MEST professional network</span>
          <h1 className="mt-6">Find the person who has already done it.</h1>
          <p className="pn-hero-lead t-lead">
            A directory of Muslim engineers, scientists and technologists in Greater New Orleans, and a simple way
            to ask one of them for an hour of their time.
          </p>
          <div className="pn-hero-actions">
            <Link to="/directory" className="btn btn-solid">
              Browse the directory
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            <Link to="/join" className="link">
              Add yourself to it
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section className="shell pb-16 md:pb-24" aria-label="Network at a glance">
        <div className="pn-figures">
          <div className="pn-figure">
            <b>{listed.length}</b>
            <span>Professionals listed</span>
          </div>
          <div className="pn-figure">
            <b>{mentors.length}</b>
            <span>Mentors taking requests</span>
          </div>
          <div className="pn-figure">
            <b>{fields}</b>
            <span>Disciplines, of {disciplines.length}</span>
          </div>
          <div className="pn-figure">
            <b>{mentorshipTopics.length}</b>
            <span>Topics you can ask about</span>
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
                Search by discipline or by the question you have: an internship, the FE exam, graduate school, a
                first negotiation. Send a request. The mentor answers within two weeks or it expires on its own.
              </p>
              <Link to="/join/student" className="link">
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
              <Link to="/join/professional" className="link">
                Create a professional profile
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <div className="pn-path">
              <span className="pn-kicker pn-kicker-plain">Mentors</span>
              <h3>Give an hour, on your terms</h3>
              <p>
                Pick the topics you will talk about, who you want to help, and how many people at a time. Pause
                whenever work gets busy. We only pass on requests; nothing personal is shown until you accept.
              </p>
              <Link to="/mentorship" className="link">
                How mentorship works
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="featured-title">
        <div className="shell">
          <div className="section-head">
            <span className="num">02</span>
            <h2 className="t-label" id="featured-title">
              In the directory
            </h2>
          </div>
          <div className="grid-12 mt-12 gap-y-8 items-end">
            <p className="t-display-sm col-span-12 md:col-span-8">
              Coastal engineers, epidemiologists, software leads, a structural engineer who runs his own firm. People
              working in the region, listed on their own terms.
            </p>
            <div className="col-span-12 md:col-span-4 md:text-right">
              <Link to="/directory" className="link">
                See everyone
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="pn-cards mt-10">
            {featured.map((p) => (
              <ProfileCard key={p.id} p={p} to={`/directory/${p.id}`} />
            ))}
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
          </div>
          <div className="col-span-12 md:col-start-7 md:col-span-6">
            <dl className="pn-ledger">
              {[
                ["Always public", "Name, title, organization, discipline, expertise, general location."],
                ["Your choice", "Whether you appear in the directory at all, whether members can contact you, whether you mentor."],
                ["Never public", "Email address, phone number. Shared only with a mentee you accept, and only if you choose to."],
                ["Reviewed", "Every professional profile is approved by a MEST administrator before it is listed."],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-6 py-5">
                  <dt className="t-label text-accent pt-1">{k}</dt>
                  <dd className="t-body text-fg-2">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </>
  );
}

/** Information about the mentorship program, for visitors. */
export function MentorshipInfo() {
  return (
    <>
      <section className="shell pt-16 md:pt-24 pb-12">
        <span className="pn-kicker">Mentorship</span>
        <h1 className="t-display-lg mt-6 max-w-[16ch]">An hour with someone a few steps ahead.</h1>
        <p className="t-lead text-fg-2 mt-8 max-w-[52ch]">
          MEST mentorship is deliberately light. A student or early-career member asks a specific question; a
          professional who has offered to help answers it in one or a few conversations. No curriculum, no
          platform messaging to keep up with, no obligation to continue.
        </p>
      </section>

      <section className="shell pb-16 md:pb-24">
        <ol className="pn-ledger">
          {[
            ["Find a mentor", "Filter the directory to people available to mentor and the topic you need. Read their profile: what they offer, who they prefer to help, how they like to meet."],
            ["Send a request", "Say why you are reaching out and what you hope to get from it. Pick one-time or recurring, online or in person. You can have three requests open at once."],
            ["They decide", "The mentor sees your request and your profile, and accepts or declines within 14 days. Either way you get a note from them. Unanswered requests expire quietly."],
            ["Meet", "On accept, you see how the mentor wants to be reached: a scheduling link, an email, or LinkedIn. You arrange the meeting directly; MEST stays out of the way."],
            ["Close the loop", "When the conversation has run its course, either of you marks it complete. Mentors see how many people they have helped; MEST sees that the program works."],
          ].map(([t, d], i) => (
            <li key={t} className="grid grid-cols-[3rem_minmax(0,1fr)] md:grid-cols-[6rem_minmax(0,5fr)_minmax(0,7fr)] gap-4 md:gap-8 py-7">
              <span className="t-numeral text-accent text-sm pt-2">0{i + 1}</span>
              <h2 className="t-heading col-span-1">{t}</h2>
              <p className="t-body text-fg-2 col-start-2 md:col-start-3">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="pn-band section">
        <div className="shell grid-12 gap-y-10">
          <div className="col-span-12 md:col-span-5">
            <h2 className="t-display-sm">For mentors: the small print, in plain words.</h2>
          </div>
          <ul className="col-span-12 md:col-start-7 md:col-span-6 pn-ledger t-body text-fg-2">
            {[
              "You choose the topics, the audience and the format. Requests outside them do not reach you.",
              "You set a cap on active mentees. When it is reached, you show as full until something completes.",
              "Pause for any length of time. Your profile stays listed; the request button disappears.",
              "Your contact details are shown only to mentees you accept, and only the ones you pick.",
              "Two reminders, then the request expires. No nagging.",
            ].map((t) => (
              <li key={t} className="py-4">
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="shell section">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <p className="t-display-sm max-w-[22ch]">Ready to ask, or to offer?</p>
          <div className="flex flex-wrap gap-4">
            <Link to="/me/discover" className="btn btn-solid">
              Find a mentor
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            <Link to="/join/professional" className="btn btn-outline">
              Become a mentor
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
