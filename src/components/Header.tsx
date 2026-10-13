import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { Wordmark } from "./Mark";
import { navigation } from "../content/site";

export function Header() {
  const [solid, setSolid] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const menu = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // Solid once the hero has scrolled past the header line.
  useEffect(() => {
    const hero = document.getElementById("hero");
    if (!hero) return;
    const headerHeight = () =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) * 16 || 80;
    const observer = new IntersectionObserver(
      ([entry]) => setSolid(!entry.isIntersecting),
      { rootMargin: `-${headerHeight()}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  // Hide while scrolling down, return while scrolling up.
  useEffect(() => {
    let last = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - last;
        if (y < 120) setHidden(false);
        else if (delta > 6) setHidden(true);
        else if (delta < -6) setHidden(false);
        last = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Track the section in view for aria-current.
  useEffect(() => {
    const sections = navigation
      .map((item) => document.querySelector<HTMLElement>(item.href))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setCurrent(`#${visible.target.id}`);
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.2, 0.5] },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const openMenu = () => menu.current?.showModal();
  const closeMenu = () => menu.current?.close();

  return (
    <>
      <header
        className={`header ${solid ? "is-solid" : ""} ${hidden ? "is-hidden" : ""}`}
        data-header
      >
        <div className="shell header-inner">
          <Wordmark />
          <nav aria-label="Primary" className="nav-links">
            {navigation.map((item) => (
              <a
                key={item.href}
                className="nav-link"
                href={item.href}
                aria-current={current === item.href ? "true" : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a className="btn btn-outline" href="#join">
              Join the Society
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
            <button
              ref={toggle}
              className="menu-toggle"
              aria-label="Open menu"
              aria-haspopup="dialog"
              onClick={openMenu}
            >
              <Menu size={22} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <dialog
        ref={menu}
        className="menu"
        aria-labelledby="menu-title"
        onClose={() => toggle.current?.focus()}
      >
        <div className="menu-inner">
          <div className="menu-top">
            <span id="menu-title" className="t-label">
              Menu
            </span>
            <button
              className="menu-toggle"
              aria-label="Close menu"
              onClick={closeMenu}
              autoFocus
            >
              <X size={22} aria-hidden="true" />
            </button>
          </div>
          <nav aria-label="Primary, mobile">
            <ul className="menu-list">
              {navigation.map((item, i) => (
                <li key={item.href}>
                  <a href={item.href} onClick={closeMenu}>
                    <span className="num">0{i + 1}</span>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="menu-foot">
            <a className="btn btn-light" href="#join" onClick={closeMenu}>
              Join the Society
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
            <p className="t-small" style={{ opacity: 0.6 }}>
              Muslim Engineering Society of Louisiana
            </p>
          </div>
        </div>
      </dialog>
    </>
  );
}
