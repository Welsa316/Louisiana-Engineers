import { ArrowUpRight } from "lucide-react";

const frames = [
  {
    cls: "c-1 frame-ratio-3-2",
    src: "/images/gathering.webp",
    width: 1600,
    height: 1068,
    sizes: "(max-width: 48rem) 100vw, 58vw",
    alt: "Three members in conversation outdoors at an evening gathering",
    num: "01",
    label: "Networking",
  },
  {
    cls: "c-2 frame-ratio-4-5",
    src: "/images/engineers.webp",
    width: 1200,
    height: 801,
    sizes: "(max-width: 48rem) 50vw, 33vw",
    alt: "Two engineers in hard hats laughing over a set of drawings",
    num: "02",
    label: "Technical discussion",
  },
  {
    cls: "c-3 frame-ratio-4-3",
    src: "/images/drawings.webp",
    width: 1200,
    height: 801,
    sizes: "(max-width: 48rem) 50vw, 42vw",
    alt: "A senior engineer guiding a student through a large drawing on a drafting table",
    num: "03",
    label: "Mentorship",
  },
  {
    cls: "c-4 frame-ratio-1-1",
    src: "/images/workshop.webp",
    width: 1000,
    height: 667,
    sizes: "25vw",
    alt: "Three people leaning in over a laptop in a fabrication workshop",
    num: "04",
    label: "Collaboration",
  },
];

/**
 * Not rendered at launch. The content plan schedules a past-event gallery
 * for the next phase, with authentic MEST photographs; this layout is kept
 * for that, and its stock images should be replaced before it returns.
 */
export function Community() {
  return (
    <section
      className="section"
      id="community"
      aria-labelledby="community-title"
    >
      <div className="shell">
        <div className="section-head" data-reveal>
          <span className="num">03</span>
          <h2 className="t-label" id="community-title">
            Community in motion
          </h2>
        </div>

        <div className="grid-12 mt-14 md:mt-24 gap-y-8">
          <p className="t-display-lg col-span-12 md:col-span-9" data-split style={{ maxWidth: "16ch" }}>
            The work is technical. The reason is people.
          </p>
        </div>

        <div className="community-grid mt-16 md:mt-28">
          {frames.map((f, i) => (
            <figure className={f.cls} key={f.src} data-reveal>
              <div className={`frame ${f.cls.split(" ")[1]}`} data-aperture>
                <img
                  src={f.src}
                  width={f.width}
                  height={f.height}
                  sizes={f.sizes}
                  loading="lazy"
                  decoding="async"
                  alt={f.alt}
                  data-parallax
                  data-parallax-amount={i === 0 ? "5" : "7"}
                />
              </div>
              <figcaption className="frame-cap">
                <span>{f.label}</span>
                <span className="num">{f.num}</span>
              </figcaption>
            </figure>
          ))}
          <div className="c-text" data-reveal>
            <p className="t-body measure-wide">
              Networking sessions, mentorship pairings, technical conversations,
              and the kind of gatherings where a career quietly changes
              direction. The society is what happens between the meetings.
            </p>
            <a className="link mt-8" href="#events">
              See what's coming up
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
