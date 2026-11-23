/**
 * Layout for the long-form policy pages (guidelines, privacy): the "Draft for
 * board review" tag, a contents list beside the text on wide screens, and
 * numbered sections. On a phone the contents list sits above the text.
 */

import type { ReactNode } from "react";
import { Notice, PageHead } from "../../ui/ui";

export interface DraftSection {
  id: string;
  title: string;
  body: ReactNode;
}

export function DraftDocument({
  kicker,
  title,
  lead,
  sections,
}: {
  kicker: string;
  title: string;
  lead: ReactNode;
  sections: DraftSection[];
}) {
  return (
    <div className="shell section">
      <PageHead kicker={kicker} title={title} lead={lead} />
      <div className="mt-8 max-w-2xl">
        <Notice tone="warn">
          <strong>Draft for board review.</strong> The MEST board has not approved this wording yet. It describes how
          the network works today and may change before launch.
        </Notice>
      </div>

      <div className="grid-12 mt-12 gap-y-10">
        <nav aria-label="On this page" className="col-span-12 md:col-span-3">
          <div className="md:sticky md:top-24">
            <p className="t-label text-fg-2">On this page</p>
            <ol className="mt-4 grid gap-2 t-small">
              {sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="link link-quiet">
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <div className="col-span-12 md:col-start-5 md:col-span-8 pn-ledger">
          {sections.map((section, index) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="py-8 scroll-mt-24">
              <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4">
                <span className="t-numeral text-accent text-sm pt-1.5" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2 id={`${section.id}-title`} className="t-heading">
                    {section.title}
                  </h2>
                  <div className="mt-4 grid gap-4 t-body text-fg-2 max-w-[64ch]">{section.body}</div>
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A plain bulleted list for policy text. */
export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="grid gap-2 list-disc pl-5 marker:text-[var(--color-accent)]">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
