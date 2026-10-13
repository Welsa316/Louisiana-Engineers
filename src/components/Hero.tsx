import { ArrowDown, ArrowUpRight } from "lucide-react";
import { org } from "../content/site";

export function Hero() {
  return (
    <section className="hero" id="hero" aria-labelledby="hero-title">
      <div className="hero-media" aria-hidden="true">
        <img
          src="/images/hero.webp"
          srcSet="/images/hero-mobile.webp 1100w, /images/hero.webp 2400w"
          sizes="100vw"
          width={2400}
          height={1601}
          alt=""
          fetchPriority="high"
          decoding="async"
          data-hero-image
        />
        <div className="hero-shade" />
      </div>

      <div className="shell hero-content">
        <p className="t-label hero-eyebrow" data-hero="eyebrow">
          {org.name}
        </p>
        <h1 className="t-display-xl hero-title" id="hero-title" data-hero-title>
          Engineering progress. Building community.
        </h1>
        <p className="t-lead hero-copy measure" data-hero="copy">
          {org.description}
        </p>
        <div className="hero-actions" data-hero="actions">
          <a className="btn btn-light" href="#join">
            Join the Society
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
          <a className="link" href="#purpose">
            Explore our mission
            <ArrowDown size={15} aria-hidden="true" />
          </a>
        </div>

        <div className="hero-foot" data-hero="foot">
          <a className="scroll-cue" href="#purpose" aria-label="Scroll to our purpose">
            <span className="scroll-cue-line" aria-hidden="true" />
            <span className="t-label">Scroll</span>
          </a>
          <dl className="hero-meta">
            <div>
              <dt>Based in</dt>
              <dd>{org.region}</dd>
            </div>
            <div>
              <dt>Open to</dt>
              <dd>Students, engineers, professionals</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
