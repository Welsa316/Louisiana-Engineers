/**
 * Members (03 section 8.3): everyone with an account, searched by name,
 * from `admin_list_members`. The list carries the sign-up address's domain
 * and never the address or any contact value. Actions: hide a profile or
 * restore it, and grant the administrator role.
 */

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type { AdminMember } from "@shared/types/admin";
import { useMeta } from "../../lib/meta";
import { Pager } from "../../ui/admin-controls";
import { Card, Empty, Modal, Monogram, Notice, PageHead, Status, Toast } from "../../ui/ui";
import { ADMIN_PAGE_SIZE, adminErrorText, personInitials, personName, useAdminAction, useMembers } from "./api";

type Tone = Parameters<typeof Status>[0]["tone"];

/** The profile's standing in one label (03 section 11.2). */
export function memberStatus(m: AdminMember): { tone: Tone; label: string } {
  if (m.adminHidden) return { tone: "off", label: "Hidden by admin" };
  if (m.kind === null) return { tone: "pending", label: "Not onboarded" };
  if (m.kind === "student") return { tone: "active", label: "Member" };
  if (m.approvalState === "pending") return { tone: "pending", label: "Pending review" };
  if (m.approvalState === "declined") return { tone: "declined", label: "Needs changes" };
  if (m.visibility === "hidden") return { tone: "off", label: "Hidden by member" };
  return { tone: "approved", label: m.visibility === "members" ? "Members only" : "Listed" };
}

const KIND_LABEL = { professional: "Professional", student: "Student" } as const;

export function Members() {
  useMeta({ title: "Members" });
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [draft, setDraft] = useState(q);
  const [granting, setGranting] = useState<AdminMember | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const list = useMembers(q, page);

  // Search as the administrator types, once they pause.
  useEffect(() => {
    if (draft.trim() === q) return;
    const timer = window.setTimeout(() => setParams(draft.trim() ? { q: draft.trim() } : {}, { replace: true }), 300);
    return () => window.clearTimeout(timer);
  }, [draft, q, setParams]);

  const hide = useAdminAction((m: AdminMember) => ({
    path: `/admin/profiles/${m.id}/${m.adminHidden ? "restore" : "hide"}`,
    method: "POST",
  }));
  const grant = useAdminAction((m: AdminMember) => ({ path: "/admin/admins", method: "POST", body: { profileId: m.id } }));

  const setPage = (next: number) => setParams({ ...(q ? { q } : {}), ...(next > 1 ? { page: String(next) } : {}) });

  return (
    <>
      <PageHead
        kicker="Members"
        title="Everyone with an account."
        lead="Hide a profile while something is looked into; approval has its own queue. This list shows the sign-up domain, never an address or contact details."
      />
      {flash ? (
        <div className="mt-6">
          <Toast text={flash} />
        </div>
      ) : null}

      <form className="mt-8 max-w-md" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="pn-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by name"
            aria-label="Search members by name"
            style={{ minHeight: "2.75rem" }}
          />
        </div>
      </form>

      {hide.isError || grant.isError ? (
        <div role="alert" className="mt-6">
          <Notice tone="warn">{adminErrorText(hide.error ?? grant.error)}</Notice>
        </div>
      ) : null}

      <Card flush className="mt-6">
        {list.isError ? (
          <div className="p-5" role="alert">
            <Notice tone="warn">{adminErrorText(list.error)}</Notice>
          </div>
        ) : !list.data ? (
          <p className="p-5 t-small text-fg-2">Loading members</p>
        ) : list.data.items.length === 0 ? (
          <div className="p-5">
            <Empty inline title={q ? "No members match that name." : "No members yet."} />
          </div>
        ) : (
          <>
            <div className="pn-table-wrap">
              <table className="pn-table">
                <caption className="sr-only">Members, {list.data.total} in all</caption>
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">Status</th>
                    <th scope="col">Mentoring</th>
                    <th scope="col">Sign-up domain</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((m) => {
                    const status = memberStatus(m);
                    const listed = status.tone === "approved" && m.kind === "professional";
                    return (
                      <tr key={m.id}>
                        <td>
                          <div className="pn-table-person pn-admin-person">
                            <Monogram initials={personInitials(m)} size="sm" student={m.kind === "student"} />
                            <div className="min-w-0">
                              <strong>{personName(m)}</strong>
                              <span>{[m.kind ? KIND_LABEL[m.kind] : "Has not chosen a type", m.detail].filter(Boolean).join(" · ")}</span>
                              {m.isAdmin ? <span className="pn-tag pn-tag-quiet mt-1 inline-flex">Administrator</span> : null}
                            </div>
                          </div>
                        </td>
                        <td data-label="Status">
                          <Status tone={status.tone} label={status.label} />
                        </td>
                        <td data-label="Mentoring">
                          {m.mentorStatus ? <Status tone={m.mentorStatus} /> : <span className="text-fg-2">No</span>}
                        </td>
                        <td data-label="Sign-up domain">{m.emailDomain}</td>
                        <td>
                          <div className="pn-table-actions pn-admin-stack">
                            {listed ? (
                              <Link to={`/directory/${m.id}`} className="btn btn-ghost btn-xs">
                                View<span className="sr-only"> {personName(m)}</span>
                              </Link>
                            ) : null}
                            {m.kind !== null ? (
                              <button
                                type="button"
                                className="btn btn-outline btn-xs"
                                disabled={hide.isPending}
                                onClick={() =>
                                  hide.mutate(m, {
                                    onSuccess: () =>
                                      setFlash(
                                        m.adminHidden
                                          ? `${personName(m)} is restored.`
                                          : `${personName(m)} is hidden from the directory and from requests.`,
                                      ),
                                  })
                                }
                              >
                                {m.adminHidden ? "Restore" : "Hide"}
                                <span className="sr-only"> {personName(m)}</span>
                              </button>
                            ) : null}
                            {!m.isAdmin && m.kind !== null ? (
                              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setGranting(m)}>
                                Make administrator<span className="sr-only">: {personName(m)}</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={page} size={ADMIN_PAGE_SIZE} total={list.data.total} onPage={setPage} label="Member pages" />
          </>
        )}
      </Card>

      <Modal
        open={granting !== null}
        onClose={() => setGranting(null)}
        title="Make this member an administrator?"
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGranting(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-solid btn-sm"
              disabled={grant.isPending}
              onClick={() =>
                granting &&
                grant.mutate(granting, {
                  onSuccess: () => {
                    setFlash(`${personName(granting)} is now an administrator.`);
                    setGranting(null);
                  },
                })
              }
            >
              Make administrator
            </button>
          </>
        }
      >
        {granting ? (
          <p className="t-body mt-3">
            {personName(granting)} will see the approval queue, the members list and these settings, and can act on
            them. Every action is recorded in the audit log.
          </p>
        ) : null}
      </Modal>
    </>
  );
}
