import { useId, useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { events } from "../content/site";

export function Events() {
  const [open, setOpen] = useState<number | null>(null);
  const baseId = useId();
  const hasSamples = events.some((e) => e.placeholder);

  return (
    <section className="section" id="events" aria-labelledby="events-title">
      <div className="shell">
        <div className="section-head" data-reveal>
          <span className="num">04</span>
          <h2 className="t-label" id="events-title">
            Events &amp; opportunities
          </h2>
        </div>

        <div className="grid-12 mt-14 md:mt-20 gap-y-8">
          <p className="t-display-md col-span-12 md:col-span-7" data-split>
            Talks, workshops, and gatherings across the state.
          </p>
          <div
            className="col-span-12 md:col-start-9 md:col-span-4 md:pt-3"
            data-reveal
          >
            <p className="t-body text-muted measure-wide">
              Programming is organized around the academic year and the
              state's industry calendar. Members hear first.
            </p>
            {hasSamples && (
              <p className="t-small mt-5 text-bronze-ink">
                Sample listings. Confirmed dates and registration will be
                published here.
              </p>
            )}
          </div>
        </div>

        <ul className="event-list mt-14 md:mt-20" data-stagger>
          {events.map((event, i) => {
            const isOpen = open === i;
            const panelId = `${baseId}-panel-${i}`;
            const buttonId = `${baseId}-button-${i}`;
            return (
              <li className="event" key={event.title + event.date} data-reveal>
                <button
                  id={buttonId}
                  className="event-row"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <time className="event-date" dateTime={event.date}>
                    <span className="event-day">{event.day}</span>
                    <span className="event-month">{event.month}</span>
                  </time>
                  <span className="min-w-0">
                    <span className="event-title">
                      <span className="t-heading">{event.title}</span>
                      {event.placeholder && <span className="tag">Sample</span>}
                    </span>
                    <span className="t-small event-format block">
                      {event.format}
                      <span className="md:hidden"> · {event.location}</span>
                    </span>
                  </span>
                  <span className="t-small event-location">
                    {event.location}
                  </span>
                  <span className="event-icon" aria-hidden="true">
                    <Plus size={18} />
                  </span>
                </button>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className="event-panel"
                  data-open={isOpen}
                  hidden={!isOpen}
                >
                  <div>
                    <div className="event-panel-inner">
                      <span aria-hidden="true" />
                      <div>
                        <p className="t-body measure-wide text-ink-soft">
                          {event.description}
                        </p>
                        <p className="t-small text-muted mt-4">
                          Registration opens once the date is confirmed.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-10 md:mt-12 flex flex-wrap items-center justify-between gap-6" data-reveal>
          <p className="t-small text-muted">
            Want to host, speak, or sponsor a session?
          </p>
          <a className="link" href="#join">
            Get in touch
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
