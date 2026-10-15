import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import {
  THEMES,
  normalizeTheme,
  applyThemeAttr,
  colorSchemeValue,
  resolveScheme,
  syncColorScheme,
} from "../../client/lib/theme";

describe("theme", () => {
  it("lists the five themes with auto first", () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      "auto",
      "light",
      "dark",
      "cosmic-latte",
      "vim",
    ]);
  });
  it("normalizes unknown values to auto", () => {
    expect(normalizeTheme("nope")).toBe("auto");
    expect(normalizeTheme("vim")).toBe("vim");
    expect(normalizeTheme(null)).toBe("auto");
  });
  it("removes the data-theme attribute for auto, sets it otherwise", () => {
    const el = {
      dataset: {} as Record<string, string>,
      removeAttribute: vi.fn(() => {
        delete (el.dataset as Record<string, string>).theme;
      }),
    } as unknown as HTMLElement;
    applyThemeAttr(el, "vim");
    expect(el.dataset.theme).toBe("vim");
    applyThemeAttr(el, "auto");
    expect(el.removeAttribute).toHaveBeenCalledWith("data-theme");
  });
});

describe("color-scheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto follows the system, an explicit choice overrides it", () => {
    expect(resolveScheme(undefined, true)).toBe("dark");
    expect(resolveScheme(undefined, false)).toBe("light");
    expect(resolveScheme("light", true)).toBe("light");
    expect(resolveScheme("cosmic-latte", true)).toBe("light");
    expect(resolveScheme("dark", false)).toBe("dark");
    expect(resolveScheme("vim", false)).toBe("dark");
    expect(resolveScheme("bogus", false)).toBe("light");
  });

  it("opts a light page out of WebView force-dark", () => {
    expect(colorSchemeValue("light")).toBe("only light");
    expect(colorSchemeValue("dark")).toBe("dark");
  });

  it("writes the resolved scheme inline and into the meta tag, live", () => {
    let systemDark = true;
    const meta = { name: "", content: "" };
    const setProperty = vi.fn();
    const dataset: Record<string, string> = {};
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: systemDark }),
    });
    vi.stubGlobal("document", {
      documentElement: { dataset, style: { setProperty } },
      querySelector: () => meta,
    });
    syncColorScheme();
    expect(meta.content).toBe("dark");
    systemDark = false;
    syncColorScheme();
    expect(meta.content).toBe("only light");
    dataset.theme = "vim";
    syncColorScheme();
    expect(meta.content).toBe("dark");
    expect(setProperty).toHaveBeenLastCalledWith("color-scheme", "dark");
  });
});
