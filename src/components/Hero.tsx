import { useLayoutEffect, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { LogoMark } from "./Logo";
import { org } from "../content/site";
import { starClipPath, starCoverRadius } from "../lib/geometry";
import { fontsReady } from "../lib/fonts";

/**
 * Hero: a full-bleed night photograph of a cable-stayed bridge, opened
 * through an eight-pointed star aperture, with the wordmark set large in
 * Cormorant over it. Every movement is a GSAP entrance or a scroll-scrubbed
 * exit; nothing idles and nothing follows the pointer.
 */
export function Hero() {
  const root = useRef<HTMLElement>(null);
  const introRef = useRef<gsap.core.Timeline | null>(null);

  useLayoutEffect(() => {
    const scope = root.current;
    if (!scope) return;
    gsap.registerPlugin(ScrollTrigger, SplitText);

    const q = gsap.utils.selector(scope);
    const media = q<HTMLElement>("[data-hero-media]")[0];
    const image = q<HTMLElement>("[data-hero-image]")[0];
    const title = q<HTMLElement>("[data-hero-title]")[0];
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
    if (reduced || !media || !image || !title || !rule || !eyebrow || !line) {
      return () => ctx.revert();
    }

    // Start states, applied before first paint.
    const w = media.clientWidth;
    const h = media.clientHeight;
    gsap.set(media, { clipPath: starClipPath(w, h, 0.5) });
    gsap.set(image, { scale: 1.18 });
    gsap.set(title, { autoAlpha: 0 });
    gsap.set(rule, { scaleX: 0, transformOrigin: "left center" });
    gsap.set(eyebrow, { autoAlpha: 0, y: 12 });
    gsap.set(line, { autoAlpha: 0 });
    gsap.set(aside, { autoAlpha: 0, y: 16 });

    const splits: SplitText[] = [];
    let cancelled = false;
    ctx.add(() => {
      const intro = gsap.timeline({ defaults: { ease: "expo.out" } });
      introRef.current = intro;

      // 1. Aperture: the photograph opens through the star and settles.
      intro
        .to(
          media,
          {
            clipPath: starClipPath(w, h, starCoverRadius(w, h)),
            duration: 2.6,
            ease: "expo.inOut",
            onComplete: () => gsap.set(media, { clearProps: "clipPath" }),
          },
          0,
        )
        .to(image, { scale: 1, duration: 3.4, ease: "power3.out" }, 0);

      // 2. Rule draws, then the label and actions arrive in sequence.
      intro
        .to(rule, { scaleX: 1, duration: 1.4, ease: "power3.inOut" }, 1.5)
        .to(eyebrow, { autoAlpha: 1, y: 0, duration: 0.9 }, 1.8)
        .to(aside, { autoAlpha: 1, y: 0, duration: 1, stagger: 0.14 }, 2.15);

      // Exit: the photograph lags the scroll and swells slightly, the type
      // and copy leave faster, the rule retracts.
      gsap
        .timeline({
          scrollTrigger: { trigger: scope, start: "top top", end: "bottom top", scrub: true },
        })
        .to(image, { yPercent: 12, scale: 1.08, ease: "none" }, 0)
        .to(title, { yPercent: -30, autoAlpha: 0.1, ease: "none" }, 0)
        .to([eyebrow, line, ...aside], { y: -40, autoAlpha: 0, ease: "none" }, 0)
        .to(rule, { scaleX: 0, transformOrigin: "right center", ease: "none" }, 0);
    });

    // 3. Letter and line masks are measured from the real font, so they wait
    // for it (at most 1.2s) and then join the intro at their planned times.
    fontsReady().then(() => {
      if (cancelled) return;
      ctx.add(() => {
        const intro = introRef.current;
        if (!intro) return;
        const at = (t: number) => Math.max(t, intro.time());

        const chars = SplitText.create(title, { type: "chars", mask: "chars" });
        splits.push(chars);
        gsap.set(title, { autoAlpha: 1 });
        intro.add(
          gsap.fromTo(
            chars.chars,
            { yPercent: 112 },
            { yPercent: 0, duration: 1.6, stagger: 0.09, ease: "expo.out" },
          ),
          at(0.7),
        );

        const lines = SplitText.create(line, { type: "lines", mask: "lines" });
        splits.push(lines);
        gsap.set(line, { autoAlpha: 1 });
        intro.add(
          gsap.fromTo(
            lines.lines,
            { yPercent: 110 },
            { yPercent: 0, duration: 1.2, stagger: 0.11, ease: "expo.out" },
          ),
          at(1.9),
        );
      });
    });

    return () => {
      cancelled = true;
      splits.forEach((s) => s.revert());
      ctx.revert();
    };
  }, []);

  return (
    <section className="hero" id="hero" ref={root} aria-labelledby="hero-title">
      <div className="hero-media" data-hero-media aria-hidden="true">
        <img
          data-hero-image
          src="/images/hero.webp"
          srcSet="/images/hero-mobile.webp 1100w, /images/hero.webp 2400w"
          sizes="100vw"
          width={2400}
          height={1350}
          alt=""
          fetchPriority="high"
          decoding="async"
        />
        <div className="hero-shade" />
        <div className="hero-tint" />
        <div className="hero-scrim" />
        <div className="hero-grain" />
      </div>

      <div className="hero-stage" aria-hidden="true">
        <p className="hero-mark" data-hero-title>
          {org.short}
        </p>
      </div>

      <div className="shell hero-foot">
        <span className="hero-rule" data-hero-rule aria-hidden="true" />
        <div className="hero-intro">
          <h1 className="t-label hero-eyebrow" id="hero-title" data-hero-eyebrow>
            {org.name}
            <span className="sr-only">, </span>
            <span className="hero-place">{org.region}</span>
          </h1>
          <p className="t-display-sm hero-line" data-hero-line>
            {org.headline[0]}
            <br />
            {org.headline[1]}
          </p>
        </div>

        <div className="hero-aside" data-hero-aside>
          <div className="hero-aside-info">
            <LogoMark />
            <p className="t-small">{org.intro}</p>
          </div>
          <div className="hero-actions">
            <a className="btn btn-light" href="#get-involved">
              Join {org.short}
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
            <a className="link" href="#mission">
              Our mission
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
