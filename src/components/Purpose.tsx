import { LogoMark } from "./Logo";
import { mission } from "../content/site";

/** 01 Mission & About: purpose, audience, and the mission statement. */
export function Purpose() {
  return (
    <section className="section" id="mission" aria-labelledby="mission-title">
      <div className="shell">
        <div className="section-head" data-reveal>
          <span className="num">01</span>
          <h2 className="t-label" id="mission-title">
            Mission &amp; about
          </h2>
        </div>

        <div className="grid-12 mt-14 md:mt-24">
          <div className="col-span-12 md:col-span-3">
            <div data-reveal>
              <LogoMark className="purpose-mark" />
            </div>
          </div>
          <div className="col-span-12 md:col-span-9 mt-10 md:mt-0">
            <p className="t-display-lg purpose-statement" data-split>
              {mission.about}
            </p>
          </div>
        </div>

        <div className="grid-12 mt-14 md:mt-24 gap-y-12">
          <div className="col-span-12 md:col-start-4 md:col-span-5" data-reveal>
            <h3 className="t-label text-accent">Our mission</h3>
            <p className="t-lead measure-wide mt-5">{mission.statement}</p>
          </div>
          <div className="col-span-12 md:col-start-10 md:col-span-3" data-reveal>
            <h3 className="t-label text-accent">Who it's for</h3>
            <ul className="audience-list mt-5">
              {mission.audience.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
