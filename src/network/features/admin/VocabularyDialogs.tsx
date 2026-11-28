/**
 * The vocabulary screen's three confirmations (Task 34): rename a
 * discipline, topic or tag; merge a tag into an approved one; retire a
 * mentorship topic. Each is one dialog over `/api/admin/*`; the server
 * functions check the administrator again and audit the change.
 */

import { useEffect, useId, useState, type FormEvent } from "react";
import { adminRenameSchema, type RenameKind } from "@shared/schemas/admin";
import type { AdminTag, AdminTagMergeResult } from "@shared/types/admin";
import { fieldLimits, limits } from "@shared/limits";
import { isApiError } from "../../lib/api";
import { Input, Modal, Notice, Option, plural } from "../../ui/ui";
import { adminErrorText, useAdminAction, useTags } from "./api";

export type VocabularyAction =
  | { type: "rename"; kind: RenameKind; id: string; label: string }
  | { type: "merge"; tag: AdminTag }
  | { type: "retire"; id: string; label: string };

const RENAME_NOUN: Record<RenameKind, string> = { discipline: "discipline", topic: "topic", tag: "tag" };

/** Up to this many approved tags are offered as merge targets per search. */
const MERGE_RESULTS = 8;

export function VocabularyDialogs({
  action,
  onClose,
  onDone,
}: {
  action: VocabularyAction | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  return (
    <>
      <RenameDialog action={action?.type === "rename" ? action : null} onClose={onClose} onDone={onDone} />
      <MergeDialog tag={action?.type === "merge" ? action.tag : null} onClose={onClose} onDone={onDone} />
      <RetireDialog action={action?.type === "retire" ? action : null} onClose={onClose} onDone={onDone} />
    </>
  );
}

function RenameDialog({
  action,
  onClose,
  onDone,
}: {
  action: Extract<VocabularyAction, { type: "rename" }> | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const formId = useId();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rename = useAdminAction((v: { kind: RenameKind; id: string; label: string }) => ({
    path: `/admin/vocabulary/${v.kind}/${encodeURIComponent(v.id)}`,
    method: "PATCH",
    body: { label: v.label },
  }));
  const { reset } = rename;

  useEffect(() => {
    setLabel(action?.label ?? "");
    setError(null);
    reset();
  }, [action, reset]);

  const max = action?.kind === "tag" ? limits.expertise.tag.max : fieldLimits.vocabularyLabel.max;
  const noun = action ? RENAME_NOUN[action.kind] : "entry";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action) return;
    const parsed = adminRenameSchema.safeParse({ label });
    if (!parsed.success || parsed.data.label.length > max) {
      setError(`Use a label of 2 to ${max} characters.`);
      return;
    }
    setError(null);
    rename.mutate(
      { kind: action.kind, id: action.id, label: parsed.data.label },
      {
        onSuccess: () => {
          onDone(`"${action.label}" is now "${parsed.data.label}".`);
          onClose();
        },
      },
    );
  };

  const serverError = rename.isError
    ? isApiError(rename.error, "duplicate")
      ? "Another tag already has this label. Merge the two tags instead."
      : adminErrorText(rename.error)
    : null;

  return (
    <Modal
      open={action !== null}
      onClose={onClose}
      title={action ? `Rename "${action.label}"` : "Rename"}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-solid btn-sm" disabled={rename.isPending}>
            Save the new label
          </button>
        </>
      }
    >
      <form id={formId} className="pn-form mt-4" noValidate onSubmit={submit}>
        <div className="field">
          <label className="field-label pn-field-label t-small" htmlFor={inputId}>
            New label
          </label>
          <Input
            id={inputId}
            value={label}
            maxLength={max}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={[hintId, error ? errorId : null].filter(Boolean).join(" ")}
            onChange={(e) => setLabel(e.target.value)}
          />
          <p id={hintId} className="pn-field-hint">
            Every profile using this {noun} shows the new label. Its id stays the same, so filters and saved links keep
            working.
          </p>
        </div>
        {error ? (
          <p id={errorId} role="alert" className="field-error t-small">
            {error}
          </p>
        ) : null}
        {serverError ? (
          <div role="alert">
            <Notice tone="warn">{serverError}</Notice>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

function MergeDialog({
  tag,
  onClose,
  onDone,
}: {
  tag: AdminTag | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const searchId = useId();
  const groupName = useId();
  const [q, setQ] = useState("");
  const [into, setInto] = useState<AdminTag | null>(null);
  const results = useTags("approved", 1, MERGE_RESULTS + 1, q, tag !== null);
  const merge = useAdminAction<{ from: AdminTag; into: AdminTag }, AdminTagMergeResult>((v) => ({
    path: `/admin/tags/${v.from.id}/merge`,
    method: "POST",
    body: { intoTagId: v.into.id },
  }));
  const { reset } = merge;

  useEffect(() => {
    setQ("");
    setInto(null);
    reset();
  }, [tag, reset]);

  const options = (results.data?.items ?? []).filter((t) => t.id !== tag?.id).slice(0, MERGE_RESULTS);

  const confirm = () => {
    if (!tag || !into) return;
    merge.mutate(
      { from: tag, into },
      {
        onSuccess: (result) => {
          onDone(
            `"${tag.label}" is merged into "${into.label}". ${plural(result.moved, "profile")} moved.`,
          );
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={tag !== null}
      onClose={onClose}
      title={tag ? `Merge "${tag.label}"` : "Merge a tag"}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-solid btn-sm" disabled={!into || merge.isPending} onClick={confirm}>
            {into ? `Merge into "${into.label}"` : "Choose a tag to merge into"}
          </button>
        </>
      }
    >
      {tag ? (
        <>
          <p className="t-body">
            {tag.usage > 0 ? `${plural(tag.usage, "profile")} move to the tag you choose. ` : ""}
            "{tag.label}" is retired, and anyone who types it gets that tag.
          </p>
          <div className="field mt-5">
            <label className="field-label pn-field-label t-small" htmlFor={searchId}>
              Search approved tags
            </label>
            <Input
              id={searchId}
              type="search"
              value={q}
              maxLength={fieldLimits.vocabularyLabel.max}
              autoFocus
              autoComplete="off"
              onChange={(e) => {
                setQ(e.target.value);
                setInto(null);
              }}
            />
          </div>
          <fieldset className="mt-4">
            <legend className="sr-only">Merge into</legend>
            {results.isError ? (
              <Notice tone="warn">{adminErrorText(results.error)}</Notice>
            ) : !results.data ? (
              <p className="t-small text-fg-2">Loading tags</p>
            ) : options.length === 0 ? (
              <p className="t-small text-fg-2" role="status">
                {q.trim() ? `No approved tag contains "${q.trim()}".` : "There are no other approved tags yet."}
              </p>
            ) : (
              <div className="pn-options max-h-[min(17rem,30dvh)] overflow-y-auto p-1.5 -m-1.5">
                {options.map((t) => (
                  <Option
                    key={t.id}
                    name={groupName}
                    checked={into?.id === t.id}
                    title={t.label}
                    note={plural(t.usage, "profile")}
                    onClick={() => setInto(t)}
                  />
                ))}
              </div>
            )}
          </fieldset>
          {merge.isError ? (
            <div role="alert" className="mt-4">
              <Notice tone="warn">{adminErrorText(merge.error)}</Notice>
            </div>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}

function RetireDialog({
  action,
  onClose,
  onDone,
}: {
  action: Extract<VocabularyAction, { type: "retire" }> | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const retire = useAdminAction((id: string) => ({
    path: `/admin/topics/${encodeURIComponent(id)}/retire`,
    method: "POST",
  }));
  const { reset } = retire;
  useEffect(() => reset(), [action, reset]);

  return (
    <Modal
      open={action !== null}
      onClose={onClose}
      title={action ? `Retire "${action.label}"?` : "Retire a topic?"}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={retire.isPending}
            onClick={() =>
              action &&
              retire.mutate(action.id, {
                onSuccess: () => {
                  onDone(`"${action.label}" is retired. Members who chose it keep it.`);
                  onClose();
                },
              })
            }
          >
            Retire topic
          </button>
        </>
      }
    >
      <p className="t-body">
        It stops appearing in onboarding, in settings and in the directory filter, so nobody new can choose it. Mentors
        and students who already chose it keep it on their profiles until they remove it.
      </p>
      <p className="t-small">There is no undo on this screen.</p>
      {retire.isError ? (
        <div role="alert" className="mt-4">
          <Notice tone="warn">{adminErrorText(retire.error)}</Notice>
        </div>
      ) : null}
    </Modal>
  );
}
