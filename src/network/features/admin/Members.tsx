/**
 * Members (03 section 8.3): everyone with an account, searched by name and
 * filtered by kind, approval state, mentoring status, the verified mark and
 * region, from `admin_list_members`. The filters live in the address, so a
 * filtered list can be shared or reloaded. The list carries the sign-up address's domain
 * and never the address or any contact value. Actions: hide a profile or
 * restore it, and grant the administrator role.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type { AdminMember, AdminMemberFilters } from "@shared/types/admin";
import { approvalStates, mentorStatuses, profileKinds } from "@shared/types/common";
import { useMeta } from "../../lib/meta";
import { Pager } from "../../ui/admin-controls";
import { Card, Empty, Modal, Monogram, Notice, PageHead, Select, Status, Toast } from "../../ui/ui";
import { DEFAULT_REGION } from "../onboarding/form";
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
const APPROVAL_LABEL = { pending: "Pending review", approved: "Approved", declined: "Needs changes" } as const;
const MENTOR_LABEL = { active: "Mentoring", paused: "Paused", off: "Not mentoring" } as const;

/** The address keys of the filters other than the name search. */
const FILTER_KEYS = ["kind", "approval", "mentorStatus", "verified", "region"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const oneOf = <T extends string>(list: readonly T[], value: string | null): T | undefined =>
  list.includes(value as T) ? (value as T) : undefined;

/** The filters in the address, keeping only values the server accepts. */
function filtersFrom(params: URLSearchParams): AdminMemberFilters {
  const verified = params.get("verified");
  const region = params.get("region");
  return {
    q: params.get("q")?.trim() || undefined,
    kind: oneOf(profileKinds, params.get("kind")),
    approval: oneOf(approvalStates, params.get("approval")),
    mentorStatus: oneOf(mentorStatuses, params.get("mentorStatus")),
    verified: verified === "true" ? true : verified === "false" ? false : undefined,
    region: region && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(region) ? region : undefined,
  };
}

/**
 * The filters in the address bar right now. The router re-renders after the
 * address changes (inside a transition), so a second change made before that
 * render would otherwise start from the filters of the render before it and
 * bring back a filter just cleared.
 */
const liveFilters = () => filtersFrom(new URLSearchParams(window.location.search));

/** The filters as address parameters (empty ones left out). */
function toParams(filters: AdminMemberFilters, page = 1): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") out[key] = String(value);
  }
  if (page > 1) out.page = String(page);
  return out;
}

/** "greater-new-orleans" as "Greater New Orleans". */
const regionLabel = (slug: string) =>
  slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export function Members() {
  useMeta({ title: "Members" });
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFrom(params), [params]);
  const q = filters.q ?? "";
  const filtered = FILTER_KEYS.some((key) => filters[key] !== undefined);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [draft, setDraft] = useState(q);
  const [granting, setGranting] = useState<AdminMember | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const list = useMembers(filters, page);

  // Search as the administrator types, once they pause.
  useEffect(() => {
    if (draft.trim() === q) return;
    const timer = window.setTimeout(
      () => setParams(toParams({ ...liveFilters(), q: draft.trim() || undefined }), { replace: true }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [draft, q, setParams]);

  /** Changing a filter starts again at the first page. */
  const setFilter = (key: FilterKey, value: string) => {
    const next: AdminMemberFilters = { ...liveFilters(), q: draft.trim() || undefined };
    if (key === "verified") next.verified = value === "" ? undefined : value === "true";
    else (next as Record<string, unknown>)[key] = value || undefined;
    setParams(toParams(next));
  };
  const clearFilters = () => setParams(toParams({ q: draft.trim() || undefined }));

  // The region choices: the one the network serves today, any a row on
  // screen carries, and the one chosen.
  const regions = useMemo(() => {
    const seen = new Set([DEFAULT_REGION, ...(list.data?.items.map((m) => m.region) ?? [])]);
    if (filters.region) seen.add(filters.region);
    return [...seen].filter(Boolean).sort();
  }, [list.data, filters.region]);

  const hide = useAdminAction((m: AdminMember) => ({
    path: `/admin/profiles/${m.id}/${m.adminHidden ? "restore" : "hide"}`,
    method: "POST",
  }));
  const grant = useAdminAction((m: AdminMember) => ({ path: "/admin/admins", method: "POST", body: { profileId: m.id } }));

  const setPage = (next: number) => setParams(toParams(liveFilters(), next));

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

      <form className="mt-8" role="search" aria-label="Members" onSubmit={(e) => e.preventDefault()}>
        <div className="pn-search max-w-md">
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
        <fieldset className="pn-admin-filters mt-4">
          <legend className="sr-only">Filter members</legend>
          <FilterSelect id="members-kind" label="Kind" value={filters.kind ?? ""} onChange={(v) => setFilter("kind", v)}>
            <option value="">Any</option>
            {profileKinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="members-approval"
            label="Approval"
            value={filters.approval ?? ""}
            onChange={(v) => setFilter("approval", v)}
          >
            <option value="">Any</option>
            {approvalStates.map((a) => (
              <option key={a} value={a}>
                {APPROVAL_LABEL[a]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="members-mentoring"
            label="Mentoring"
            value={filters.mentorStatus ?? ""}
            onChange={(v) => setFilter("mentorStatus", v)}
          >
            <option value="">Any</option>
            {mentorStatuses.map((m) => (
              <option key={m} value={m}>
                {MENTOR_LABEL[m]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="members-verified"
            label="Verified"
            value={filters.verified === undefined ? "" : String(filters.verified)}
            onChange={(v) => setFilter("verified", v)}
          >
            <option value="">Any</option>
            <option value="true">Verified</option>
            <option value="false">Not verified</option>
          </FilterSelect>
          <FilterSelect id="members-region" label="Region" value={filters.region ?? ""} onChange={(v) => setFilter("region", v)}>
            <option value="">Any</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {regionLabel(r)}
              </option>
            ))}
          </FilterSelect>
        </fieldset>
        {filtered ? (
          <button type="button" className="btn btn-ghost btn-xs mt-3" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
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
            <Empty
              inline
              title={filtered ? "No members match these filters." : q ? "No members match that name." : "No members yet."}
            />
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

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="pn-admin-filter">
      <label className="field-label pn-field-label t-small" htmlFor={id}>
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {children}
      </Select>
    </div>
  );
}
