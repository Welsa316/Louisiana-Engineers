/**
 * Shrinks a chosen photo in the browser before upload (Task 33): the longer
 * side to at most `photoLimits.maxEdge` pixels, re-encoded as JPEG until it
 * fits `photoLimits.maxBytes`. Drawing onto a canvas also drops the file's
 * metadata (camera, date and GPS position), so none of it is uploaded.
 * The pixels are drawn as they are: no crop, filter or tint.
 */

import { photoLimits } from "@shared/limits";

/** A file the browser is unlikely to decode in reasonable time. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export class PhotoResizeError extends Error {
  constructor(readonly reason: "too_big" | "unreadable" | "too_detailed") {
    super(reason);
    this.name = "PhotoResizeError";
  }
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // Respects the EXIF orientation, so a phone portrait is not turned on its side.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to an <img>, which some browsers decode more formats with.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoResizeError("unreadable");
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** The photo as a JPEG of at most `maxEdge` pixels a side and `maxBytes` bytes. */
export async function resizePhoto(
  file: Blob,
  maxEdge: number = photoLimits.maxEdge,
  maxBytes: number = photoLimits.maxBytes,
): Promise<Blob> {
  if (file.size > MAX_SOURCE_BYTES) throw new PhotoResizeError("too_big");
  const image = await decode(file);
  try {
    if (!image.width || !image.height) throw new PhotoResizeError("unreadable");
    let edge = maxEdge;
    // A few rounds: lower the quality first, then the size, never below a usable face.
    while (edge >= 256) {
      const scale = Math.min(1, edge / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new PhotoResizeError("unreadable");
      // JPEG has no transparency: a cut-out PNG sits on white rather than black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.82, 0.74, 0.66]) {
        const blob = await toBlob(canvas, quality);
        if (!blob) throw new PhotoResizeError("unreadable");
        if (blob.size <= maxBytes) return blob;
      }
      edge = Math.floor(edge * 0.8);
    }
    throw new PhotoResizeError("too_detailed");
  } finally {
    image.close();
  }
}
