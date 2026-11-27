/**
 * Vocabulary (03 section 8.5): expertise tags members proposed, waiting for a
 * decision, and the discipline and mentorship topic lists, which an
 * administrator can add to. Rows are never deleted; rejecting a tag removes
 * it from the profiles that used it.
 */

import { useId, useState, type FormEvent } from "react";
import { Check, Plus, X } from "lucide-react";
import { adminVocabularySchema } from "@shared/schemas/admin";
import { disciplineGroups, type DisciplineGroup } from "@shared/taxonomy";
import type { AdminDiscipline, AdminTag, AdminTopic } from "@shared/types/admin";
import type { TagStatus, VocabularyKind } from "@shared/types/common";
import { useMeta } from "../../lib/meta";
import { Pager } from "../../ui/admin-controls";
import { Card, Empty, Input, Notice, PageHead, Select, Tabs, Toast, fmtDate, plural } from "../../ui/ui";
import { ADMIN_PAGE_SIZE, adminErrorText, useAdminAction, useTags, useVocabulary } from "./api";

const TAG_TABS: { id: TagStatus; label: string }[] = [
  { id: "proposed", label: "Proposed" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

/** "Coastal & environmental" → "coastal-environmental", the shape `admin_add_vocabulary` takes. */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function Vocabulary() {
  useMeta({ title: "Vocabulary" });
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <>
      <PageHead
        kicker="Vocabulary"
        title="The words the directory is built on."
        lead="Approve or reject expertise tags members propose, and add disciplines and mentorship topics when the network needs them."
      />
      {flash ? (
        <div className="mt-6">
          <Toast text={flash} />
        </div>
      ) : null}
      <div className="mt-8 grid grid-cols-1 gap-6">
        <TagQueue onDone={setFlash} />
        <div className="pn-split">
          <VocabularyList kind="discipline" onDone={setFlash} />
          <VocabularyList kind="topic" onDone={setFlash} />
        </div>
      </div>
    </>
  );
}

function TagQueue({ onDone }: { onDone: (text: string) => void }) {
  const [status, setStatus] = useState<TagStatus>("proposed");
  const [page, setPage] = useState(1);
  const tags = useTags(status, page);
  const proposedCount = useTags("proposed", 1, 1).data?.total;
  const decide = useAdminAction((v: { tag: AdminTag; decision: "approved" | "rejected" }) => ({
    path: `/admin/tags/${v.tag.id}`,
    method: "POST",
    body: { decision: v.decision },
  }));
  const act = (tag: AdminTag, decision: "approved" | "rejected") =>
    decide.mutate(
      { tag, decision },
      { onSuccess: () => onDone(decision === "approved" ? `"${tag.label}" is approved.` : `"${tag.label}" is rejected.`) },
    );

  return (
    <Card title="Expertise tags" flush>
      <div className="px-5">
        <Tabs
          label="Tag status"
          value={status}
          onChange={(next) => {
            setStatus(next);
            setPage(1);
          }}
          tabs={TAG_TABS.map((t) => (t.id === "proposed" ? { ...t, count: proposedCount } : t))}
        />
      </div>
      {decide.isError ? (
        <div role="alert" className="px-5 pt-4">
          <Notice tone="warn">{adminErrorText(decide.error)}</Notice>
        </div>
      ) : null}
      {tags.isError ? (
        <div className="p-5" role="alert">
          <Notice tone="warn">{adminErrorText(tags.error)}</Notice>
        </div>
      ) : !tags.data ? (
        <p className="p-5 t-small text-fg-2">Loading tags</p>
      ) : tags.data.items.length === 0 ? (
        <div className="p-5">
          <Empty inline title={status === "proposed" ? "No proposed tags are waiting." : `No ${status} tags.`} />
        </div>
      ) : (
        <>
          <div className="pn-table-wrap">
            <table className="pn-table">
              <caption className="sr-only">
                {TAG_TABS.find((t) => t.id === status)?.label} tags, {tags.data.total} in all
              </caption>
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col">Proposed by</th>
                  <th scope="col" className="pn-num">
                    Profiles
                  </th>
                  <th scope="col">Added</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tags.data.items.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong className="font-medium">{t.label}</strong>
                    </td>
                    <td data-label="Proposed by">{t.proposedByName ?? "Seeded list"}</td>
                    <td className="pn-num" data-label="Profiles">
                      {t.usage}
                    </td>
                    <td data-label="Added">{fmtDate(t.createdAt, true)}</td>
                    <td>
                      <div className="pn-table-actions">
                        {t.status !== "approved" ? (
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            disabled={decide.isPending}
                            onClick={() => act(t, "approved")}
                          >
                            <Check size={13} aria-hidden="true" />
                            Approve<span className="sr-only"> {t.label}</span>
                          </button>
                        ) : null}
                        {t.status !== "rejected" ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            disabled={decide.isPending}
                            onClick={() => act(t, "rejected")}
                          >
                            <X size={13} aria-hidden="true" />
                            Reject<span className="sr-only"> {t.label}</span>
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} size={ADMIN_PAGE_SIZE} total={tags.data.total} onPage={setPage} label="Tag pages" />
        </>
      )}
      {status !== "rejected" ? (
        <p className="t-small text-fg-2 px-5 pb-5 pt-3">
          Rejecting a tag removes it from {status === "proposed" ? "the profiles that proposed it" : "every profile using it"}.
        </p>
      ) : null}
    </Card>
  );
}

function groupOf(row: AdminDiscipline | AdminTopic): string | null {
  return "groupName" in row ? row.groupName : null;
}

const KIND_COPY: Record<VocabularyKind, { title: string; noun: string }> = {
  discipline: { title: "Disciplines", noun: "discipline" },
  topic: { title: "Mentorship topics", noun: "topic" },
};

function VocabularyList({ kind, onDone }: { kind: VocabularyKind; onDone: (text: string) => void }) {
  const vocabulary = useVocabulary();
  const rows = kind === "discipline" ? vocabulary.data?.disciplines : vocabulary.data?.topics;
  const copy = KIND_COPY[kind];

  return (
    <Card title={copy.title}>
      {vocabulary.isError ? (
        <Notice tone="warn">{adminErrorText(vocabulary.error)}</Notice>
      ) : !rows ? (
        <p className="t-small text-fg-2">Loading</p>
      ) : (
        <>
          <p className="t-small text-fg-2">{plural(rows.length, copy.noun)}</p>
          <ul className="grid gap-2 t-small mt-3">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                <span className="min-w-0 truncate">{r.label}</span>
                <span className="flex-1 h-px bg-[var(--pn-line)]" aria-hidden="true" />
                <span className="text-fg-2 whitespace-nowrap">
                  {[groupOf(r), r.active ? null : "inactive"].filter(Boolean).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <AddVocabulary kind={kind} onDone={onDone} />
    </Card>
  );
}

function AddVocabulary({ kind, onDone }: { kind: VocabularyKind; onDone: (text: string) => void }) {
  const labelId = useId();
  const idId = useId();
  const groupId = useId();
  const errorId = useId();
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [group, setGroup] = useState<DisciplineGroup | "">("");
  const [error, setError] = useState<string | null>(null);
  const add = useAdminAction((body: Record<string, unknown>) => ({ path: "/admin/vocabulary", method: "POST", body }));
  const slug = idTouched ? id : slugify(label);
  const noun = KIND_COPY[kind].noun;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = adminVocabularySchema.safeParse({ kind, id: slug, label });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the label and id.");
      return;
    }
    setError(null);
    const body = { ...parsed.data, ...(kind === "discipline" && group ? { groupName: group } : {}) };
    add.mutate(body, {
      onSuccess: () => {
        onDone(`Added the ${noun} "${parsed.data.label}".`);
        setLabel("");
        setId("");
        setIdTouched(false);
        setGroup("");
      },
    });
  };

  return (
    <form className="pn-form mt-6 pt-5 border-t border-[var(--pn-line)]" noValidate onSubmit={submit}>
      <h3 className="pn-kicker pn-kicker-plain">Add a {noun}</h3>
      <div className="field">
        <label className="field-label pn-field-label t-small" htmlFor={labelId}>
          Label
        </label>
        <Input
          id={labelId}
          value={label}
          maxLength={80}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label pn-field-label t-small" htmlFor={idId}>
          Id
        </label>
        <Input
          id={idId}
          value={slug}
          maxLength={60}
          spellCheck={false}
          autoCapitalize="none"
          onChange={(e) => {
            setIdTouched(true);
            setId(e.target.value);
          }}
        />
        <p className="pn-field-hint">Lowercase letters, numbers and hyphens. It cannot be changed later.</p>
      </div>
      {kind === "discipline" ? (
        <div className="field">
          <label className="field-label pn-field-label t-small" htmlFor={groupId}>
            Group <span className="text-fg-2">(optional)</span>
          </label>
          <Select id={groupId} value={group} onChange={(e) => setGroup(e.currentTarget.value as DisciplineGroup | "")}>
            <option value="">No group</option>
            {disciplineGroups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="field-error t-small">
          {error}
        </p>
      ) : null}
      {add.isError ? (
        <div role="alert">
          <Notice tone="warn">{adminErrorText(add.error)}</Notice>
        </div>
      ) : null}
      <div className="pn-admin-actions">
        <button type="submit" className="btn btn-outline btn-sm" disabled={add.isPending}>
          <Plus size={14} aria-hidden="true" />
          Add {noun}
        </button>
      </div>
    </form>
  );
}
