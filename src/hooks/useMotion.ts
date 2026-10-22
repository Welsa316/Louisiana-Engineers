import { useLayoutEffect, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { starClipPath, starCoverRadius } from "../lib/geometry";
import { fontsReady } from "../lib/fonts";

const REVEAL_START = "top 88%";

function inViewport(el: Element) {
  const rect = el.getBoundingClientRect();
  return rect.top < window.innerHeight * 0.92 && rect.bottom > 0;
}

/**
 * Page motion: hero entrance, masked headline reveals, scroll reveals and
 * image parallax. Start states are applied in the same frame as mount so
 * nothing flashes; reduced-motion users get the composed page untouched.
 */
export function useMotion(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const scope = root.current;
    if (!scope) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger, SplitText);
    scope.classList.add("motion");

    const q = gsap.utils.selector(scope);
    const reveals = q<HTMLElement>("[data-reveal]");
    const headerBits = q<HTMLElement>("[data-header] .header-inner > *");
    const splits = q<HTMLElement>("[data-split]");

    // Start states, before first paint.
    gsap.set(reveals, { autoAlpha: 0, y: 28 });
    gsap.set(headerBits, { autoAlpha: 0, y: -8 });
    gsap.set(splits, { autoAlpha: 0 });

    const ctx = gsap.context(() => {}, scope);
    const splitInstances: SplitText[] = [];
    const revealTweens: gsap.core.Tween[] = [];
    const timers: number[] = [];
    let cancelled = false;

    fontsReady().then(() => {
      if (cancelled) return;
      ctx.add(() => {
        // Header entrance --------------------------------------------------
        const intro = gsap.timeline({ defaults: { ease: "expo.out" } });
        intro.to(headerBits, { autoAlpha: 1, y: 0, duration: 1, stagger: 0.06 }, 0.3);

        // Masked line reveals for section statements -----------------------
        splits.forEach((el) => {
          let revealed = false;
          splitInstances.push(
            SplitText.create(el, {
              type: "lines",
              mask: "lines",
              autoSplit: true,
              onSplit(self) {
                gsap.set(el, { autoAlpha: 1 });
                if (revealed) return undefined;
                const tween = gsap.fromTo(
                  self.lines,
                  { yPercent: 108 },
                  {
                    yPercent: 0,
                    duration: 1.15,
                    ease: "expo.out",
                    stagger: 0.09,
                    paused: true,
                    onComplete: () => {
                      revealed = true;
                    },
                  },
                );
                ScrollTrigger.create({
                  trigger: el,
                  start: REVEAL_START,
                  once: true,
                  onEnter: () => tween.play(),
                  onRefresh: (st) => {
                    if (st.progress > 0 || st.isActive) tween.play();
                  },
                });
                revealTweens.push(tween);
                return tween;
              },
            }),
          );
        });

        // Scroll reveals ---------------------------------------------------
        reveals.forEach((el) => {
          const group = el.closest("[data-stagger]");
          const index = group
            ? Array.from(group.querySelectorAll("[data-reveal]")).indexOf(el)
            : 0;
          const tween = gsap.fromTo(
            el,
            { autoAlpha: 0, y: 28 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.95,
              ease: "power3.out",
              delay: index * 0.08,
              paused: true,
            },
          );
          ScrollTrigger.create({
            trigger: el,
            start: REVEAL_START,
            once: true,
            onEnter: () => tween.play(),
            onRefresh: (st) => {
              if (st.progress > 0 || st.isActive) tween.play();
            },
          });
          revealTweens.push(tween);
          timers.push(
            window.setTimeout(() => {
              if (tween.progress() === 0 && inViewport(el)) tween.play();
            }, 1500),
          );
        });

        // Star apertures: section imagery opens through the same eight-point
        // geometry as the hero, once, when it enters the viewport.
        q<HTMLElement>("[data-aperture]").forEach((el) => {
          const w = el.clientWidth;
          const h = el.clientHeight;
          const tween = gsap.fromTo(
            el,
            { clipPath: starClipPath(w, h, 0.5) },
            {
              clipPath: starClipPath(w, h, starCoverRadius(w, h)),
              duration: 1.9,
              ease: "expo.inOut",
              paused: true,
              onComplete: () => gsap.set(el, { clearProps: "clipPath" }),
            },
          );
          ScrollTrigger.create({
            trigger: el,
            start: "top 82%",
            once: true,
            onEnter: () => tween.play(),
            onRefresh: (st) => {
              if (st.progress > 0 || st.isActive) tween.play();
            },
          });
          revealTweens.push(tween);
        });

        // Parallax ---------------------------------------------------------
        q<HTMLElement>("[data-parallax]").forEach((img) => {
          const amount = Number(img.dataset.parallaxAmount ?? 7);
          gsap.fromTo(
            img,
            { yPercent: -amount },
            {
              yPercent: amount,
              ease: "none",
              scrollTrigger: {
                trigger: img.parentElement,
                start: "top bottom",
                end: "bottom top",
                scrub: true,
              },
            },
          );
        });

        // Failsafe sweep: nothing stays hidden above the fold.
        timers.push(
          window.setTimeout(() => {
            revealTweens.forEach((t) => {
              const target = t.targets()[0] as Element | undefined;
              const el = target?.closest("[data-reveal], [data-split]") ?? target;
              if (t.progress() === 0 && el && inViewport(el)) t.play();
            });
          }, 3500),
        );

        ScrollTrigger.refresh();

        if (import.meta.env.DEV) {
          // Verification hook for automated checks: finish every reveal.
          (window as unknown as { __motion?: unknown }).__motion = {
            gsap,
            ScrollTrigger,
            finish() {
              intro.progress(1);
              revealTweens.forEach((t) => t.progress(1));
            },
          };
        }
      });
    });

    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh);

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("load", refresh);
      splitInstances.forEach((s) => s.revert());
      ctx.revert();
      scope.classList.remove("motion");
    };
  }, [root]);
}
