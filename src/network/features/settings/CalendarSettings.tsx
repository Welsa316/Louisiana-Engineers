/**
 * Settings, Calendar (Task 37): a private iCalendar address for the meetings
 * a member schedules here. Only the address's hash is stored, so the
 * address is shown once, right after it is made; a member who needs it
 * again makes a new one, which stops the old one working. Turning the feed
 * off stops it too.
 */

import { useEffect, useId, useState } from "react";
import { CalendarPlus, Check, Copy } from "lucide-react";
import type { CreatedCalendarFeedResponse } from "@shared/types/calendar";
import { useMeta } from "../../lib/meta";
import { Card, Field, Input, Notice, PageHead, Toast, fmtDate } from "../../ui/ui";
import "../../ui/calendar.css";
import { calendarErrorText, useCalendarFeed, useCreateCalendarFeed, useTurnOffCalendarFeed } from "./calendar-api";

type Confirming = "renew" | "off" | null;

export function CalendarSettings() {
  useMeta({ title: "Calendar settings" });
  const feed = useCalendarFeed();
  const create = useCreateCalendarFeed();
  const turnOff = useTurnOffCalendarFeed();
  // The address lives only in this screen's state: it is shown once.
  const [fresh, setFresh] = useState<CreatedCalendarFeedResponse | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const busy = create.isPending || turnOff.isPending;
  const current = feed.data?.feed ?? null;

  const make = (renewing: boolean) => {
    setFlash(null);
    setFailed(null);
    create.mutate(undefined, {
      onSuccess: (data) => {
        setFresh(data);
        setConfirming(null);
        setFlash(renewing ? "New address made. The old one no longer works." : "Calendar feed on.");
      },
      onError: (error) => setFailed(calendarErrorText(error)),
    });
  };

  const stop = () => {
    setFlash(null);
    setFailed(null);
    turnOff.mutate(undefined, {
      onSuccess: () => {
        setFresh(null);
        setConfirming(null);
        setFlash("Calendar feed off. The address no longer works.");
      },
      onError: (error) => setFailed(calendarErrorText(error)),
    });
  };

  return (
    <>
      <PageHead
        kicker="Calendar"
        title="Your meetings in your calendar."
        lead="A private address your calendar app checks for the meetings you schedule on MEST Network. It keeps itself up to date."
      />
      {feed.error ? (
        <div role="alert" className="mt-8">
          <Notice tone="warn">{calendarErrorText(feed.error)}</Notice>
        </div>
      ) : !feed.data ? (
        <p className="mt-8 t-small text-fg-2">Loading your calendar settings</p>
      ) : (
        <div className="pn-split mt-8">
          <div className="grid grid-cols-1 gap-6 min-w-0">
            {flash ? <Toast text={flash} /> : null}
            {failed ? (
              <div role="alert">
                <Notice tone="warn">{failed}</Notice>
              </div>
            ) : null}
            <Card title="Calendar feed">
              {fresh && current ? (
                <FreshAddress feed={fresh} />
              ) : current ? (
                <p className="t-small text-fg-2">
                  On since {fmtDate(current.createdAt, true)}. To keep it private, the address is shown only when it is
                  made. If you need it again, make a new one; the old address then stops working.
                </p>
              ) : (
                <p className="t-small text-fg-2">
                  Off. Turn it on to get a private address you can add to Google Calendar, Apple Calendar, Outlook or any
                  app that subscribes to a calendar by its address.
                </p>
              )}

              {confirming ? (
                <div className="pn-calendar-confirm mt-5" role="group" aria-label="Confirm">
                  <p className="t-small">
                    {confirming === "renew"
                      ? "Your calendar app stops getting updates until you add the new address. Make a new one?"
                      : "Your calendar app stops getting updates and the address stops working. Turn the feed off?"}
                  </p>
                  <div className="pn-calendar-actions">
                    {confirming === "renew" ? (
                      // The button that opened this step is gone, so focus moves to its answer.
                      <button type="button" className="btn btn-solid btn-sm" disabled={busy} autoFocus onClick={() => make(true)}>
                        Make a new address
                      </button>
                    ) : (
                      <button type="button" className="btn btn-danger btn-sm" disabled={busy} autoFocus onClick={stop}>
                        Turn the feed off
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirming(null)}>
                      Keep it as it is
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pn-calendar-actions mt-5">
                  {current ? (
                    <>
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setConfirming("renew")}>
                        Make a new address
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirming("off")}>
                        Turn the feed off
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-solid btn-sm" disabled={busy} onClick={() => make(false)}>
                      <CalendarPlus size={16} aria-hidden="true" />
                      Turn on the feed
                    </button>
                  )}
                </div>
              )}
              <p className="sr-only" role="status" aria-live="polite">
                {create.isPending ? "Making your feed address" : turnOff.isPending ? "Turning the feed off" : ""}
              </p>
            </Card>
          </div>
          <aside className="grid grid-cols-1 gap-6 min-w-0" aria-label="About the calendar feed">
            <Card title="What the feed shows" lift>
              <ul className="grid gap-3 t-small text-fg-2">
                <li>Meetings you scheduled here: everything ahead, and the last 30 days.</li>
                <li>The time and length, whether it is online or in person, and the other person&rsquo;s first name.</li>
                <li>
                  Never the place, what you plan to talk about or anyone&rsquo;s contact details. Each event links to the
                  request, where those stay behind your sign-in.
                </li>
                <li>A canceled meeting shows as canceled.</li>
              </ul>
            </Card>
            <Card title="Adding it to your calendar">
              <ul className="grid gap-3 t-small text-fg-2">
                <li>Google Calendar: Other calendars, then From URL.</li>
                <li>Apple Calendar: File, then New Calendar Subscription.</li>
                <li>Outlook: Add calendar, then Subscribe from web.</li>
                <li>Calendar apps check for changes on their own schedule, from every hour to once a day.</li>
              </ul>
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}

function FreshAddress({ feed }: { feed: CreatedCalendarFeedResponse }) {
  const hintId = useId();
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  useEffect(() => {
    if (copied !== "yes") return;
    const timer = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  };

  return (
    <div className="grid gap-4">
      <Field
        label="Your feed address"
        hint={
          <span id={hintId}>
            Anyone with this address can see when your meetings are and the first names of the people you meet, so keep
            it to yourself. It is shown only now.
          </span>
        }
      >
        {(id) => (
          <Input
            id={id}
            type="text"
            readOnly
            value={feed.url}
            aria-describedby={hintId}
            className="field-input pn-calendar-url"
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
      </Field>
      <div className="pn-calendar-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={copy}>
          {copied === "yes" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {copied === "yes" ? "Copied" : "Copy address"}
        </button>
        <a className="btn btn-ghost btn-sm" href={feed.webcalUrl}>
          Open in your calendar app
        </a>
      </div>
      <p className="sr-only" aria-live="polite">
        {copied === "yes" ? "Address copied" : ""}
      </p>
      {copied === "no" ? (
        <p className="t-small text-fg-2" role="status">
          Your browser did not allow copying. Select the address above and copy it yourself.
        </p>
      ) : null}
    </div>
  );
}
