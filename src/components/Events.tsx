import { useId, useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { eventFormats, events } from "../content/site";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today as YYYY-MM-DD in the visitor's local time. */
function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Day and month from an ISO date, without timezone shifts. */
function dayAndMonth(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return { day: String(d).padStart(2, "0"), month: MONTHS[(m || 1) - 1] };
}

/** 02 Events: confirmed gatherings, or the plan's empty state. */
export function Events() {
  const [open, setOpen] = useState<number | null>(null);
  const baseId = useId();
  // Upcoming only, soonest first. An event stays listed through its own day.
  const today = todayISO();
  const upcoming = events
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section className="section band-panel" id="events" aria-labelledby="events-title">
      <div className="shell">
        <div className="section-head" data-reveal>
          <span className="num">02</span>
          <h2 className="t-label" id="events-title">
            Events
          </h2>
        </div>

        <div className="grid-12 mt-14 md:mt-20 gap-y-10">
          <p className="t-display-md col-span-12 md:col-span-8" data-split>
            Connect beyond the screen through conversations, technical
            learning, professional networking, and community gatherings.
          </p>
          <div className="col-span-12 md:col-start-10 md:col-span-3 md:pt-3" data-reveal>
            <h3 className="t-label text-accent">Formats</h3>
            <ul className="audience-list mt-5">
              {eventFormats.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>

        {upcoming.length === 0 ? (
          <div className="events-empty mt-14 md:mt-20" data-reveal>
            <p className="t-heading">Upcoming events will appear here.</p>
            <a className="link" href="#get-involved">
              Get involved
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        ) : (
          <ul className="event-list mt-14 md:mt-20" data-stagger>
            {upcoming.map((event, i) => {
              const isOpen = open === i;
              const panelId = `${baseId}-panel-${i}`;
              const buttonId = `${baseId}-button-${i}`;
              const { day, month } = dayAndMonth(event.date);
              return (
                <li className="event" key={event.title + event.date} data-reveal>
                  <div className="event-head">
                    <button
                      id={buttonId}
                      className="event-row"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpen(isOpen ? null : i)}
                    >
                      <time className="event-date" dateTime={event.date}>
                        <span className="event-day">{day}</span>
                        <span className="event-month">{month}</span>
                      </time>
                      <span className="min-w-0">
                        <span className="event-title">
                          <span className="t-heading">{event.title}</span>
                        </span>
                        <span className="t-small event-format block">
                          {event.format}
                          {event.time && ` · ${event.time}`}
                          <span className="md:hidden"> · {event.location}</span>
                        </span>
                      </span>
                      <span className="t-small event-location">{event.location}</span>
                      <span className="event-icon" aria-hidden="true">
                        <Plus size={18} />
                      </span>
                    </button>
                    {event.registrationUrl ? (
                      <a
                        className="link event-register"
                        href={event.registrationUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Register
                        <ArrowUpRight size={15} aria-hidden="true" />
                      </a>
                    ) : (
                      // Keeps the toggles aligned with rows that have a link.
                      <span aria-hidden="true" />
                    )}
                  </div>
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
                          <p className="t-body measure-wide text-fg">{event.description}</p>
                          {!event.registrationUrl && (
                            <p className="t-small text-fg-2 mt-4">Registration is not open yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
