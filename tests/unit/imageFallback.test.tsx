/**
 * A deleted avatar blob used to be fetched, and reported by the framework's
 * image audit, on every page load. These guard the memo that stops that, and
 * the surfaces that draw through it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEAD_IMAGE_TTL_MS,
  ResilientImage,
  isDeadImageUrl,
  markImageUrlDead,
  resetDeadImageUrls,
} from "../../client/lib/imageFallback";
import { Avatar } from "../../client/lib/conversations";

const KEY = "uc:deadImages";
const DEAD =
  "https://blob.ugly.bot/user/jY0oTxnxd3Ff5AQn6qpFJ/K4iCNInoEjgMMmhY_XVFB.webp";
const LIVE = "https://file.ugly.bot/icon.png";

/** The slice of the Storage interface the memo touches. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let store: MemoryStorage;

beforeEach(() => {
  store = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: store,
    configurable: true,
    writable: true,
  });
  resetDeadImageUrls();
});

afterEach(() => {
  resetDeadImageUrls();
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("dead image memo", () => {
  it("knows nothing until a load fails", () => {
    expect(isDeadImageUrl(LIVE)).toBe(false);
    expect(store.getItem(KEY)).toBeNull();
  });

  it("remembers a failed url and persists it with an expiry", () => {
    const now = 1_700_000_000_000;
    markImageUrlDead(DEAD, now);
    expect(isDeadImageUrl(DEAD, now)).toBe(true);
    expect(isDeadImageUrl(LIVE, now)).toBe(false);
    const stored = JSON.parse(store.getItem(KEY) ?? "{}") as Record<
      string,
      number
    >;
    expect(stored[DEAD]).toBe(now + DEAD_IMAGE_TTL_MS);
  });

  it("forgets the failure once the memo expires", () => {
    const now = 1_700_000_000_000;
    markImageUrlDead(LIVE, now);
    expect(isDeadImageUrl(LIVE, now + DEAD_IMAGE_TTL_MS - 1)).toBe(true);
    expect(isDeadImageUrl(LIVE, now + DEAD_IMAGE_TTL_MS)).toBe(false);
  });

  it("survives a reload through storage", () => {
    const now = 1_700_000_000_000;
    markImageUrlDead(DEAD, now);
    resetDeadImageUrls(true);
    expect(isDeadImageUrl(DEAD, now)).toBe(true);
    expect(isDeadImageUrl(DEAD, now + DEAD_IMAGE_TTL_MS)).toBe(false);
  });

  it("ignores storage it cannot read", () => {
    store.setItem(KEY, "not json");
    resetDeadImageUrls(true);
    expect(isDeadImageUrl(DEAD)).toBe(false);
    store.setItem(KEY, JSON.stringify({ [DEAD]: "soon" }));
    resetDeadImageUrls(true);
    expect(isDeadImageUrl(DEAD)).toBe(false);
  });

  it("evicts the oldest entries past the cap", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < 70; i += 1) markImageUrlDead(`https://x/${i}.png`, now);
    expect(isDeadImageUrl("https://x/0.png", now)).toBe(false);
    expect(isDeadImageUrl("https://x/5.png", now)).toBe(false);
    expect(isDeadImageUrl("https://x/6.png", now)).toBe(true);
    expect(isDeadImageUrl("https://x/69.png", now)).toBe(true);
  });
});

describe("ResilientImage", () => {
  it("renders the image for a url it has not seen fail", () => {
    const html = renderToStaticMarkup(
      <ResilientImage src={LIVE} alt="" fallback={<span>fallback</span>} />,
    );
    expect(html).toContain("<img");
    expect(html).toContain(LIVE);
    expect(html).not.toContain("fallback");
  });

  it("renders the fallback, and no <img>, for a dead url or no url", () => {
    markImageUrlDead(DEAD);
    for (const src of [DEAD, null, undefined, ""]) {
      const html = renderToStaticMarkup(
        <ResilientImage src={src} alt="" fallback={<span>fallback</span>} />,
      );
      expect(html).toBe("<span>fallback</span>");
    }
  });
});

describe("Avatar", () => {
  it("draws the initial plate instead of fetching a dead blob again", () => {
    markImageUrlDead(DEAD);
    const html = renderToStaticMarkup(
      <Avatar image={DEAD} seed="jY0oTxnxd3Ff5AQn6qpFJ" label="Justin" />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain(">J<");
  });

  it("still renders a live avatar image", () => {
    const html = renderToStaticMarkup(
      <Avatar image={{ uri: LIVE }} seed="bot" label="Ugly File" />,
    );
    expect(html).toContain("<img");
    expect(html).toContain(LIVE);
  });
});
