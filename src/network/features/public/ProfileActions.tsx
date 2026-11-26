/**
 * The action column on a profile, decided by the viewer and the
 * professional's settings (03 section 6.2). Requests arrive with the
 * mentorship phase: until then a member sees the request buttons as
 * "Available soon". Task 22 passes `slot` to put the real request buttons
 * in their place, and Task 24 passes `reportSlot` for the report control;
 * neither needs to edit this file.
 */

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ArrowUpRight, Bookmark, BookmarkCheck, PencilLine } from "lucide-react";
import type { SessionUser } from "@shared/types/auth";
import type { ProfileView } from "@shared/types/directory";
import { useSaveProfile } from "./directory-api";

/** Content for a slot, given the profile on screen. */
export type ProfileSlot = ReactNode | ((profile: ProfileView) => ReactNode);

const fill = (slot: ProfileSlot, profile: ProfileView): ReactNode =>
  typeof slot === "function" ? slot(profile) : slot;

/** Mentorship on with a free place. */
export function isTakingRequests(profile: ProfileView): boolean {
  return profile.mentorship?.status === "active" && profile.mentorship.hasCapacity;
}

/** Mentorship on (active or paused), whether or not it is full. */
export function offersMentorship(profile: ProfileView): boolean {
  return profile.mentorship?.status === "active" || profile.mentorship?.status === "paused";
}

function Soon({ children }: { children: ReactNode }) {
  return (
    <div className="pn-action-soon">
      <span>{children}</span>
      <span className="pn-tag pn-tag-quiet">Available soon</span>
    </div>
  );
}

function SaveButton({ profile }: { profile: ProfileView }) {
  const save = useSaveProfile(profile.id);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        aria-pressed={profile.saved}
        disabled={save.isPending}
        onClick={() => save.mutate(!profile.saved)}
      >
        {profile.saved ? <BookmarkCheck size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
        {profile.saved ? "Saved" : "Save profile"}
      </button>
      {save.isError ? (
        <p className="t-small text-fg-2" role="alert">
          That did not save. Try again.
        </p>
      ) : null}
    </>
  );
}

export function ProfileActions({
  profile,
  viewer,
  slot,
  reportSlot,
}: {
  profile: ProfileView;
  /** The signed-in account, or null for a visitor. */
  viewer: SessionUser | null;
  /** Replaces the "Available soon" request buttons for members (Task 22). */
  slot?: ProfileSlot;
  /** The report control for members (Task 24). */
  reportSlot?: ProfileSlot;
}) {
  const location = useLocation();
  const from = { from: `${location.pathname}${location.search}` };
  const taking = isTakingRequests(profile);
  const mentor = offersMentorship(profile);
  const networking = profile.participation.includes("networking");
  const pausedOrFull = mentor && !taking;

  if (profile.isOwner) {
    return (
      <div className="pn-profile-actions">
        <Link to="/settings" className="btn btn-outline">
          <PencilLine size={16} aria-hidden="true" />
          Edit your profile
        </Link>
      </div>
    );
  }

  // Signed in but not onboarded: the same offers, pointing at onboarding.
  if (viewer && viewer.kind === null) {
    return (
      <div className="pn-profile-actions">
        {(taking || networking) && (
          <Link to="/onboarding" className="btn btn-solid">
            Finish joining to send requests
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        )}
      </div>
    );
  }

  if (!viewer) {
    return (
      <div className="pn-profile-actions">
        {taking && (
          <Link to="/signin" state={from} className="btn btn-solid">
            Sign in to request mentorship
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        )}
        {pausedOrFull && (
          <button type="button" className="btn btn-outline" disabled>
            Not taking new requests right now
          </button>
        )}
        {networking && !taking && (
          <Link to="/signin" state={from} className={pausedOrFull ? "btn btn-ghost" : "btn btn-solid"}>
            Sign in to request an introduction
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="pn-profile-actions">
      {slot !== undefined ? (
        fill(slot, profile)
      ) : (
        <>
          {taking && <Soon>Request mentorship</Soon>}
          {pausedOrFull && (
            <button type="button" className="btn btn-outline" disabled>
              Not taking new requests right now
            </button>
          )}
          {networking && !taking && <Soon>Request an introduction</Soon>}
        </>
      )}
      <SaveButton profile={profile} />
      {reportSlot !== undefined ? fill(reportSlot, profile) : null}
    </div>
  );
}
