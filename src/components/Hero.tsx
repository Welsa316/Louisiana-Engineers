import { useLayoutEffect, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { Mark } from "./Mark";
import { org } from "../content/site";

/**
 * Hero: an oversized wordmark with a still photograph set into its
 * baseline, the way the reference sets its product under the title.
 * Everything that moves is a GSAP entrance or a scroll-scrubbed exit;
 * nothing idles or follows the pointer.
 */
export function Hero() {
  const root = useRef<HTMLElement>(null);
  const introRef = useRef<gsap.core.Timeline | null>(null);

  useLayoutEffect(() => {
    const scope = root.current;
    if (!scope) return;
    gsap.registerPlugin(ScrollTrigger, SplitText);

    const q = gsap.utils.selector(scope);
    const title = q<HTMLElement>("[data-hero-title]")[0];
    const panel = q<HTMLElement>("[data-hero-panel]")[0];
    const image = q<HTMLElement>("[data-hero-image]")[0];
    const rule = q<HTMLElement>("[data-hero-rule]")[0];
    const eyebrow = q<HTMLElement>("[data-hero-eyebrow]")[0];
    const line = q<HTMLElement>("[data-hero-line]")[0];
    const aside = q<HTMLElement>("[data-hero-aside] > *");
    const ctx = gsap.context(() => {}, scope);

    if (import.meta.env.DEV) {
      (window as unknown as { __hero?: unknown }).__hero = {
        finish: () => introRef.current?.progress(1),
      };
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !title || !panel || !image || !rule || !eyebrow || !line) {
      return () => ctx.revert();
    }

    // Start states, applied before first paint so nothing flashes.
    gsap.set(title, { autoAlpha: 0 });
    gsap.set(panel, { "--reveal": 0.25, autoAlpha: 0 });
    gsap.set(image, { scale: 1.12, yPercent: -3 });
    gsap.set(rule, { scaleX: 0, transformOrigin: "left center" });
    gsap.set(eyebrow, { autoAlpha: 0, y: 12 });
    gsap.set(line, { autoAlpha: 0 });
    gsap.set(aside, { autoAlpha: 0, y: 16 });

    const splits: SplitText[] = [];
    ctx.add(() => {
      const intro = gsap.timeline({ defaults: { ease: "expo.out" } });
      introRef.current = intro;

      // 1. Wordmark: each letter rises out of its own mask.
      const chars = SplitText.create(title, { type: "chars", mask: "chars" });
      splits.push(chars);
      gsap.set(title, { autoAlpha: 1 });
      intro
        .fromTo(
          chars.chars,
          { yPercent: 112 },
          { yPercent: 0, duration: 1.5, stagger: 0.085 },
          0.1,
        )
        .fromTo(
          title,
          { letterSpacing: "0.04em" },
          { letterSpacing: "-0.045em", duration: 2, ease: "expo.out" },
          0.1,
        );

      // 2. Photograph: the tonal field opens like an aperture behind the type
      //    while the image itself settles.
      intro
        .to(panel, { "--reveal": 1, autoAlpha: 0.62, duration: 2.6, ease: "expo.out" }, 0.45)
        .to(image, { scale: 1, yPercent: 0, duration: 2.8, ease: "power3.out" }, 0.45);

      // 3. Rule draws, then copy and actions arrive in sequence.
      const lines = SplitText.create(line, { type: "lines", mask: "lines" });
      splits.push(lines);
      gsap.set(line, { autoAlpha: 1 });
      intro
        .to(rule, { scaleX: 1, duration: 1.4, ease: "power3.inOut" }, 1.1)
        .to(eyebrow, { autoAlpha: 1, y: 0, duration: 0.9 }, 1.45)
        .fromTo(
          lines.lines,
          { yPercent: 110 },
          { yPercent: 0, duration: 1.2, stagger: 0.11 },
          1.55,
        )
        .to(aside, { autoAlpha: 1, y: 0, duration: 1, stagger: 0.14 }, 1.8);

      // Exit: three layers leave at three speeds, the image drifting inside
      // its frame, so the hero recedes with depth rather than scrolling flat.
      gsap
        .timeline({
          scrollTrigger: { trigger: scope, start: "top top", end: "bottom top", scrub: true },
        })
        .to(title, { yPercent: -34, autoAlpha: 0.1, ease: "none" }, 0)
        .to(panel, { yPercent: -10, scale: 1.08, ease: "none" }, 0)
        .to(image, { yPercent: 6, ease: "none" }, 0)
        .to([eyebrow, line, ...aside], { y: -40, autoAlpha: 0, ease: "none" }, 0)
        .to(rule, { scaleX: 0, transformOrigin: "right center", ease: "none" }, 0);
    });

    return () => {
      splits.forEach((s) => s.revert());
      ctx.revert();
    };
  }, []);

  return (
    <section className="hero" id="hero" ref={root} aria-labelledby="hero-title">
      <div className="hero-stage" aria-hidden="true">
        <p className="hero-mark" data-hero-title>
          {org.short}
        </p>
      </div>

      <figure className="hero-panel" data-hero-panel>
        <img
          data-hero-image
          src="/images/hero-panel.webp"
          srcSet="/images/hero-panel-mobile.webp 1000w, /images/hero-panel.webp 2000w"
          sizes="(max-width: 48rem) 100vw, (max-width: 64rem) 64vw, 54vw"
          width={2000}
          height={870}
          alt="Beneath a modern concrete causeway, a tunnel of converging piers over green water"
          fetchPriority="high"
          decoding="async"
        />
      </figure>

      <div className="shell hero-foot">
        <span className="hero-rule" data-hero-rule aria-hidden="true" />
        <div className="hero-intro">
          <h1 className="t-label hero-eyebrow" id="hero-title" data-hero-eyebrow>
            {org.name}
          </h1>
          <p className="t-display-sm hero-line" data-hero-line>
            Connecting minds.
            <br />
            Engineering tomorrow.
          </p>
        </div>

        <div className="hero-aside" data-hero-aside>
          <div className="hero-aside-info">
            <Mark className="w-7 h-7 text-champagne" />
            <p className="t-small">
              A professional community for engineers, students and researchers
              across Louisiana.
            </p>
          </div>
          <div className="hero-actions">
            <a className="btn btn-light" href="#purpose">
              Discover {org.short}
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
            <a className="link" href="#join">
              Join the Society
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
