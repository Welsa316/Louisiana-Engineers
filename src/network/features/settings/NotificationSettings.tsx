/**
 * Settings, Notifications (03 section 10): which emails a member gets, one
 * switch per category. Each switch saves on its own with
 * `PATCH /api/me/settings`; in-app notifications are always kept, and
 * account emails (sign-in links, deletion) are always sent, so neither has a
 * switch. Which rows show depends on what the member can receive.
 */

import { useState } from "react";
import type { NotificationPreferences } from "@shared/types/profiles";
import { useMeta } from "../../lib/meta";
import { useSession } from "../../lib/session";
import { Card, Notice, PageHead, SwitchRow, Toast } from "../../ui/ui";
import { settingsErrorText, useOwnProfile, useOwnSettings, useSaveSettings } from "./api";

type Key = keyof NotificationPreferences;

interface Row {
  key: Key;
  title: string;
  note: string;
  /** Who can receive it. */
  for: "everyone" | "professional" | "admin";
}

const ROWS: Row[] = [
  {
    key: "requests",
    title: "New requests to you",
    note: "One email per request. It names the topic, never the message.",
    for: "professional",
  },
  {
    key: "reminders",
    title: "Reminders about requests waiting for you",
    note: "A reminder while a request waits for your answer. Off means it simply closes with no reply after 14 days.",
    for: "professional",
  },
  {
    key: "responses",
    title: "Answers to your requests",
    note: "When a request you sent is accepted or declined, closes with no reply, or a relationship is marked completed.",
    for: "everyone",
  },
  {
    key: "profile",
    title: "Your profile",
    note: "When an administrator approves your profile or asks for changes, and when a paused mentorship switches back on.",
    for: "professional",
  },
  {
    key: "reports",
    title: "Reports you filed",
    note: "When an administrator closes a report you sent. The email gives the status only.",
    for: "everyone",
  },
  {
    key: "adminDigest",
    title: "Administrator digest",
    note: "Profiles waiting for review and new reports: at once when the queue was empty, otherwise once a week.",
    for: "admin",
  },
  {
    key: "productUpdates",
    title: "News about MEST Network",
    note: "Occasional notes about new features and MEST events.",
    for: "everyone",
  },
];

export function NotificationSettings() {
  useMeta({ title: "Notification settings" });
  const { user } = useSession();
  const profile = useOwnProfile();
  const settings = useOwnSettings();
  const save = useSaveSettings();
  const [flash, setFlash] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const error = profile.error ?? settings.error;
  const prefs = settings.data?.notifications ?? null;

  const professional = profile.data?.kind === "professional";
  const rows = ROWS.filter(
    (r) => r.for === "everyone" || (r.for === "professional" && professional) || (r.for === "admin" && user?.isAdmin),
  );

  const change = (row: Row, value: boolean) => {
    setFlash(null);
    setFailed(null);
    save.mutate(
      { notifications: { [row.key]: value } },
      {
        onSuccess: () => setFlash(`${row.title}: email ${value ? "on" : "off"}.`),
        onError: (err) => setFailed(settingsErrorText(err)),
      },
    );
  };

  return (
    <>
      <PageHead
        kicker="Notifications"
        title="What we email you."
        lead="Everything also appears under Notifications in the app. These switches only decide what reaches your inbox."
      />
      {error ? (
        <div role="alert" className="mt-8">
          <Notice tone="warn">{settingsErrorText(error)}</Notice>
        </div>
      ) : !prefs || !profile.data ? (
        <p className="mt-8 t-small text-fg-2">Loading your settings</p>
      ) : (
        <div className="pn-split mt-8">
          <div className="grid grid-cols-1 gap-6 min-w-0">
            {flash ? <Toast text={flash} /> : null}
            {failed ? (
              <div role="alert">
                <Notice tone="warn">{failed}</Notice>
              </div>
            ) : null}
            <Card title="Email" flush className="px-5">
              {rows.map((r) => (
                <SwitchRow
                  key={r.key}
                  title={r.title}
                  note={r.note}
                  checked={save.isPending && save.variables?.notifications?.[r.key] !== undefined ? !prefs[r.key] : prefs[r.key]}
                  onChange={(v) => change(r, v)}
                />
              ))}
            </Card>
          </div>
          <aside className="grid grid-cols-1 gap-6 min-w-0" aria-label="Always sent">
            <Card title="Always sent" lift>
              <ul className="grid gap-3 t-small text-fg-2">
                <li>Sign-in links you ask for.</li>
                <li>Messages about your account, such as a scheduled deletion or an administrator's action on your profile.</li>
              </ul>
            </Card>
            <Card title="What an email never says">
              <p className="t-small text-fg-2">
                No email carries another member's message, goals, program or contact details. It names the event and links
                back here.
              </p>
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}
