/**
 * Settings, Profile: the profile photo (Task 33). Optional; initials are
 * the default. A chosen photo is resized in the browser to 512 px and
 * uploaded, then waits for an administrator before anyone else sees it.
 * The owner sees their own photo in every state here.
 */

import { useId, useState, type ChangeEvent } from "react";
import type { OwnProfile } from "@shared/types/me";
import type { PhotoStatus } from "@shared/types/photos";
import { PhotoResizeError, resizePhoto } from "../../lib/photo-resize";
import { Card, Monogram, Notice, Status, Toast } from "../../ui/ui";
import "../../ui/photos.css";
import { photoErrorText, useOwnPhoto, useRemovePhoto, useUploadPhoto } from "./photo-api";

const STATUS: Record<PhotoStatus, { tone: "pending" | "approved" | "declined"; label: string; text: string }> = {
  pending: {
    tone: "pending",
    label: "Waiting for review",
    text: "An administrator checks every photo before it is shown. Until then, others see your initials.",
  },
  approved: {
    tone: "approved",
    label: "Shown",
    text: "Your photo shows on your profile in place of your initials, to whoever can see your profile.",
  },
  rejected: {
    tone: "declined",
    label: "Not approved",
    text: "An administrator did not approve this photo, so others see your initials. A clear photo of you, on your own, works best.",
  },
};

function resizeErrorText(error: unknown): string {
  if (error instanceof PhotoResizeError) {
    if (error.reason === "too_big") return "That file is too large to open here. Choose a photo under 25 MB.";
    if (error.reason === "too_detailed") return "We could not make that photo small enough. Try a different one.";
    return "We could not read that file as a photo. Choose a JPEG, PNG or WebP image.";
  }
  return photoErrorText(error);
}

export function PhotoCard({ profile }: { profile: OwnProfile }) {
  const inputId = useId();
  const hintId = useId();
  const own = useOwnPhoto();
  const upload = useUploadPhoto();
  const remove = useRemovePhoto();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const photo = own.data?.photo ?? null;
  const busy = preparing || upload.isPending || remove.isPending;
  const initials = `${profile.firstName?.[0] ?? ""}${profile.lastName?.[0] ?? ""}`.toUpperCase() || "?";

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Let the same file be chosen again after a refusal.
    event.target.value = "";
    if (!file) return;
    setError(null);
    setFlash(null);
    setPreparing(true);
    try {
      const resized = await resizePhoto(file);
      setPreparing(false);
      await upload.mutateAsync(resized);
      setFlash("Photo uploaded. It shows once an administrator approves it.");
    } catch (failure) {
      setError(resizeErrorText(failure));
    } finally {
      setPreparing(false);
    }
  };

  const removePhoto = () => {
    setError(null);
    setFlash(null);
    remove.mutate(undefined, {
      onSuccess: () => setFlash("Photo removed. Your initials show instead."),
      onError: (failure) => setError(photoErrorText(failure)),
    });
  };

  const status = photo ? STATUS[photo.status] : null;

  return (
    <Card title="Photo" aside={status ? <Status tone={status.tone} label={status.label} /> : null}>
      <div className="pn-photo-card">
        <Monogram initials={initials} photo={photo?.imageUrl} size="lg" student={profile.kind === "student"} />
        <div className="min-w-0">
          <p id={hintId} className="t-small text-fg-2">
            {status
              ? status.text
              : "Optional. Your initials show until you add one. An administrator approves each photo before others see it."}
          </p>
          <div className="pn-photo-card-actions">
            <input
              id={inputId}
              className="pn-photo-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-describedby={hintId}
              disabled={busy}
              onChange={choose}
            />
            <label htmlFor={inputId} className="btn btn-outline btn-sm pn-photo-pick" aria-disabled={busy || undefined}>
              {photo ? "Choose a different photo" : "Choose a photo"}
            </label>
            {photo ? (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={removePhoto}>
                Remove photo
              </button>
            ) : null}
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {preparing ? "Resizing your photo" : upload.isPending ? "Uploading your photo" : ""}
          </p>
        </div>
      </div>
      {error ? (
        <div role="alert" className="mt-4">
          <Notice tone="warn">{error}</Notice>
        </div>
      ) : null}
      {flash ? (
        <div className="mt-4">
          <Toast text={flash} />
        </div>
      ) : null}
      {own.isError ? (
        <div role="alert" className="mt-4">
          <Notice tone="warn">{photoErrorText(own.error)}</Notice>
        </div>
      ) : null}
    </Card>
  );
}
