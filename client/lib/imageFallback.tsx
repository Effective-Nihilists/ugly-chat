import React, { useCallback, useReducer } from "react";
import { z } from "zod";
import { crossOriginProps } from "ugly-app/client";

/**
 * Image URLs that have failed to load in this browser.
 *
 * A dangling reference used to be fetched again by every mount and every page
 * load, and each failure was reported by the framework's image audit. One
 * user's avatar blob is a genuine 404 now, and prod logged
 * `[ugly.ux] image: failed to load "https://blob.ugly.bot/user/..."` for it
 * three days running (2026-10-13..15) from "/", a bot thread and a group
 * thread. The <img> did fall back to the initial plate, but only after the
 * failed request, and the report fired on every load.
 *
 * Remembering the failure, in memory for this session and in localStorage for
 * a few hours, means the next render goes straight to the fallback: no
 * request, no error event, no report. The memo expires so a transient failure
 * (the ugly-file bot's icon at file.ugly.bot answered 200 again) heals itself.
 * A failure while offline is kept in memory only: the request fails for every
 * image then, and none of them is dead.
 */
const STORAGE_KEY = "uc:deadImages";
export const DEAD_IMAGE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 64;

/** url -> expiry (ms since epoch) */
const StoredSchema = z.record(z.string(), z.number());

let dead: Map<string, number> | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // A sandboxed frame throws on access.
    return null;
  }
}

function load(now: number): Map<string, number> {
  if (dead) return dead;
  const map = new Map<string, number>();
  dead = map;
  const s = storage();
  if (!s) return map;
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return map;
    const parsed = StoredSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return map;
    for (const [url, expires] of Object.entries(parsed.data)) {
      if (expires > now) map.set(url, expires);
    }
  } catch {
    // Unreadable storage: start empty.
  }
  return map;
}

function persist(map: Map<string, number>): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // Quota or private mode: the in-memory memo still covers this session.
  }
}

function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  // Node and some WebViews leave onLine undefined; only an explicit false
  // means offline.
  const nav: { onLine?: boolean } = navigator;
  return nav.onLine !== false;
}

/** True when this browser saw `url` fail to load within the last few hours. */
export function isDeadImageUrl(url: string, now = Date.now()): boolean {
  const map = load(now);
  const expires = map.get(url);
  if (expires === undefined) return false;
  if (expires > now) return true;
  map.delete(url);
  return false;
}

/** Record that `url` failed to load, so no later render fetches it again. */
export function markImageUrlDead(url: string, now = Date.now()): void {
  if (!url) return;
  const map = load(now);
  for (const [k, expires] of map) if (expires <= now) map.delete(k);
  // Re-insert so the entry moves to the end: eviction drops the oldest first.
  map.delete(url);
  map.set(url, now + DEAD_IMAGE_TTL_MS);
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  if (isOnline()) persist(map);
}

/**
 * Forget every remembered failure. For tests: with `keepStorage` only the
 * in-memory memo is dropped, which is what a page reload does.
 */
export function resetDeadImageUrls(keepStorage = false): void {
  dead = null;
  if (keepStorage) return;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * The `src` to render for an image that may be dead, and the `onError` that
 * records a new failure. `src` is null when there is nothing worth mounting:
 * no url, or one this browser already knows is dead, so the caller draws its
 * fallback without an <img> ever hitting the network.
 */
export function useImageSrc(url: string | null | undefined): {
  src: string | null;
  onError: () => void;
} {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const onError = useCallback(() => {
    if (url) markImageUrlDead(url);
    rerender();
  }, [url]);
  const src = url && !isDeadImageUrl(url) ? url : null;
  return { src, onError };
}

type ImgProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src" | "onError"
>;

/**
 * An <img> that renders `fallback` instead when there is no usable image: the
 * url is missing, it failed to load just now, or this browser already knows it
 * is dead. Every avatar surface that is not the shared `Avatar` plate (bot
 * lists, call tiles, the incoming-call ring, the bot editor) draws through
 * this so a deleted blob never leaves a broken image icon behind.
 */
export function ResilientImage({
  src,
  fallback,
  alt = "",
  ...imgProps
}: ImgProps & {
  src: string | null | undefined;
  /** What to draw when there is no usable image. */
  fallback: React.ReactNode;
}): React.ReactElement {
  const live = useImageSrc(src);
  if (!live.src) return <>{fallback}</>;
  return (
    <img
      {...crossOriginProps(live.src)}
      {...imgProps}
      src={live.src}
      alt={alt}
      onError={live.onError}
    />
  );
}
