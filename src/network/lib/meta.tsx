/**
 * Per-route document metadata. Every network page is `noindex` unless it opts
 * in; public profiles opt in (A6), and the server also injects their title,
 * description and Open Graph tags into index.html for crawlers that do not
 * run scripts (Task 13). This hook keeps the live document in step for
 * everyone else, and puts back whatever it replaced when the page unmounts.
 */

import { useEffect } from "react";

export const APP_NAME = "MEST Network";

export const DEFAULT_DESCRIPTION =
  "The MEST Network: a directory of Muslim engineers, scientists and technologists in Greater New Orleans, with mentorship for students and early-career members.";

export interface MetaOg {
  title?: string;
  description?: string;
  type?: string;
  url?: string;
  image?: string;
}

export interface MetaOptions {
  /** The page's own name; the app name is appended. */
  title: string;
  description?: string;
  /** Defaults to true: only pages meant for search engines pass false. */
  noindex?: boolean;
  /** Absolute or root-relative URL of the canonical page. */
  canonical?: string;
  og?: MetaOg;
}

/** "Directory" becomes "Directory · MEST Network"; the app name alone stays as is. */
export function formatTitle(title: string): string {
  const trimmed = title.trim();
  return !trimmed || trimmed === APP_NAME ? APP_NAME : `${trimmed} · ${APP_NAME}`;
}

type Restore = () => void;

/** Sets (or, with `null`, removes) a `<meta>` and returns how to put it back. */
function setMeta(attr: "name" | "property", key: string, value: string | null): Restore {
  const head = document.head;
  let el = head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  const existed = el !== null;
  const previous = el?.getAttribute("content") ?? null;

  if (value === null) {
    el?.remove();
  } else {
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr, key);
      head.appendChild(el);
    }
    el.setAttribute("content", value);
  }

  const node = el;
  return () => {
    if (existed && previous !== null) {
      const target = node ?? document.createElement("meta");
      target.setAttribute(attr, key);
      target.setAttribute("content", previous);
      if (!target.isConnected) head.appendChild(target);
    } else {
      node?.remove();
    }
  };
}

function setCanonical(href: string | null): Restore {
  const head = document.head;
  let el = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const existed = el !== null;
  const previous = el?.getAttribute("href") ?? null;

  if (href === null) {
    el?.remove();
  } else {
    if (!el) {
      el = document.createElement("link");
      el.rel = "canonical";
      head.appendChild(el);
    }
    el.href = new URL(href, window.location.origin).toString();
  }

  const node = el;
  return () => {
    if (existed && previous !== null) {
      const target = node ?? document.createElement("link");
      target.rel = "canonical";
      target.setAttribute("href", previous);
      if (!target.isConnected) head.appendChild(target);
    } else {
      node?.remove();
    }
  };
}

export function useMeta(options: MetaOptions): void {
  const key = JSON.stringify(options);

  useEffect(() => {
    const { title, description = DEFAULT_DESCRIPTION, noindex = true, canonical, og } = JSON.parse(key) as MetaOptions;
    const fullTitle = formatTitle(title);
    const restores: Restore[] = [];

    const previousTitle = document.title;
    document.title = fullTitle;
    restores.push(() => {
      document.title = previousTitle;
    });

    restores.push(setMeta("name", "description", description));
    restores.push(setMeta("name", "robots", noindex ? "noindex" : null));
    restores.push(setCanonical(canonical ?? null));
    restores.push(setMeta("property", "og:title", og?.title ?? fullTitle));
    restores.push(setMeta("property", "og:description", og?.description ?? description));
    if (og?.type) restores.push(setMeta("property", "og:type", og.type));
    if (og?.url) restores.push(setMeta("property", "og:url", new URL(og.url, window.location.origin).toString()));
    if (og?.image) restores.push(setMeta("property", "og:image", og.image));

    return () => {
      for (const restore of restores.reverse()) restore();
    };
  }, [key]);
}
