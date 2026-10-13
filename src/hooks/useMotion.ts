import { useLayoutEffect, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

const REVEAL_START = "top 88%";

function fontsReady(timeoutMs = 1200): Promise<void> {
  if (!("fonts" in document)) return Promise.resolve();
  return Promise.race([
    document.fonts.ready.then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

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
    const heroImage = q<HTMLElement>("[data-hero-image]");
    const heroTitle = q<HTMLElement>("[data-hero-title]")[0];
    const heroBits = q<HTMLElement>("[data-hero]");
    const headerBits = q<HTMLElement>("[data-header] .header-inner > *");
    const splits = q<HTMLElement>("[data-split]");
    const marks = q<SVGElement>(".mark-draw");

    // Start states, before first paint.
    gsap.set(reveals, { autoAlpha: 0, y: 28 });
    gsap.set(heroImage, { scale: 1.08 });
    gsap.set(heroBits, { autoAlpha: 0, y: 18 });
    gsap.set(headerBits, { autoAlpha: 0, y: -8 });
    gsap.set([heroTitle, ...splits].filter(Boolean), { autoAlpha: 0 });
    marks.forEach((m) => gsap.set(m.querySelectorAll("[pathLength]"), { strokeDashoffset: 1 }));

    const ctx = gsap.context(() => {}, scope);
    const splitInstances: SplitText[] = [];
    const revealTweens: gsap.core.Tween[] = [];
    const timers: number[] = [];
    let cancelled = false;

    fontsReady().then(() => {
      if (cancelled) return;
      ctx.add(() => {
        // Hero entrance -------------------------------------------------
        const intro = gsap.timeline({ defaults: { ease: "expo.out" } });
        intro
          .to(heroImage, { scale: 1, duration: 2.8, ease: "power2.out" }, 0)
          .to(headerBits, { autoAlpha: 1, y: 0, duration: 1, stagger: 0.06 }, 0.3)
          .to(heroBits[0], { autoAlpha: 1, y: 0, duration: 0.9 }, 0.4);

        if (heroTitle) {
          let introPlayed = false;
          splitInstances.push(
            SplitText.create(heroTitle, {
              type: "lines",
              mask: "lines",
              autoSplit: true,
              onSplit(self) {
                gsap.set(heroTitle, { autoAlpha: 1 });
                if (introPlayed) return undefined;
                const tween = gsap.fromTo(
                  self.lines,
                  { yPercent: 108 },
                  {
                    yPercent: 0,
                    duration: 1.3,
                    ease: "expo.out",
                    stagger: 0.1,
                    onComplete: () => {
                      introPlayed = true;
                    },
                  },
                );
                intro.add(tween, 0.55);
                return tween;
              },
            }),
          );
        }

        intro
          .to(heroBits[1], { autoAlpha: 1, y: 0, duration: 1 }, 1.05)
          .to(heroBits[2], { autoAlpha: 1, y: 0, duration: 1 }, 1.2)
          .to(heroBits[3], { autoAlpha: 1, y: 0, duration: 1 }, 1.4);

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

        // Line drawing for the geometric mark ------------------------------
        marks.forEach((m) => {
          gsap.to(m.querySelectorAll("[pathLength]"), {
            strokeDashoffset: 0,
            duration: 1.8,
            ease: "power2.inOut",
            stagger: 0.15,
            scrollTrigger: { trigger: m, start: "top 90%", once: true },
          });
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
