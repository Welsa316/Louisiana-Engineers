/**
 * Saved profiles (`/network/me/saved`), ported from the prototype: the
 * profiles the caller bookmarked, newest first, from `GET /api/me/saved`.
 * Only profiles the caller can still find in the directory are listed.
 * Saves are private: the saved person is never told. The bookmark on each
 * card removes it from the list.
 */

import { Link, useSearchParams } from "react-router";
import type { DirectoryEntry } from "@shared/types/directory";
import { isApiError } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { ProfileCard, type CardStatus } from "../../ui/directory";
import { Empty, Notice, PageHead } from "../../ui/ui";
import "../../ui/directory-pages.css";
import { displayName, initialsOf } from "../public/Directory";
import { SAVED_PAGE_SIZE, useSavedProfiles, useUnsave } from "./requests-api";

/** The card's mentorship pill, as in the directory (03 section 11.2). */
function cardStatus(entry: DirectoryEntry): CardStatus | undefined {
  if (entry.mentorStatus === "active" && entry.hasCapacity) return { tone: "active", label: "Taking requests" };
  if (entry.mentorStatus === "active" || entry.mentorStatus === "paused") {
    return { tone: "off", label: "Not taking requests" };
  }
  return undefined;
}

export function Saved() {
  useMeta({ title: "Saved profiles" });
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const saved = useSavedProfiles(page);
  const unsave = useUnsave();
  const data = saved.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / SAVED_PAGE_SIZE)) : 1;

  const goTo = (next: number) => {
    const search = new URLSearchParams(params);
    if (next > 1) search.set("page", String(next));
    else search.delete("page");
    setParams(search);
  };

  return (
    <>
      <PageHead
        kicker="Saved"
        title="People you want to come back to."
        lead="Saved profiles are private to you. Nobody is told when you save them."
      />
      {saved.isError ? (
        <div className="mt-8">
          <Notice tone="warn">
            {isApiError(saved.error, "network")
              ? "Your saved profiles did not load. Check your connection and try again."
              : "Your saved profiles did not load. Try again in a moment."}
          </Notice>
        </div>
      ) : !data ? (
        <p className="t-small text-fg-2 mt-8" role="status">
          Loading your saved profiles
        </p>
      ) : data.items.length === 0 ? (
        <div className="mt-8">
          <Empty
            title="Nothing saved yet."
            action={
              <Link to="/directory" className="btn btn-outline btn-sm">
                Browse the directory
              </Link>
            }
          >
            Save profiles you want to come back to. Nobody is told when you save them.
          </Empty>
        </div>
      ) : (
        <>
          {unsave.isError ? (
            <div className="mt-6" role="alert">
              <Notice tone="warn">That did not come off your list. Try again.</Notice>
            </div>
          ) : null}
          <ul className="pn-cards pn-cards-list mt-8" aria-label="Saved profiles">
            {data.items.map((entry) => (
              <li key={entry.id}>
                <ProfileCard
                  p={{
                    id: entry.id,
                    name: displayName(entry),
                    initials: initialsOf(entry),
                    title: entry.title,
                    organization: entry.organization,
                    location: entry.location ?? "",
                    disciplineId: entry.disciplineId,
                    expertise: entry.tags,
                  }}
                  to={`/me/discover/${entry.id}`}
                  status={cardStatus(entry)}
                  save={{ saved: true, onToggle: () => unsave.mutate(entry.id) }}
                />
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav className="flex items-center justify-between gap-4 mt-6 t-small" aria-label="Saved pages">
              <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
                Previous
              </button>
              <span className="text-fg-2">
                Page {Math.min(page, pages)} of {pages}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => goTo(page + 1)}>
                Next
              </button>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
