/**
 * Resolves when web fonts are ready, or after `timeoutMs`, whichever comes
 * first. Text that is split into masked lines or letters must be measured
 * with the real font, but a stalled font request must never leave copy
 * hidden.
 */
export function fontsReady(timeoutMs = 1200): Promise<void> {
  if (!("fonts" in document)) return Promise.resolve();
  return Promise.race([
    document.fonts.ready.then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}
