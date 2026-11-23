/**
 * How mentorship works, for visitors and members (`/network/mentorship`).
 * Ported from the prototype; the numbers (three open requests, 14 days,
 * reminders on days 5 and 10) are the `config` defaults, and the contact
 * rules follow the hybrid visibility decision.
 */

import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { useMeta } from "../../lib/meta";
import { useSession } from "../../lib/session";

const STEPS: [string, string][] = [
  [
    "Find a mentor",
    "Filter the directory to people taking requests and the topic you need. Read their profile: what they offer, who they prefer to help, how they like to meet.",
  ],
  [
    "Send a request",
    "Say why you are reaching out and what you hope to get from it. Pick one-time or recurring, online or in person. You can have three requests waiting at once.",
  ],
  [
    "They decide",
    "The mentor sees your request and your profile, and accepts or declines within 14 days. Either way you are told. A request with no answer after 14 days expires, and you are pointed to others who offer the same topic.",
  ],
  [
    "Meet",
    "On accept, you see how the mentor wants to be reached: a booking link, an email address, LinkedIn, or a phone number if they choose to share it. You arrange the meeting directly; MEST stays out of the way.",
  ],
  [
    "Close the loop",
    "When the conversation has run its course, either of you marks it complete. That frees a place for the mentor's next request.",
  ],
];

const SMALL_PRINT = [
  "You choose the topics, the audience and the format. Requests outside them do not reach you.",
  "You set a limit on active mentees. When it is reached, your profile says you are not taking new requests until one completes.",
  "Pause for any length of time, with a date to resume if you like. Your profile stays listed; the request button goes away.",
  "When you accept, you choose which of your contact methods the mentee sees. Your phone number is never shared unless you add it.",
  "Two reminders, on day 5 and day 10, then the request expires. Nothing more.",
  "Meet in public places; MEST does not supervise meetings.",
];

export function Mentorship() {
  useMeta({ title: "Mentorship" });
  const { user } = useSession();
  const professional = user?.kind === "professional";

  return (
    <>
      <section className="shell pt-16 md:pt-24 pb-12">
        <span className="pn-kicker">Mentorship</span>
        <h1 className="t-display-lg mt-6 max-w-[16ch]">An hour with someone a few steps ahead.</h1>
        <p className="t-lead text-fg-2 mt-8 max-w-[52ch]">
          MEST mentorship is deliberately light. A student or early-career member asks a specific question; a
          professional who has offered to help answers it in one or a few conversations. No curriculum, no platform
          messaging to keep up with, no obligation to continue.
        </p>
      </section>

      <section className="shell pb-16 md:pb-24" aria-label="How a request works">
        <ol className="pn-ledger">
          {STEPS.map(([title, detail], index) => (
            <li
              key={title}
              className="grid grid-cols-[3rem_minmax(0,1fr)] md:grid-cols-[6rem_minmax(0,5fr)_minmax(0,7fr)] gap-4 md:gap-8 py-7"
            >
              <span className="t-numeral text-accent text-sm pt-2" aria-hidden="true">
                0{index + 1}
              </span>
              <h2 className="t-heading col-span-1">{title}</h2>
              <p className="t-body text-fg-2 col-start-2 md:col-start-3">{detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="pn-band section" aria-labelledby="small-print-title">
        <div className="shell grid-12 gap-y-10">
          <div className="col-span-12 md:col-span-5">
            <h2 id="small-print-title" className="t-display-sm">
              For mentors: the small print, in plain words.
            </h2>
          </div>
          <ul className="col-span-12 md:col-start-7 md:col-span-6 pn-ledger t-body text-fg-2">
            {SMALL_PRINT.map((line) => (
              <li key={line} className="py-4">
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="shell section" aria-label="Get started">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <p className="t-display-sm max-w-[22ch]">Ready to ask, or to offer?</p>
          <div className="flex flex-wrap gap-4">
            <Link to={user ? "/me/discover" : "/join?as=student"} className="btn btn-solid">
              Find a mentor
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            <Link
              to={professional ? "/settings" : user ? "/guidelines" : "/join?as=professional"}
              className="btn btn-outline"
            >
              {professional ? "Mentorship settings" : user ? "Community guidelines" : "Become a mentor"}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
