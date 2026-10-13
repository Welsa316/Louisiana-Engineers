import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { ArrowUpRight } from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { Mark } from "./Mark";
import { org } from "../content/site";
import { createHeroMotion, type HeroMotion } from "./hero/motion";

const Sculpture = lazy(() => import("./hero/Sculpture"));

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const motion = useRef<HeroMotion>(createHeroMotion(reducedMotion()));
  const introRef = useRef<gsap.core.Timeline | null>(null);
  const [showScene, setShowScene] = useState(false);

  // Let the typography paint first; the scene module loads a beat later.
  useEffect(() => {
    const id = window.setTimeout(() => setShowScene(true), 120);
    if (import.meta.env.DEV) {
      // Verification hook: jump every hero animation to its end state.
      (window as unknown as { __hero?: unknown }).__hero = {
        state: motion.current,
        finish() {
          gsap.killTweensOf(motion.current);
          motion.current.progress = 1;
          motion.current.camera = 1;
          introRef.current?.progress(1);
        },
      };
    }
    return () => window.clearTimeout(id);
  }, []);

  useLayoutEffect(() => {
    const scope = root.current;
    if (!scope) return;
    gsap.registerPlugin(ScrollTrigger, SplitText);

    const title = scope.querySelector<HTMLElement>("[data-hero-title]");
    const stage = scope.querySelector<HTMLElement>("[data-hero-stage]");
    const scene = scope.querySelector<HTMLElement>("[data-hero-scene]");
    const blocks = scope.querySelectorAll<HTMLElement>("[data-hero-block]");
    const ctx = gsap.context(() => {}, scope);
    const m = motion.current;

    if (!m.reduced) {
      gsap.set(blocks, { autoAlpha: 0, y: 22 });
      if (title) gsap.set(title, { autoAlpha: 0 });

      let split: SplitText | undefined;
      ctx.add(() => {
        const intro = gsap.timeline({ defaults: { ease: "expo.out" } });
        introRef.current = intro;
        intro.to(m, { camera: 1, duration: 4.2, ease: "power2.out" }, 0);
        if (title) {
          split = SplitText.create(title, { type: "chars", mask: "chars" });
          gsap.set(title, { autoAlpha: 1 });
          intro.fromTo(
            split.chars,
            { yPercent: 112 },
            { yPercent: 0, duration: 1.5, stagger: 0.085 },
            0.1,
          );
        }
        intro.to(blocks, { autoAlpha: 1, y: 0, duration: 1.1, stagger: 0.18 }, 1.7);

        // Cinematic exit: the stage recedes as the next section arrives.
        gsap
          .timeline({
            scrollTrigger: { trigger: scope, start: "top top", end: "bottom top", scrub: true },
          })
          .to(title, { yPercent: -28, autoAlpha: 0.15, ease: "none" }, 0)
          .to(scene, { yPercent: -12, scale: 0.92, ease: "none" }, 0)
          .to(blocks, { y: -36, autoAlpha: 0, ease: "none" }, 0);
      });

      return () => {
        split?.revert();
        ctx.revert();
      };
    }

    void stage;
    return () => ctx.revert();
  }, []);

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    motion.current.pointerX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    motion.current.pointerY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
  };
  const onPointerLeave = () => {
    motion.current.pointerX = 0;
    motion.current.pointerY = 0;
  };

  return (
    <section
      className="hero"
      id="hero"
      ref={root}
      aria-labelledby="hero-title"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className="hero-stage" data-hero-stage aria-hidden="true">
        <p className="hero-mark" data-hero-title>
          {org.short}
        </p>
        <div className="hero-scene" data-hero-scene>
          {showScene && (
            <Suspense fallback={null}>
              <Sculpture motion={motion} />
            </Suspense>
          )}
        </div>
      </div>

      <div className="shell hero-foot">
        <div className="hero-intro" data-hero-block>
          <h1 className="t-label hero-eyebrow" id="hero-title">
            {org.name}
          </h1>
          <p className="t-display-sm hero-line">
            Connecting minds.
            <br />
            Engineering tomorrow.
          </p>
        </div>

        <div className="hero-aside" data-hero-block>
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
