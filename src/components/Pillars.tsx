import { pillars } from "../content/site";

export function Pillars() {
  return (
    <section className="band-panel" id="offers" aria-labelledby="offers-title">
      <div className="shell section">
        <div className="section-head" data-reveal>
          <h2 className="t-label" id="offers-title">
            What MEST offers
          </h2>
        </div>

        <div className="grid-12 mt-14 md:mt-20 gap-y-8">
          <p className="t-display-md col-span-12 md:col-span-7" data-split>
            Three commitments that shape everything we do.
          </p>
          <p
            className="t-body text-fg-2 col-span-12 md:col-start-9 md:col-span-4 measure-wide md:pt-3"
            data-reveal
          >
            Each one is a practice, not a slogan. Together they describe what a
            member can expect from the society, and what the society asks in
            return.
          </p>
        </div>

        <ul className="pillar-grid mt-14 md:mt-20" data-stagger>
          {pillars.map((p) => (
            <li className="pillar" key={p.title} data-reveal>
              <div className="pillar-index t-label">
                <span>{p.index}</span>
              </div>
              <h3 className="t-display-md pillar-title">{p.title}</h3>
              <p className="t-body">{p.summary}</p>
              <p className="t-small pillar-detail">{p.detail}</p>
              <span className="pillar-rule" aria-hidden="true" />
            </li>
          ))}
        </ul>
      </div>

      <figure className="band-media" data-aperture>
        <img
          src="/images/lattice.webp"
          srcSet="/images/lattice-mobile.webp 900w, /images/lattice.webp 2000w"
          sizes="100vw"
          width={2000}
          height={1334}
          loading="lazy"
          decoding="async"
          alt="A steel space-frame lattice seen from below, thousands of members meeting at shared nodes"
          data-parallax
        />
        <figcaption className="shell band-caption">
          <p className="t-heading" style={{ maxWidth: "22ch" }}>
            Every member carries part of the load.
          </p>
          <p className="t-label" style={{ opacity: 0.7 }}>
            Structure
          </p>
        </figcaption>
      </figure>
    </section>
  );
}
