/**
 * The settings area: one place for every member (03 sections 2.1 and 12).
 * On a wide screen the sections sit beside the open one and `/settings`
 * opens on the profile. On a phone `/settings` is the list of sections and
 * each section is its own screen with a way back to the list; settings.css
 * switches between the two, so nothing depends on script reading the width.
 */

import { ArrowLeft } from "lucide-react";
import { Outlet, useMatch } from "react-router";
import { useSession } from "../../lib/session";
import { SettingsNav, type SettingsSection } from "../../ui/settings-controls";
import { PageHead, UiLink } from "../../ui/ui";

export function settingsSections(kind: "student" | "professional" | null | undefined): SettingsSection[] {
  const professional = kind === "professional";
  return [
    {
      to: "/settings/profile",
      label: "Profile",
      note: professional ? "Your public profile and how you take part" : "What a mentor sees when you send a request",
    },
    {
      to: "/settings/privacy",
      label: "Privacy and contact",
      note: professional ? "Who can find you and which contact details members see" : "Who can see your profile",
    },
    ...(professional
      ? [
          { to: "/settings/mentorship", label: "Mentorship", note: "Taking requests, pausing, topics and capacity" },
        ]
      : []),
    { to: "/settings/notifications", label: "Notifications", note: "Which emails we send you" },
    ...(professional ? [{ to: "/settings/preview", label: "Preview", note: "Your profile as a visitor and a member see it" }] : []),
    { to: "/settings/account", label: "Account", note: "Export your data or delete your account" },
  ];
}

export function SettingsLayout() {
  const { user } = useSession();
  const index = useMatch({ path: "/settings", end: true }) !== null;
  return (
    <div className="pn-settings" data-index={index || undefined}>
      <div className="pn-settings-index-head">
        <PageHead
          kicker="Settings"
          title="Profile and settings"
          lead="Your profile, who sees it, how people reach you and what we email you."
        />
      </div>
      <SettingsNav sections={settingsSections(user?.kind)} />
      <div className="pn-settings-body">
        <UiLink to="/settings" className="pn-settings-back link link-quiet t-small">
          <ArrowLeft size={14} aria-hidden="true" />
          All settings
        </UiLink>
        <Outlet />
      </div>
    </div>
  );
}
