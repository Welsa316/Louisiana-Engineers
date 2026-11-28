/**
 * The photo queue at `/admin/photos` (Task 33). Every profile photo waits
 * here until an administrator approves it; until then the member's initials
 * show. Approved photos can be taken down later from the Shown tab, and a
 * rejection can be reversed. Each decision is audited and the member is told.
 */

import { useState } from "react";
import { useSearchParams } from "react-router";
import { photoStatuses, type AdminPhoto, type PhotoDecision, type PhotoStatus } from "@shared/types/photos";
import { useMeta } from "../../lib/meta";
import { Pager } from "../../ui/admin-controls";
import { Card, Empty, Notice, PageHead, Tabs, Toast, fmtDate, plural } from "../../ui/ui";
import "../../ui/photos.css";
import { ADMIN_PAGE_SIZE, adminErrorText, personName, useAdminAction } from "./api";
import { usePhotos } from "./photos-api";

const TAB_LABELS: Record<PhotoStatus, string> = {
  pending: "Waiting",
  approved: "Shown",
  rejected: "Not approved",
};

const EMPTY: Record<PhotoStatus, string> = {
  pending: "No photos are waiting.",
  approved: "No photos are shown yet.",
  rejected: "No photos were turned down.",
};

function statusFrom(value: string | null): PhotoStatus {
  return (photoStatuses as readonly string[]).includes(value ?? "") ? (value as PhotoStatus) : "pending";
}

export function Photos() {
  useMeta({ title: "Photos" });
  const [params, setParams] = useSearchParams();
  const status = statusFrom(params.get("status"));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const list = usePhotos(status, page);
  const counts = {
    pending: usePhotos("pending", 1, 1).data?.total,
    approved: usePhotos("approved", 1, 1).data?.total,
    rejected: usePhotos("rejected", 1, 1).data?.total,
  };
  const [flash, setFlash] = useState<string | null>(null);
  const decide = useAdminAction((v: { photo: AdminPhoto; decision: PhotoDecision }) => ({
    path: `/admin/photos/${v.photo.id}`,
    method: "POST",
    body: { decision: v.decision },
  }));

  const setTab = (next: PhotoStatus) => {
    setFlash(null);
    setParams(next === "pending" ? {} : { status: next });
  };
  const setPage = (next: number) =>
    setParams({ ...(status === "pending" ? {} : { status }), ...(next > 1 ? { page: String(next) } : {}) });

  const act = (photo: AdminPhoto, decision: PhotoDecision) => {
    setFlash(null);
    // The name without credentials, so the possessive reads naturally.
    const name = personName({ firstName: photo.firstName, lastName: photo.lastName });
    decide.mutate(
      { photo, decision },
      {
        onSuccess: () =>
          setFlash(
            decision === "approved"
              ? `${name}'s photo now shows on their profile.`
              : `${name}'s photo is not shown. Their initials show instead.`,
          ),
      },
    );
  };

  return (
    <>
      <PageHead
        kicker="Photos"
        title="Profile photos waiting to be shown."
        lead="Approve a clear photo of the member, on their own. Turn down anything else: logos, group shots, other people, or anything you would not want on a professional profile. The member is told either way."
      />
      {flash ? (
        <div className="mt-6">
          <Toast text={flash} />
        </div>
      ) : null}
      {decide.isError ? (
        <div role="alert" className="mt-6">
          <Notice tone="warn">{adminErrorText(decide.error)}</Notice>
        </div>
      ) : null}
      <div className="mt-8">
        <Tabs
          label="Photos"
          value={status}
          onChange={setTab}
          tabs={photoStatuses.map((id) => ({ id, label: TAB_LABELS[id], count: counts[id] }))}
        />
      </div>

      <Card flush className="mt-6">
        {list.isError ? (
          <div className="p-5" role="alert">
            <Notice tone="warn">{adminErrorText(list.error)}</Notice>
          </div>
        ) : !list.data ? (
          <p className="p-5 t-small text-fg-2">Loading photos</p>
        ) : list.data.items.length === 0 ? (
          <div className="p-5">
            <Empty inline title={EMPTY[status]}>
              {status === "pending" ? "New photos land here as members upload them." : undefined}
            </Empty>
          </div>
        ) : (
          <>
            <h2 className="sr-only">
              {TAB_LABELS[status]}: {plural(list.data.total, "photo")}
            </h2>
            <ul className="pn-photo-grid">
              {list.data.items.map((photo) => (
                <li key={photo.id} className="pn-photo-tile">
                  <div className="pn-photo-frame">
                    <img src={photo.imageUrl} alt={`Photo uploaded by ${personName(photo)}`} loading="lazy" decoding="async" />
                  </div>
                  <div className="min-w-0">
                    <strong className="pn-photo-tile-name block">{personName(photo)}</strong>
                    <span className="t-small text-fg-2 block">
                      {photo.kind === "student" ? "Student" : "Professional"} · uploaded {fmtDate(photo.uploadedAt, true)}
                    </span>
                    {photo.reviewedAt ? (
                      <span className="t-small text-fg-2 block">Decided {fmtDate(photo.reviewedAt, true)}</span>
                    ) : null}
                  </div>
                  <div className="pn-photo-tile-actions">
                    {photo.status !== "approved" ? (
                      <button
                        type="button"
                        className="btn btn-solid btn-xs"
                        disabled={decide.isPending}
                        onClick={() => act(photo, "approved")}
                      >
                        Approve<span className="sr-only"> the photo of {personName(photo)}</span>
                      </button>
                    ) : null}
                    {photo.status !== "rejected" ? (
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        disabled={decide.isPending}
                        onClick={() => act(photo, "rejected")}
                      >
                        {photo.status === "approved" ? "Take down" : "Reject"}
                        <span className="sr-only"> the photo of {personName(photo)}</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={page} size={ADMIN_PAGE_SIZE} total={list.data.total} onPage={setPage} label="Photo pages" />
          </>
        )}
      </Card>
    </>
  );
}
