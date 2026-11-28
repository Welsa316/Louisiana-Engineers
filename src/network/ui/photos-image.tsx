/**
 * The approved profile photo inside a `Monogram` (Task 33). The photo is of
 * a person, so it is shown as it is: no filter, no tint, cropped to the
 * monogram's square with `object-fit: cover` on a centred focal point. If it
 * fails to load (taken down since the page was read, or offline), the
 * initials come back.
 */

import { useState, type ReactNode } from "react";
import "./photos.css";

export function MonogramPhoto({ src, fallback }: { src: string | null | undefined; fallback: ReactNode }) {
  // Keyed by the URL, so a new photo gets a fresh try after an earlier failure.
  return src ? <PhotoOrFallback key={src} src={src} fallback={fallback} /> : <>{fallback}</>;
}

function PhotoOrFallback({ src, fallback }: { src: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  // Decorative: the monogram is aria-hidden and the name always sits beside it.
  return <img className="pn-mono-photo" src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
