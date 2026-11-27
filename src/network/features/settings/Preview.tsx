/**
 * Settings, Preview (PRO-13; 03 section 2.1 "Preview as visitor" and
 * "Preview as member"): the owner's profile exactly as a visitor who is not
 * signed in, or a signed-in member, would get it, from
 * `GET /api/me/preview?as=visitor|member`. A visitor never gets contact
 * details; a member gets only the methods shared with members. When the
 * answer is that the viewer cannot see the profile, the screen says why.
 */

import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import type { OwnProfile, PreviewResponse } from "@shared/types/me";
import { useMeta } from "../../lib/meta";
import { useSession } from "../../lib/session";
import { Empty, Notice, PageHead, Segmented, UiLink } from "../../ui/ui";
import { previewRequestSlot } from "../me/RequestActions";
import { ProfileContent } from "../public/Profile";
import { settingsErrorText, useOwnProfile, usePreview } from "./api";

type Viewer = PreviewResponse["as"];

export function Preview() {
  useMeta({ title: "Preview your profile" });
  const [as, setAs] = useState<Viewer>("visitor");
  const { user } = useSession();
  const own = useOwnProfile();
  const preview = usePreview(as);
  const student = own.data?.kind === "student";

  return (
    <>
      <PageHead
        kicker="Preview"
        title="See your profile as others do."
        lead="Switch between a visitor who is not signed in and a signed-in member. This reads what is saved now."
      />
      {student ? (
        <div className="mt-8 max-w-2xl">
          <Notice tone="info" icon={<Lock size={16} aria-hidden="true" />}>
            Students are never listed, so visitors and members cannot open your profile. A mentor sees it only when you send
            them a request.
          </Notice>
        </div>
      ) : (
        <>
          <div className="mt-8">
            <Segmented<Viewer>
              label="Preview as"
              value={as}
              onChange={setAs}
              options={[
                { id: "visitor", label: "Visitor" },
                { id: "member", label: "Member" },
              ]}
            />
          </div>
          <section className="pn-settings-preview mt-6" aria-label="Profile preview" aria-busy={preview.isFetching || undefined}>
            {preview.isError ? (
              <div role="alert">
                <Notice tone="warn">{settingsErrorText(preview.error)}</Notice>
              </div>
            ) : !preview.data || !own.data ? (
              <p className="t-small text-fg-2">Loading the preview</p>
            ) : preview.data.access === "visible" && preview.data.profile ? (
              <div className="pn-settings-preview-page">
                <ProfileContent
                  profile={preview.data.profile}
                  viewer={as === "visitor" ? null : user}
                  slot={previewRequestSlot}
                  preview={{ as, contact: preview.data.contact ?? [] }}
                />
              </div>
            ) : preview.data.access === "members_only" ? (
              <Empty title="Members only.">
                {own.data.firstName ?? "This member"} chose to share this profile with signed-in members only. A visitor sees
                this and a prompt to sign in.
              </Empty>
            ) : (
              <Empty title="This profile is not available.">{unavailableReason(own.data, as)}</Empty>
            )}
          </section>
        </>
      )}
    </>
  );
}

/** Why a viewer gets nothing, from the owner's own state. */
function unavailableReason(p: OwnProfile, as: Viewer): ReactNode {
  const who = as === "visitor" ? "Visitors" : "Members";
  if (p.adminHidden) return `${who} cannot see it: an administrator has hidden your profile.`;
  if (p.approvalState === "pending") return `${who} cannot see it yet: it is waiting for an administrator's review.`;
  if (p.approvalState === "declined") return `${who} cannot see it: an administrator asked for changes before it is listed.`;
  if (p.visibility === "hidden") {
    return (
      <>
        {who} cannot see it: you chose Hidden under{" "}
        <UiLink to="/settings/privacy" className="link">
          Privacy and contact
        </UiLink>
        .
      </>
    );
  }
  if (!p.professional?.participation.includes("directory")) {
    return (
      <>
        {who} cannot see it: Professional directory is off under{" "}
        <UiLink to="/settings/profile" className="link">
          Profile, How you take part
        </UiLink>
        .
      </>
    );
  }
  return `${who} cannot see it right now.`;
}
