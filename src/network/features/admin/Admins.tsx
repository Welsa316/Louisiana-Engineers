/**
 * Administrators: who holds the role, who granted it, and revocation. The
 * platform keeps at least two (A7); `admin_revoke` refuses anything below
 * that, and this screen says so before anyone tries. New administrators
 * are granted from Members, for one region or for every region; the
 * Region column shows each administrator's scope.
 */

import { useState } from "react";
import { Link } from "react-router";
import type { AdminRole } from "@shared/types/admin";
import { useMeta } from "../../lib/meta";
import { Card, Empty, Modal, Monogram, Notice, PageHead, Toast, fmtDate } from "../../ui/ui";
import { adminErrorText, personInitials, personName, useAdminAction, useAdmins } from "./api";

const MINIMUM = 2;

export function Admins() {
  useMeta({ title: "Administrators" });
  const admins = useAdmins();
  const [revoking, setRevoking] = useState<AdminRole | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const revoke = useAdminAction((a: AdminRole) => ({ path: `/admin/admins/${a.profileId}`, method: "DELETE" }));
  const atMinimum = (admins.data?.total ?? 0) <= MINIMUM;

  return (
    <>
      <PageHead
        kicker="Administrators"
        title="Who runs the network."
        lead={
          <>
            At least two administrators are kept at all times. To add one, find them under{" "}
            <Link to="/admin/members" className="link">
              Members
            </Link>{" "}
            and choose Make administrator.
          </>
        }
      />
      {flash ? (
        <div className="mt-6">
          <Toast text={flash} />
        </div>
      ) : null}
      {revoke.isError ? (
        <div role="alert" className="mt-6">
          <Notice tone="warn">{adminErrorText(revoke.error)}</Notice>
        </div>
      ) : null}

      <Card flush className="mt-8">
        {admins.isError ? (
          <div className="p-5" role="alert">
            <Notice tone="warn">{adminErrorText(admins.error)}</Notice>
          </div>
        ) : !admins.data ? (
          <p className="p-5 t-small text-fg-2">Loading administrators</p>
        ) : admins.data.items.length === 0 ? (
          <div className="p-5">
            <Empty inline title="No administrators." />
          </div>
        ) : (
          <div className="pn-table-wrap">
            <table className="pn-table">
              <caption className="sr-only">Administrators, {admins.data.total} in all</caption>
              <thead>
                <tr>
                  <th scope="col">Administrator</th>
                  <th scope="col">Region</th>
                  <th scope="col">Since</th>
                  <th scope="col">Granted by</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {admins.data.items.map((a) => (
                  <tr key={a.profileId}>
                    <td>
                      <div className="pn-table-person">
                        <Monogram initials={personInitials(a)} size="sm" />
                        <div className="min-w-0">
                          <strong>
                            {personName(a)}
                            {a.isSelf ? <span className="text-fg-2"> (you)</span> : null}
                          </strong>
                        </div>
                      </div>
                    </td>
                    <td data-label="Region">{a.regionLabel ?? (a.regionId ? a.regionId : "Every region")}</td>
                    <td data-label="Since">{fmtDate(a.grantedAt, true)}</td>
                    <td data-label="Granted by">{a.grantedByName ?? "Set up from the command line"}</td>
                    <td>
                      <div className="pn-table-actions">
                        <button
                          type="button"
                          className="btn btn-outline btn-xs"
                          disabled={atMinimum || revoke.isPending}
                          aria-describedby={atMinimum ? "admins-minimum" : undefined}
                          onClick={() => setRevoking(a)}
                        >
                          Remove role<span className="sr-only">: {personName(a)}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {atMinimum ? (
              <p id="admins-minimum" className="t-small text-fg-2 p-5">
                With only {MINIMUM} administrators, neither role can be removed. Grant a third first.
              </p>
            ) : null}
          </div>
        )}
      </Card>

      <Modal
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title="Remove the administrator role?"
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevoking(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={revoke.isPending}
              onClick={() =>
                revoking &&
                revoke.mutate(revoking, {
                  onSuccess: () => {
                    setFlash(`${personName(revoking)} is no longer an administrator.`);
                    setRevoking(null);
                  },
                  onError: () => setRevoking(null),
                })
              }
            >
              Remove role
            </button>
          </>
        }
      >
        {revoking ? (
          <p className="t-body mt-3">
            {revoking.isSelf
              ? "You will lose access to the administration area as soon as this is done."
              : `${personName(revoking)} keeps their membership and profile, and loses access to the administration area.`}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
