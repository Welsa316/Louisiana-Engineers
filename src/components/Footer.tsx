import { useRef } from "react";
import { ArrowUp, ArrowUpRight, X } from "lucide-react";
import { Logo } from "./Logo";
import { contact, navigation, org, photoCredits, socials } from "../content/site";

export function Footer() {
  const credits = useRef<HTMLDialogElement>(null);
  const year = new Date().getFullYear();

  return (
    <footer className="footer" id="contact">
      <div className="shell pt-20 pb-8 md:pt-28 md:pb-10">
        <div className="footer-cols">
          <div className="col-span-12 lg:col-span-5">
            <Logo className="footer-logo" title="MEST, Muslim Engineers in Science & Tech" />
            <p className="t-lead measure mt-10 text-fg-2">
              Built by engineers, for the engineers who come next.
            </p>
          </div>

          <nav className="footer-col col-span-6 md:col-span-4 lg:col-span-2 lg:col-start-7" aria-labelledby="footer-explore">
            <h2 className="t-label" id="footer-explore">
              Explore
            </h2>
            <ul>
              {navigation.map((item) => (
                <li key={item.href}>
                  <a className="link-quiet link" href={item.href}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="footer-col col-span-6 md:col-span-4 lg:col-span-2">
            <h2 className="t-label">Contact</h2>
            <ul>
              <li>
                {contact.email ? (
                  <a className="link-quiet link" href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>
                ) : (
                  <span className="tba">Email to be announced</span>
                )}
              </li>
              <li>
                <span>{contact.city}</span>
              </li>
            </ul>
          </div>

          <div className="footer-col col-span-12 md:col-span-4 lg:col-span-2">
            <h2 className="t-label">Follow</h2>
            <ul>
              {socials.map((s) =>
                s.href ? (
                  <li key={s.label}>
                    <a
                      className="link-quiet link"
                      href={s.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.label}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  </li>
                ) : (
                  <li key={s.label}>
                    <span className="tba">{s.label}</span>
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>

        <div className="footer-bottom mt-20 md:mt-28">
          <p>
            © {year} {org.name}
          </p>
          <div className="flex items-center gap-8">
            <button className="link link-quiet" onClick={() => credits.current?.showModal()}>
              Photography
            </button>
            <a className="link link-quiet" href="#top">
              Back to top
              <ArrowUp size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>

      <dialog
        ref={credits}
        className="credits"
        aria-labelledby="credits-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) credits.current?.close();
        }}
      >
        <div className="credits-inner">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="t-label text-accent">Photography</p>
              <h2 className="t-display-sm mt-3" id="credits-title">
                Image credits
              </h2>
            </div>
            <button
              className="menu-toggle"
              style={{ display: "inline-flex" }}
              aria-label="Close"
              onClick={() => credits.current?.close()}
              autoFocus
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <p className="t-small text-fg-2 mt-4 measure-wide">
            Photographs are illustrative and licensed from Unsplash. They do not
            depict MEST members or events.
          </p>
          <ul className="mt-6 t-small">
            {photoCredits.map((c) => (
              <li key={c.href}>
                <span>{c.subject}</span>
                <a className="link link-quiet" href={c.href} target="_blank" rel="noreferrer">
                  {c.author}
                  <ArrowUpRight size={13} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </footer>
  );
}
